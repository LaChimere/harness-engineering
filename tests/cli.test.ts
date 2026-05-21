import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../src/cli.ts';
import { ExitCode } from '../src/lib/exit-codes.ts';

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const tempRoots: string[] = [];

afterEach(async () => {
  const roots = tempRoots.splice(0, tempRoots.length);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test('init creates a baseline that validate accepts without plugin or CI keys', async () => {
  const root = await tempRoot();

  const initResult = await run(['init'], root);
  expect(initResult.code).toBe(ExitCode.ok);
  expect(initResult.stdout).toContain('harness init ok');

  const validateResult = await run(['validate'], root);
  expect(validateResult.code).toBe(ExitCode.ok);
  expect(validateResult.stdout).toContain('harness validate ok: harness.yaml');

  const harness = await readFile(join(root, 'harness.yaml'), 'utf8');
  expect(harness).not.toContain('plugins:');
  expect(harness).not.toContain('ci:');
});

test('init rejects root paths that escape the current working directory', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);

  const result = await run(['init', '--root', '../escape'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('--root escapes root');
});

test('init rejects existing starter files unless force is passed', async () => {
  const root = await tempRoot();
  await writeFile(join(root, 'harness.yaml'), 'existing: true\n');

  const result = await run(['init'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Refusing to overwrite existing harness starter files');
});

test('init force overwrites managed starter files', async () => {
  const root = await tempRoot();
  await writeFile(join(root, 'harness.yaml'), 'existing: true\n');

  const result = await run(['init', '--force'], root);
  expect(result.code).toBe(ExitCode.ok);
  const harness = await readFile(join(root, 'harness.yaml'), 'utf8');
  expect(harness).toContain('schema_version: "0.1.0"');
});

test('init force refuses to write through symlinked starter paths', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  const sensitive = join(parent, 'sensitive');
  await mkdir(root);
  await mkdir(sensitive);
  await symlink(sensitive, join(root, 'examples'), 'dir');

  const result = await run(['init', '--force'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Refusing to write through symlink');
});

test('validate rejects schema-invalid harness files with validation exit semantics', async () => {
  const root = await tempRoot();
  await writeFile(join(root, 'harness.yaml'), 'schema_version: "0.1.0"\n');

  const result = await run(['validate'], root);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('harness validate failed');
  expect(result.stdout).toContain('schema:');
});

test('validate reports malformed YAML as a validation error', async () => {
  const root = await tempRoot();
  await writeFile(join(root, 'harness.yaml'), 'schema_version: [unterminated\n');

  const result = await run(['validate'], root);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stderr).toContain('Could not parse');
});

test('validate rejects plugin adapter keys at the harness root', async () => {
  const result = await run([
    'validate',
    '--file',
    'examples/fixtures/invalid/harness-with-plugin-key.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('unevaluatedProperties');
});

test('validate rejects incompatible CLI engine ranges distinctly', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const harnessPath = join(root, 'harness.yaml');
  const harness = await readFile(harnessPath, 'utf8');
  await writeFile(harnessPath, harness.replace('cli: ">=0.1 <0.2"', 'cli: ">=0.2 <0.3"'));

  const result = await run(['validate'], root);
  expect(result.code).toBe(ExitCode.incompatibleEngines);
  expect(result.stdout).toContain('harness validate incompatible');
});

test('validate can inspect an explicit root outside the current working directory', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const result = await run(['validate', '--root', root]);
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain('harness validate ok');
});

test('validate rejects user-provided paths that escape root', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);
  await writeFile(join(parent, 'outside.yaml'), 'schema_version: "0.1.0"\n');

  const result = await run(['validate', '--file', '../outside.yaml'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Harness file escapes root');
});

test('validate rejects composed references that escape root', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);
  await run(['init'], root);
  await writeFile(join(parent, 'outside.yaml'), 'schema_version: "0.1.0"\n');
  const harnessPath = join(root, 'harness.yaml');
  const harness = await readFile(harnessPath, 'utf8');
  await writeFile(
    harnessPath,
    harness.replace(
      'environment: examples/environments/local.yaml',
      'environment: ../outside.yaml',
    ),
  );

  const result = await run(['validate'], root);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('environment escapes root');
});

test('verify consumes explicit verification evidence without requiring harness.yaml', async () => {
  const result = await run(['verify', '--spec', 'tests/fixtures/verification-failed.yaml']);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('harness verify failed');
  expect(result.stdout).toContain('scope: consumed explicit self-verification evidence only');
  expect(result.stderr).toBe('');
});

test('verify treats blocked acceptance checks as validation failures', async () => {
  const result = await run(['verify', '--spec', 'tests/fixtures/verification-blocked.yaml']);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('0 passed, 0 failed, 1 blocked');
});

test('verify does not execute checks or require harness structure', async () => {
  const root = await tempRoot();
  const spec = await readFile('tests/fixtures/verification-with-unexecuted-check.yaml', 'utf8');
  await writeFile(join(root, 'verification.yaml'), spec);

  const result = await run(['verify', '--spec', 'verification.yaml'], root);
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain('1 passed, 0 failed, 0 blocked');
  expect(result.stderr).toBe('');
});

test('migrate emits provisional no-op evidence', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const result = await run(['migrate'], root);
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain('kind: migration-evidence');
  expect(result.stdout).toContain('stability: provisional');
  expect(result.stdout).toContain('would_change: false');
});

test('migrate rejects apply mode during the Stage 3 no-op phase', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const result = await run(['migrate', '--apply'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Stage 3 migrate only supports dry-run/no-op evidence');
});

test('migrate rejects output paths that escape root', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);
  await run(['init'], root);

  const result = await run(['migrate', '--output', '../evidence.yaml'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Migration output escapes root');
});

test('migrate refuses to write output through symlinks', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  const sensitive = join(parent, 'sensitive');
  await mkdir(root);
  await mkdir(sensitive);
  await run(['init'], root);
  await symlink(join(sensitive, 'evidence.yaml'), join(root, 'evidence-link.yaml'));

  const result = await run(['migrate', '--output', 'evidence-link.yaml'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Refusing to write through symlink');
});

test('report cites the artifact paths it summarizes', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const expectedReportPrefix = await readFile('tests/fixtures/expected-report.txt', 'utf8');

  const result = await run(['report'], root);
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain(expectedReportPrefix.trimEnd());
  expect(result.stdout).toContain('- cited paths:');
  expect(result.stdout).toContain('  - harness.yaml');
});

test('usage and missing input errors use stable exit codes', async () => {
  const unknown = await run(['unknown']);
  expect(unknown.code).toBe(ExitCode.usageError);
  expect(unknown.stderr).toContain('Unknown command');

  const missing = await run(['validate'], await tempRoot());
  expect(missing.code).toBe(ExitCode.notFound);
  expect(missing.stderr).toContain('Harness file not found');
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'harness-cli-test-'));
  tempRoots.push(root);
  return root;
}

async function run(args: readonly string[], cwd = process.cwd()): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    cwd,
    stdout(message) {
      stdout.push(message);
    },
    stderr(message) {
      stderr.push(message);
    },
  });
  return {
    code,
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
  };
}
