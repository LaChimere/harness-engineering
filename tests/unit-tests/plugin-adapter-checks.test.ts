import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkHookSafety } from '../../scripts/check-hook-safety.ts';
import { checkSkillParity } from '../../scripts/check-skill-parity.ts';

test('packaged Claude skills match canonical skill bodies and hashes', async () => {
  expect(await checkSkillParity(process.cwd())).toEqual([]);
});

test('skill parity fails when a packaged skill body drifts', async () => {
  const root = await copiedAdapterRoot();
  try {
    await writeFile(
      join(root, 'plugins/claude-code/skills/harness-doctor/SKILL.md'),
      `${await readFile(join(root, 'plugins/claude-code/skills/harness-doctor/SKILL.md'), 'utf8')}\nDrift.\n`,
    );
    expect((await checkSkillParity(root)).map((finding) => finding.code)).toContain(
      'packaged-skill-drift',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity fails when the hash manifest drifts', async () => {
  const root = await copiedAdapterRoot();
  try {
    const manifestPath = join(root, 'plugins/claude-code/skill-hashes.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.skills[0].canonical_sha256 = 'sha256:stale';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect((await checkSkillParity(root)).map((finding) => finding.code)).toContain(
      'manifest-hash',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity fails on packaged-only skills, duplicate hashes, and unsupported preludes', async () => {
  const root = await copiedAdapterRoot();
  try {
    await mkdir(join(root, 'plugins/claude-code/skills/host-only'), { recursive: true });
    await mkdir(join(root, 'plugins/claude-code/skills/harness-health/nested'), {
      recursive: true,
    });
    await writeFile(
      join(root, 'plugins/claude-code/skills/host-only/SKILL.md'),
      '---\nname: host-only\ndescription: Use when testing.\n---\n# Host-only\n',
    );
    await writeFile(join(root, 'plugins/claude-code/skills/harness-health/NOTES.md'), 'extra\n');
    await writeFile(
      join(root, 'target-skill.md'),
      await readFile(join(root, 'skills/harness-profile/SKILL.md'), 'utf8'),
    );
    await rm(join(root, 'plugins/claude-code/skills/harness-profile/SKILL.md'));
    await symlink(
      join(root, 'target-skill.md'),
      join(root, 'plugins/claude-code/skills/harness-profile/SKILL.md'),
    );
    const manifestPath = join(root, 'plugins/claude-code/skill-hashes.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.skills.push({ ...manifest.skills[0] });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(
      join(root, 'plugins/claude-code/skills/harness-doctor/SKILL.md'),
      (
        await readFile(join(root, 'plugins/claude-code/skills/harness-doctor/SKILL.md'), 'utf8')
      ).replace('description:', " 'allowed-tools' : Bash\ndescription:"),
    );

    const codes = (await checkSkillParity(root)).map((finding) => finding.code);
    expect(codes).toContain('packaged-extra-skill');
    expect(codes).toContain('manifest-duplicate-skill');
    expect(codes).toContain('claude-prelude');
    expect(codes).toContain('packaged-unexpected-file');
    expect(codes).toContain('packaged-symlink');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hook safety passes inert docs and fails executable hook writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-hook-safety-'));
  try {
    await mkdir(join(root, 'plugins/example/hooks'), { recursive: true });
    await writeFile(
      join(root, 'plugins/example/hooks/README.md'),
      'fs.writeFileSync is inert here.\n',
    );
    await writeFile(
      join(root, 'plugins/example/hooks/safe.ts'),
      "const match = /ok/.exec('ok');\nprocess.stdout.write(match?.[0] ?? '');\n",
    );
    expect(await checkHookSafety(root)).toEqual([]);

    await writeFile(
      join(root, 'plugins/example/hooks/bad.ts'),
      "import { writeFileSync } from 'node:fs';\nwriteFileSync('.harness/outputs/x.json', '{}');\n",
    );
    const ruleIds = (await checkHookSafety(root)).map((finding) => finding.ruleId);
    expect(ruleIds).toContain('filesystem-write');
    expect(ruleIds).toContain('generated-output-path');

    await writeFile(
      join(root, 'plugins/example/hooks/process.ts'),
      "import { spawn } from 'node:child_process';\nimport { runInNewContext, Script } from 'node:vm';\nspawn('git');\nawait Bun.$`git status`;\nDeno.run({ cmd: ['git'] });\nnew Function('return 1');\nvm.runInNewContext('1');\nrunInNewContext('1');\nnew Script('1');\n",
    );
    await writeFile(
      join(root, 'plugins/example/hooks/python-process.py'),
      "from os import system\nsystem('git status')\n",
    );
    await writeFile(
      join(root, 'plugins/example/hooks/network.ts'),
      "import { request } from 'node:https';\nimport { connect } from 'node:net';\nawait fetch('https://example.com');\nhttp.get('https://example.com');\nhttp2.connect('https://example.com');\nnet.connect(443, 'example.com');\ntls.connect(443, 'example.com');\nrequest('https://example.com');\nconnect(443, 'example.com');\nurllib.request.urlopen('https://example.com')\n",
    );
    await writeFile(
      join(root, 'plugins/example/hooks/python-network.py'),
      "from requests import get\nfrom urllib import request\nget('https://example.com')\nrequest.urlopen('https://example.com')\n",
    );
    await writeFile(
      join(root, 'plugins/example/hooks/bun-write.ts'),
      "import { open } from 'node:fs/promises';\nimport { write, writeSync } from 'node:fs';\nawait open('x', 'w');\nopenSync('x', 'w');\nwrite(fd, buffer);\nwriteSync(fd, buffer);\nfs.writeSync(fd, buffer);\nawait fs.promises.write(fd, buffer);\nawait fs.cp('a', 'b');\nfs.cpSync('a', 'b');\nawait fs.promises.cp('a', 'b');\nfs.rmdirSync('x');\nawait fs.promises.rmdir('x');\nfs.truncateSync('x');\nawait fs.promises.truncate('x');\nfs.symlinkSync('a', 'b');\nawait fs.promises.symlink('a', 'b');\nfs.linkSync('a', 'b');\nawait fs.promises.link('a', 'b');\nfs.mkdtempSync('x');\nawait fs.promises.mkdtemp('x');\nawait Bun.write('x', 'y');\nDeno.writeTextFileSync('x', 'y');\nawait Deno.open('x', { write: true });\nawait Deno.open('x', { append: true });\nawait Deno.open('x', { truncate: true });\nDeno.openSync('x', { write: true });\nawait Deno.create('x');\nDeno.createSync('x');\nawait Deno.truncate('x');\nDeno.truncateSync('x');\nawait Deno.makeTempFile();\nDeno.makeTempDirSync();\n",
    );
    await writeFile(
      join(root, 'plugins/example/hooks/python-write.py'),
      "from os import open as os_open, write, ftruncate\nopen('x', 'w').write('y')\nopen(os.path.join('x', 'y'), 'w')\nopen('x', mode=\"w\")\nopen('x', 'wb')\nopen('x', encoding='utf8', mode='w')\nopen('x', 'r+')\nopen('x', 'rb+')\nos_open('x', os.O_WRONLY)\nopen('x', os.O_WRONLY | os.O_CREAT)\nwrite(fd, b'x')\nftruncate(fd, 0)\nPath('x').write_text('y')\np.write_text('y')\nPath('x').touch()\np.touch()\nPath('x').open('w')\nPath('x').open('rb+')\nPath('x').open(mode=\"w\")\nPath('x').open(mode='r+')\nos.open('x', os.O_WRONLY | os.O_CREAT)\nos.write(fd, b'x')\nos.ftruncate(fd, 0)\nos.remove('x')\nos.makedirs('x')\nos.symlink('a', 'b')\nos.link('a', 'b')\ntempfile.NamedTemporaryFile()\ntempfile.mkdtemp()\nshutil.copyfile('a', 'b')\n",
    );
    await writeFile(
      join(root, 'plugins/example/hooks/write.sh'),
      'echo ok > tmp.txt\ncurl example.com\n',
    );
    await writeFile(join(root, 'target.ts'), 'console.log("target");\n');
    await symlink(join(root, 'target.ts'), join(root, 'plugins/example/hooks/link.ts'));
    await mkdir(join(root, 'plugins/symlinked'), { recursive: true });
    await mkdir(join(root, 'unsafe-hooks'));
    await writeFile(join(root, 'unsafe-hooks/bad.ts'), "await fetch('https://example.com');\n");
    await symlink(join(root, 'unsafe-hooks'), join(root, 'plugins/symlinked/hooks'));
    await mkdir(join(root, 'unsafe-plugin/hooks'), { recursive: true });
    await writeFile(
      join(root, 'unsafe-plugin/hooks/bad.ts'),
      "await fetch('https://example.com');\n",
    );
    await symlink(join(root, 'unsafe-plugin'), join(root, 'plugins/plugin-link'));
    const expandedRuleIds = (await checkHookSafety(root)).map((finding) => finding.ruleId);
    expect(expandedRuleIds).toContain('child-process');
    expect(expandedRuleIds).toContain('network-command');
    expect(expandedRuleIds).toContain('shell-write');
    expect(expandedRuleIds).toContain('hook-symlink');
    expect(expandedRuleIds).toContain('plugin-symlink');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hook safety catches multiline write-capable calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-hook-safety-multiline-'));
  try {
    await mkdir(join(root, 'plugins/example/hooks'), { recursive: true });
    await writeFile(
      join(root, 'plugins/example/hooks/deno.ts'),
      "await Deno.open(\n  resolvePath('x'),\n  { append: true }\n);\n",
    );
    await writeFile(
      join(root, 'plugins/example/hooks/python.py'),
      "open(\n  'x',\n  'rb+'\n)\nPath('x').open(\n  mode='w'\n)\n",
    );

    const filesystemWriteFindings = (await checkHookSafety(root)).filter(
      (finding) => finding.ruleId === 'filesystem-write',
    );
    expect(filesystemWriteFindings.length).toBeGreaterThanOrEqual(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function copiedAdapterRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'harness-plugin-parity-'));
  await cp('skills', join(root, 'skills'), { recursive: true });
  await cp('plugins', join(root, 'plugins'), { recursive: true });
  return root;
}
