import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkHookSafety } from '../../scripts/check-hook-safety.ts';
import { checkPluginManifests } from '../../scripts/check-plugin-manifests.ts';
import { checkSkillParity } from '../../scripts/check-skill-parity.ts';

test('packaged adapter skills match canonical skill bodies and hashes', async () => {
  expect(await checkSkillParity(process.cwd())).toEqual([]);
});

test('skill parity rejects symlinked canonical skills root', async () => {
  const root = await copiedAdapterRoot();
  try {
    await rm(join(root, 'skills'), { recursive: true, force: true });
    await mkdir(join(root, 'unsafe-skills'), { recursive: true });
    await symlink(join(root, 'unsafe-skills'), join(root, 'skills'));

    expect(
      (await checkSkillParity(root)).some(
        (finding) => finding.code === 'canonical-read' && finding.path === 'skills',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
    manifest.schema_version = '0.2.0';
    manifest.host = 'other-host';
    manifest.normalization = 'other-normalization';
    manifest.skills[0].canonical_path = 'skills/stale/SKILL.md';
    manifest.skills[0].packaged_path = 'plugins/claude-code/skills/stale/SKILL.md';
    manifest.skills[0].canonical_sha256 = 'sha256:stale';
    manifest.skills.push(
      JSON.parse(`{
      "id": "host-only",
      "canonical_path": "skills/host-only/SKILL.md",
      "packaged_path": "plugins/claude-code/skills/host-only/SKILL.md",
      "canonical_sha256": "sha256:extra",
      "packaged_normalized_sha256": "sha256:extra"
    }`),
    );
    manifest.skills = manifest.skills.filter(
      (record: { id: string }) => record.id !== 'harness-profile',
    );
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const findings = await checkSkillParity(root);
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain('manifest-schema-version');
    expect(codes).toContain('manifest-host');
    expect(codes).toContain('manifest-normalization');
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-path' &&
          finding.message === 'harness-assess canonical_path is stale.',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-path' &&
          finding.message === 'harness-assess packaged_path is stale.',
      ),
    ).toBe(true);
    expect(codes).toContain('manifest-hash');
    expect(codes).toContain('manifest-extra-skill');
    expect(codes).toContain('manifest-missing-skill');
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
    expect(codes).toContain('host-prelude');
    expect(codes).toContain('packaged-unexpected-file');
    expect(codes).toContain('packaged-symlink');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity rejects host prelude safety drift', async () => {
  const root = await copiedAdapterRoot();
  try {
    const copilotDoctorPath = join(root, 'plugins/copilot-cli/skills/harness-doctor/SKILL.md');
    await writeFile(
      copilotDoctorPath,
      (await readFile(copilotDoctorPath, 'utf8')).replace(
        'name: harness-doctor',
        'name: harness-health',
      ),
    );
    const claudeHealthPath = join(root, 'plugins/claude-code/skills/harness-health/SKILL.md');
    await writeFile(
      claudeHealthPath,
      (await readFile(claudeHealthPath, 'utf8')).replace('disable-model-invocation: true\n', ''),
    );
    const claudeDoctorPath = join(root, 'plugins/claude-code/skills/harness-doctor/SKILL.md');
    await writeFile(
      claudeDoctorPath,
      (await readFile(claudeDoctorPath, 'utf8')).replace(
        'description: Run and interpret harness doctor structural inspection. Use when structural harness inspection or reference validation is needed.\n',
        'description: Run and interpret harness doctor structural inspection. Use when structural harness inspection or reference validation is needed.\ndisable-model-invocation: true\n',
      ),
    );

    const findings = await checkSkillParity(root);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'host-prelude' &&
          finding.path === 'plugins/copilot-cli/skills/harness-doctor/SKILL.md' &&
          finding.message === 'copilot-cli packaged skill prelude name must be harness-doctor.',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'host-prelude' &&
          finding.path === 'plugins/claude-code/skills/harness-health/SKILL.md' &&
          finding.message === 'harness-health must disable model invocation in Claude metadata.',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'host-prelude' &&
          finding.path === 'plugins/claude-code/skills/harness-doctor/SKILL.md' &&
          finding.message === 'harness-doctor must not add host-specific invocation restrictions.',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity fails when Codex invocation policy drifts', async () => {
  const root = await copiedAdapterRoot();
  try {
    await writeFile(
      join(root, 'plugins/codex/skills/harness-health/agents/openai.yaml'),
      'schema_version: 0.1.0\npolicy:\n  allow_implicit_invocation: true\n',
    );
    expect((await checkSkillParity(root)).map((finding) => finding.code)).toContain('codex-policy');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity fails when Codex user-or-model policy drifts', async () => {
  const root = await copiedAdapterRoot();
  try {
    await writeFile(
      join(root, 'plugins/codex/skills/harness-doctor/agents/openai.yaml'),
      'schema_version: 0.1.0\npolicy:\n  allow_implicit_invocation: false\n',
    );
    expect((await checkSkillParity(root)).map((finding) => finding.code)).toContain('codex-policy');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity fails when Codex policy adds unsupported top-level keys', async () => {
  const root = await copiedAdapterRoot();
  try {
    await writeFile(
      join(root, 'plugins/codex/skills/harness-doctor/agents/openai.yaml'),
      'schema_version: 0.1.0\npolicy:\n  allow_implicit_invocation: true\nunsupported: true\n',
    );
    expect((await checkSkillParity(root)).map((finding) => finding.code)).toContain(
      'codex-policy-key',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity fails when Codex policy YAML is malformed', async () => {
  const root = await copiedAdapterRoot();
  try {
    await writeFile(
      join(root, 'plugins/codex/skills/harness-doctor/agents/openai.yaml'),
      'schema_version: "0.1.0\npolicy:\n  allow_implicit_invocation: true\n',
    );

    expect((await checkSkillParity(root)).map((finding) => finding.code)).toContain(
      'codex-policy-read',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity fails when Codex policy object is missing', async () => {
  const root = await copiedAdapterRoot();
  try {
    await writeFile(
      join(root, 'plugins/codex/skills/harness-doctor/agents/openai.yaml'),
      'schema_version: 0.1.0\npolicy: true\n',
    );

    expect((await checkSkillParity(root)).map((finding) => finding.code)).toContain(
      'codex-policy-shape',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity fails when Codex policy schema or nested keys drift', async () => {
  const root = await copiedAdapterRoot();
  try {
    await writeFile(
      join(root, 'plugins/codex/skills/harness-doctor/agents/openai.yaml'),
      'schema_version: 0.2.0\npolicy:\n  allow_implicit_invocation: true\n  unsupported: true\n',
    );

    const findings = await checkSkillParity(root);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'codex-policy-schema' &&
          finding.path === 'plugins/codex/skills/harness-doctor/agents/openai.yaml',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'codex-policy-key' &&
          finding.path === 'plugins/codex/skills/harness-doctor/agents/openai.yaml',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity fails when canonical invocation policy is invalid', async () => {
  const root = await copiedAdapterRoot();
  try {
    const skillPath = join(root, 'skills/harness-health/SKILL.md');
    await writeFile(
      skillPath,
      (await readFile(skillPath, 'utf8')).replace(
        'invocation_policy: explicit-user-intent',
        'invocation_policy: typo',
      ),
    );
    expect((await checkSkillParity(root)).map((finding) => finding.code)).toContain(
      'canonical-policy',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity rejects malformed host and canonical frontmatter', async () => {
  const root = await copiedAdapterRoot();
  try {
    const packagedPath = join(root, 'plugins/copilot-cli/skills/harness-doctor/SKILL.md');
    await writeFile(
      packagedPath,
      (await readFile(packagedPath, 'utf8')).replace(
        'description: Use when inspecting harness.yaml and schema structure with deterministic doctor evidence.',
        'description: "Use when inspecting harness.yaml',
      ),
    );
    const canonicalPath = join(root, 'skills/harness-health/SKILL.md');
    await writeFile(
      canonicalPath,
      (await readFile(canonicalPath, 'utf8')).replace(
        'invocation_policy: explicit-user-intent',
        'invocation_policy: "user-or-model',
      ),
    );

    const findings = await checkSkillParity(root);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'host-prelude' &&
          finding.path === 'plugins/copilot-cli/skills/harness-doctor/SKILL.md',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'canonical-policy' && finding.path === 'skills/harness-health/SKILL.md',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'canonical-policy' &&
          finding.path === 'skills/harness-health/SKILL.md' &&
          finding.message !== 'harness-health is missing canonical invocation_policy.',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity rejects unreviewed LLM-facing prelude descriptions', async () => {
  const root = await copiedAdapterRoot();
  try {
    const packagedPath = join(root, 'plugins/copilot-cli/skills/harness-doctor/SKILL.md');
    await writeFile(
      packagedPath,
      (await readFile(packagedPath, 'utf8')).replace(
        'description: Use when inspecting harness.yaml and schema structure with deterministic doctor evidence.',
        'description: Use when running health checks automatically.',
      ),
    );

    expect(
      (await checkSkillParity(root)).some(
        (finding) =>
          finding.code === 'host-prelude' &&
          finding.path === 'plugins/copilot-cli/skills/harness-doctor/SKILL.md',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity rejects inverted health host metadata and YAML alias errors', async () => {
  const root = await copiedAdapterRoot();
  try {
    const packagedPath = join(root, 'plugins/gemini-cli/skills/harness-health/SKILL.md');
    await writeFile(
      packagedPath,
      (await readFile(packagedPath, 'utf8')).replace(
        'Use only when the user explicitly asks to run declared harness health checks for a local project.',
        'Use when explicit automation should run harness health checks without waiting for user intent.',
      ),
    );
    const canonicalPath = join(root, 'skills/harness-health/SKILL.md');
    await writeFile(
      canonicalPath,
      (await readFile(canonicalPath, 'utf8')).replace(
        'invocation_policy: explicit-user-intent',
        'invocation_policy: *missing',
      ),
    );

    const findings = await checkSkillParity(root);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'host-prelude' &&
          finding.path === 'plugins/gemini-cli/skills/harness-health/SKILL.md',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'canonical-policy' && finding.path === 'skills/harness-health/SKILL.md',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity validates new host packages', async () => {
  const root = await copiedAdapterRoot();
  try {
    await writeFile(
      join(root, 'plugins/codex/skills/harness-doctor/SKILL.md'),
      `${await readFile(join(root, 'plugins/codex/skills/harness-doctor/SKILL.md'), 'utf8')}\nDrift.\n`,
    );
    await writeFile(
      join(root, 'plugins/copilot-cli/skills/harness-doctor/SKILL.md'),
      `${await readFile(join(root, 'plugins/copilot-cli/skills/harness-doctor/SKILL.md'), 'utf8')}\nDrift.\n`,
    );
    const manifestPath = join(root, 'plugins/gemini-cli/skill-hashes.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.skills[0].packaged_normalized_sha256 = 'sha256:stale';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const findings = await checkSkillParity(root);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'packaged-skill-drift' &&
          finding.path === 'plugins/codex/skills/harness-doctor/SKILL.md',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'packaged-skill-drift' &&
          finding.path === 'plugins/copilot-cli/skills/harness-doctor/SKILL.md',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-hash' &&
          finding.path === 'plugins/gemini-cli/skill-hashes.json',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity rejects new-host packaged extras and symlinks', async () => {
  const root = await copiedAdapterRoot();
  try {
    await mkdir(join(root, 'plugins/codex/skills/host-only'), { recursive: true });
    await rm(join(root, 'plugins/codex/skills/harness-doctor'), { recursive: true, force: true });
    await symlink(
      join(root, 'skills/harness-doctor'),
      join(root, 'plugins/codex/skills/harness-doctor'),
    );
    await writeFile(
      join(root, 'plugins/codex/skills/host-only/SKILL.md'),
      '---\nname: host-only\ndescription: Use when testing.\n---\n# Host-only\n',
    );
    await writeFile(join(root, 'plugins/copilot-cli/skills/harness-health/NOTES.md'), 'extra\n');
    await writeFile(
      join(root, 'target-skill.md'),
      await readFile(join(root, 'skills/harness-profile/SKILL.md'), 'utf8'),
    );
    await rm(join(root, 'plugins/gemini-cli/skills/harness-profile/SKILL.md'));
    await symlink(
      join(root, 'target-skill.md'),
      join(root, 'plugins/gemini-cli/skills/harness-profile/SKILL.md'),
    );

    const codes = (await checkSkillParity(root)).map((finding) => finding.code);
    expect(codes).toContain('packaged-extra-skill');
    expect(codes).toContain('packaged-unexpected-file');
    expect(codes).toContain('packaged-symlink');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skill parity rejects directory-only packaged extras', async () => {
  const root = await copiedAdapterRoot();
  try {
    await mkdir(join(root, 'plugins/gemini-cli/skills/harness-doctor/nested-extra'), {
      recursive: true,
    });

    expect(
      (await checkSkillParity(root)).some(
        (finding) =>
          finding.code === 'packaged-unexpected-file' &&
          finding.path === 'plugins/gemini-cli/skills/harness-doctor/nested-extra',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin manifest check validates host manifest paths', async () => {
  const root = await copiedAdapterRoot();
  try {
    expect(await checkPluginManifests(root)).toEqual([]);

    const claudeManifestPath = join(root, 'plugins/claude-code/.claude-plugin/plugin.json');
    const claudeManifest = JSON.parse(await readFile(claudeManifestPath, 'utf8'));
    delete claudeManifest.version;
    await writeFile(claudeManifestPath, `${JSON.stringify(claudeManifest, null, 2)}\n`);

    const manifestPath = join(root, 'plugins/copilot-cli/plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.name = 'other';
    delete manifest.version;
    manifest.skills = 'missing-skills/';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const findings = await checkPluginManifests(root);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-field' &&
          finding.path === 'plugins/claude-code/.claude-plugin/plugin.json',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-name' && finding.path === 'plugins/copilot-cli/plugin.json',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-path' && finding.path === 'plugins/copilot-cli/plugin.json',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin manifest check validates Codex marketplace metadata', async () => {
  const root = await copiedAdapterRoot();
  try {
    const marketplacePath = join(root, '.agents/plugins/marketplace.json');
    const marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
    marketplace.name = 'other';
    marketplace.plugins[0].category = 'Other';
    marketplace.plugins[0].source.path = './plugins/missing';
    marketplace.plugins[0].policy.installation = 'NOT_AVAILABLE';
    marketplace.plugins[0].policy.authentication = 'NEVER';
    await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);

    const findings = await checkPluginManifests(root);
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain('marketplace-name');
    expect(codes).toContain('marketplace-category');
    expect(codes).toContain('marketplace-source');
    expect(
      findings.some(
        (finding) =>
          finding.code === 'marketplace-policy' &&
          finding.message === 'Codex plugin policy must be AVAILABLE and ON_INSTALL.',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin manifest check validates Codex marketplace authentication policy', async () => {
  const root = await copiedAdapterRoot();
  try {
    const marketplacePath = join(root, '.agents/plugins/marketplace.json');
    const marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
    marketplace.plugins[0].policy.authentication = 'NEVER';
    await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);

    expect(
      (await checkPluginManifests(root)).some(
        (finding) =>
          finding.code === 'marketplace-policy' &&
          finding.message === 'Codex plugin policy must be AVAILABLE and ON_INSTALL.',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin manifest check rejects malformed marketplace entries', async () => {
  const root = await copiedAdapterRoot();
  try {
    const marketplacePath = join(root, '.agents/plugins/marketplace.json');
    const marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
    marketplace.plugins.unshift(null);
    await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);

    expect((await checkPluginManifests(root)).map((finding) => finding.code)).toContain(
      'marketplace-plugin',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin manifest check rejects symlinked marketplace parents', async () => {
  const root = await copiedAdapterRoot();
  try {
    await rm(join(root, '.agents/plugins'), { recursive: true, force: true });
    await mkdir(join(root, 'unsafe-marketplace'), { recursive: true });
    await writeFile(join(root, 'unsafe-marketplace/marketplace.json'), '{}\n');
    await symlink(join(root, 'unsafe-marketplace'), join(root, '.agents/plugins'));

    expect(
      (await checkPluginManifests(root)).some(
        (finding) =>
          finding.code === 'marketplace-read' &&
          finding.path === '.agents/plugins/marketplace.json',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin manifest check validates host manifest targets', async () => {
  const root = await copiedAdapterRoot();
  try {
    await rm(join(root, 'plugins/codex/skills'), { recursive: true, force: true });
    await writeFile(join(root, 'plugins/codex/skills'), 'not a directory\n');
    await rm(join(root, 'plugins/gemini-cli/GEMINI.md'));
    await symlink(join(root, 'skills/README.md'), join(root, 'plugins/gemini-cli/GEMINI.md'));
    await rm(join(root, 'plugins/copilot-cli/skills'), { recursive: true, force: true });
    await symlink(join(root, 'skills'), join(root, 'plugins/copilot-cli/skills'));

    const findings = await checkPluginManifests(root);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-path-target' &&
          finding.path === 'plugins/codex/.codex-plugin/plugin.json',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-path-target' &&
          finding.path === 'plugins/gemini-cli/gemini-extension.json',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-path-target' &&
          finding.path === 'plugins/copilot-cli/plugin.json',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin manifest check reports missing host manifest targets', async () => {
  const root = await copiedAdapterRoot();
  try {
    await rm(join(root, 'plugins/copilot-cli/agents'), { recursive: true, force: true });

    const findings = await checkPluginManifests(root);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-path-target' &&
          finding.path === 'plugins/copilot-cli/plugin.json' &&
          finding.message.includes('missing'),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin manifest check preserves host policy guidance', async () => {
  const root = await copiedAdapterRoot();
  try {
    await writeFile(
      join(root, 'plugins/copilot-cli/agents/harness.agent.md'),
      'Run harness health --accept-unsandboxed-execution --format json without explicit approval. Elsewhere only when the user explicitly asks for declared local health checks.\n',
    );
    await writeFile(
      join(root, 'plugins/gemini-cli/GEMINI.md'),
      "Run harness health --accept-unsandboxed-execution --format json and don't ask before running it. Elsewhere only when the user explicitly asks for declared local health checks.\n",
    );

    const findings = await checkPluginManifests(root);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-guidance' &&
          finding.path === 'plugins/copilot-cli/agents/harness.agent.md',
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.code === 'manifest-guidance' && finding.path === 'plugins/gemini-cli/GEMINI.md',
      ),
    ).toBe(true);

    await rm(join(root, 'plugins/copilot-cli/agents/harness.agent.md'));
    await symlink(
      join(root, 'plugins/gemini-cli/GEMINI.md'),
      join(root, 'plugins/copilot-cli/agents/harness.agent.md'),
    );
    expect(
      (await checkPluginManifests(root)).some(
        (finding) =>
          finding.code === 'manifest-guidance-read' &&
          finding.path === 'plugins/copilot-cli/agents/harness.agent.md',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin manifest check rejects distant health guidance', async () => {
  const root = await copiedAdapterRoot();
  try {
    await writeFile(
      join(root, 'plugins/copilot-cli/agents/harness.agent.md'),
      'Run harness health --accept-unsandboxed-execution --format json.\n\nUse this command only when the user explicitly asks for declared local health checks.\n',
    );

    expect(
      (await checkPluginManifests(root)).some(
        (finding) =>
          finding.code === 'manifest-guidance' &&
          finding.path === 'plugins/copilot-cli/agents/harness.agent.md',
      ),
    ).toBe(true);
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
    await writeFile(join(root, 'plugins/example/hooks/bad.js'), "fs.writeFileSync('x', 'y');\n");
    await writeFile(
      join(root, 'plugins/example/hooks/bad.mjs'),
      "await fetch('https://example.com');\n",
    );
    await writeFile(
      join(root, 'plugins/example/hooks/bad.cjs'),
      "require('node:fs').writeFileSync('x', 'y');\n",
    );
    const ruleIds = (await checkHookSafety(root)).map((finding) => finding.ruleId);
    expect(ruleIds).toContain('filesystem-write');
    expect(ruleIds).toContain('generated-output-path');
    const findings = await checkHookSafety(root);
    expect(findings.some((finding) => finding.path === 'plugins/example/hooks/bad.js')).toBe(true);
    expect(findings.some((finding) => finding.path === 'plugins/example/hooks/bad.mjs')).toBe(true);
    expect(findings.some((finding) => finding.path === 'plugins/example/hooks/bad.cjs')).toBe(true);

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
    const expandedFindings = await checkHookSafety(root);
    const expandedRuleIds = expandedFindings.map((finding) => finding.ruleId);
    expect(expandedRuleIds).toContain('child-process');
    expect(expandedRuleIds).toContain('network-command');
    expect(expandedRuleIds).toContain('shell-write');
    expect(expandedRuleIds).toContain('hook-symlink');
    expect(expandedRuleIds).toContain('plugin-symlink');
    expect(
      expandedFindings.some(
        (finding) =>
          finding.ruleId === 'child-process' &&
          finding.path === 'plugins/example/hooks/python-process.py',
      ),
    ).toBe(true);
    expect(
      expandedFindings.some(
        (finding) =>
          finding.ruleId === 'network-command' &&
          finding.path === 'plugins/example/hooks/python-network.py',
      ),
    ).toBe(true);
    expect(
      expandedFindings.some(
        (finding) =>
          finding.ruleId === 'filesystem-write' &&
          finding.path === 'plugins/example/hooks/bun-write.ts',
      ),
    ).toBe(true);
    expect(
      expandedFindings.some(
        (finding) =>
          finding.ruleId === 'shell-write' && finding.path === 'plugins/example/hooks/write.sh',
      ),
    ).toBe(true);
    expect(
      expandedFindings.some(
        (finding) => finding.ruleId === 'plugin-symlink' && finding.path === 'plugins/plugin-link',
      ),
    ).toBe(true);
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
  await cp('.agents', join(root, '.agents'), { recursive: true });
  await cp('skills', join(root, 'skills'), { recursive: true });
  await cp('plugins', join(root, 'plugins'), { recursive: true });
  return root;
}
