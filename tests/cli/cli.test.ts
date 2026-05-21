import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../src/cli.ts';
import { ExitCode } from '../../src/lib/exit-codes.ts';
import { getArray, getObject, getString, isObject, type JsonObject } from '../../src/lib/json.ts';
import { loadSchemaRegistry } from '../../src/lib/schema-registry.ts';

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
  const result = await run(['verify', '--spec', 'tests/cli/fixtures/verification-failed.yaml']);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('harness verify failed');
  expect(result.stdout).toContain('scope: consumed explicit self-verification evidence only');
  expect(result.stderr).toBe('');
});

test('verify treats blocked acceptance checks as validation failures', async () => {
  const result = await run(['verify', '--spec', 'tests/cli/fixtures/verification-blocked.yaml']);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('0 passed, 0 failed, 1 blocked');
});

test('verify does not execute checks or require harness structure', async () => {
  const root = await tempRoot();
  const spec = await readFile('tests/cli/fixtures/verification-with-unexecuted-check.yaml', 'utf8');
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

test('doctor emits schema-valid JSON for a healthy harness', async () => {
  const result = await run(['doctor', '--format', 'json', '--file', 'examples/harness.yaml']);
  expect(result.code).toBe(ExitCode.ok);
  const doctorResult = JSON.parse(result.stdout);
  expect(doctorResult.status).toBe('passed');
  expect(checkOutcome(doctorResult, 'schema-validity')).toBe('passed');
  expect(checkOutcome(doctorResult, 'engine-compatibility')).toBe('passed');
  expect(checkOutcome(doctorResult, 'reference-exists')).toBe('passed');
  expect(checkOutcome(doctorResult, 'local-doc-link-check')).toBe('skipped');
  const localCheck = doctorCheck(doctorResult, 'local-doc-link-check');
  expect(
    localCheck === undefined ? undefined : getObject(localCheck, 'trust_requirements'),
  ).toEqual({
    trust_level: 'sandboxed',
    sandbox_required: 'process',
    network_access: false,
    secret_access: false,
    host_file_access: false,
    allowed_inputs: ['README.md', 'AGENTS.md'],
    allowed_outputs: ['.harness/doctor/doc-links.json'],
  });

  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('doctor-result', doctorResult).length).toBe(0);
});

test('doctor emits markdown by default', async () => {
  const result = await run(['doctor', '--file', 'examples/harness.yaml']);
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain('# Harness doctor report');
  expect(result.stdout).toContain(
    '| schema-validity | passed | error | No remediation required. |',
  );
  expect(result.stdout).toContain('| local-doc-link-check | skipped | info |');
});

test('doctor canonicalizes harness paths for deterministic output', async () => {
  const first = await run(['doctor', '--format', 'json', '--file', 'examples/harness.yaml']);
  const second = await run(['doctor', '--format', 'json', '--file', './examples/./harness.yaml']);
  expect(first.code).toBe(ExitCode.ok);
  expect(second.code).toBe(ExitCode.ok);
  expect(second.stdout).toBe(first.stdout);
});

test('doctor accepts explicit non-empty run ids', async () => {
  const result = await run([
    'doctor',
    '--format',
    'json',
    '--file',
    'examples/harness.yaml',
    '--run-id',
    'manual-run',
  ]);
  expect(result.code).toBe(ExitCode.ok);
  expect(JSON.parse(result.stdout).run_id).toBe('manual-run');
});

test('doctor rejects empty run ids as usage errors', async () => {
  const result = await run([
    'doctor',
    '--format',
    'json',
    '--file',
    'examples/harness.yaml',
    '--run-id=',
  ]);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('doctor --run-id must not be empty');
});

test('doctor reports reference failures without leaving validate source of truth', async () => {
  const result = await run([
    'doctor',
    '--format',
    'json',
    '--file',
    'examples/fixtures/doctor/missing-reference.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  const doctorResult = JSON.parse(result.stdout);
  expect(doctorResult.status).toBe('failed');
  expect(checkOutcome(doctorResult, 'schema-validity')).toBe('passed');
  expect(checkOutcome(doctorResult, 'reference-exists')).toBe('failed');

  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('doctor-result', doctorResult).length).toBe(0);
});

test('doctor reports incompatible engines as doctor evidence', async () => {
  const result = await run([
    'doctor',
    '--format',
    'json',
    '--file',
    'examples/fixtures/doctor/incompatible-engine.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  const doctorResult = JSON.parse(result.stdout);
  expect(doctorResult.status).toBe('failed');
  expect(checkOutcome(doctorResult, 'engine-compatibility')).toBe('failed');

  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('doctor-result', doctorResult).length).toBe(0);
});

test('doctor rejects unsupported builtin registrations deterministically', async () => {
  const result = await run([
    'doctor',
    '--format',
    'json',
    '--file',
    'examples/fixtures/doctor/unsupported-builtin.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  const doctorResult = JSON.parse(result.stdout);
  expect(checkOutcome(doctorResult, 'builtin-check-supported')).toBe('failed');
  expect(result.stdout).toContain('builtin:unknown-check');
});

test('doctor writes output inside root and report can summarize it', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const doctor = await run(
    ['doctor', '--format', 'json', '--output', '.harness/doctor/result.json'],
    root,
  );
  expect(doctor.code).toBe(ExitCode.ok);
  expect(doctor.stdout).toContain('harness doctor passed: wrote .harness/doctor/result.json');

  const report = await run(['report', '--doctor-result', '.harness/doctor/result.json'], root);
  expect(report.code).toBe(ExitCode.ok);
  expect(report.stdout).toContain('- doctor result: .harness/doctor/result.json');
  expect(report.stdout).toContain('  status: passed');
});

test('report cites the artifact paths it summarizes', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const expectedReportPrefix = await readFile('tests/cli/fixtures/expected-report.txt', 'utf8');

  const result = await run(['report'], root);
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain(expectedReportPrefix.trimEnd());
  expect(result.stdout).toContain('- cited paths:');
  expect(result.stdout).toContain('  - harness.yaml');
});

test('doctor rejects output paths that escape root', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const result = await run(['doctor', '--output', '../doctor.json'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Doctor output escapes root');
});

test('doctor refuses to write output through symlinks', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  const sensitive = join(parent, 'sensitive');
  await mkdir(root);
  await mkdir(sensitive);
  await run(['init'], root);
  await symlink(join(sensitive, 'doctor.json'), join(root, 'doctor-link.json'));

  const result = await run(['doctor', '--output', 'doctor-link.json'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Refusing to write through symlink');
});

test('usage and missing input errors use stable exit codes', async () => {
  const unknown = await run(['unknown']);
  expect(unknown.code).toBe(ExitCode.usageError);
  expect(unknown.stderr).toContain('Unknown command');

  const missing = await run(['validate'], await tempRoot());
  expect(missing.code).toBe(ExitCode.notFound);
  expect(missing.stderr).toContain('Harness file not found');

  const help = await run(['help']);
  expect(help.code).toBe(ExitCode.ok);
  expect(help.stdout).toContain('doctor     Run deterministic structural harness checks.');
  expect(help.stdout).toContain('doctor status');
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

function checkOutcome(document: unknown, checkId: string): string | undefined {
  return getString(doctorCheck(document, checkId) ?? {}, 'outcome');
}

function doctorCheck(document: unknown, checkId: string): JsonObject | undefined {
  if (!isObject(document)) {
    return undefined;
  }
  const checks = getArray(document, 'checks');
  if (checks === undefined) {
    return undefined;
  }
  for (const check of checks) {
    if (isObject(check) && getString(check, 'id') === checkId) {
      return check;
    }
  }
  return undefined;
}
