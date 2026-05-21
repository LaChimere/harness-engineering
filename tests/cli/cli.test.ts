import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../src/cli.ts';
import { computeEvalTaskDatasetHash } from '../../src/lib/eval.ts';
import { ExitCode } from '../../src/lib/exit-codes.ts';
import { loadDocument } from '../../src/lib/files.ts';
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

test('eval validate proves oracle pass and broken twin fail deterministically', async () => {
  const result = await run([
    'eval',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--format',
    'json',
  ]);
  expect(result.code).toBe(ExitCode.ok);
  const evalResult = JSON.parse(result.stdout);
  expect(evalResult.status).toBe('passed');

  const tasks = jsonObjects(getArray(evalResult, 'tasks'));
  expect(tasks.length).toBe(1);
  expect(getString(tasks[0] ?? {}, 'split')).toBe('optimization');

  const cases = jsonObjects(getArray(tasks[0] ?? {}, 'cases'));
  const oracleCase = objectWithString(cases, 'case', 'oracle');
  const brokenTwinCase = objectWithString(cases, 'case', 'broken-twin');
  expect(getString(oracleCase ?? {}, 'actual_status')).toBe('passed');
  expect(getBoolean(oracleCase ?? {}, 'expectation_met')).toBe(true);
  expect(getString(brokenTwinCase ?? {}, 'actual_status')).toBe('failed');
  expect(getBoolean(brokenTwinCase ?? {}, 'expectation_met')).toBe(true);

  const runResults = jsonObjects(getArray(evalResult, 'run_results'));
  expect(runResults.length).toBe(2);
  const schemas = await loadSchemaRegistry(process.cwd());
  for (const runResult of runResults) {
    expect(schemas.validate('run-result', runResult)).toEqual([]);
    expect(getString(runResult, 'suite_id')).toBe('harness-self-test');
    expect(getString(runResult, 'task_id')).toBe('schema-smoke');
    expect(getString(runResult, 'task_version')).toBe('1.0.0');
    expect(getString(runResult, 'dataset_hash')).toBe(
      'sha256:9330054cc7ffef346ff5709de3a3b81b6e5177dcb1954510cd39eee2986c591d',
    );
    expect(getString(runResult, 'split')).toBe('optimization');
    expect(getString(runResult, 'model_profile')).toBe('harness://verifier-only/no-model');
    expect(getString(runResult, 'trace')).toBe('harness://verifier-only/no-agent-trace');
    expect(getObject(runResult, 'usage')).toEqual({
      billed_model_id: 'verifier-only',
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      requests: 0,
      incurred_cost_usd: 0,
      source: 'stub',
    });
    const execution = getObject(runResult, 'execution');
    expect(execution).toEqual({
      mode: 'verifier-only',
      harness_status: 'passed',
      verifier_status: getString(runResult, 'status') === 'passed' ? 'passed' : 'failed',
    });
    if (getString(runResult, 'status') === 'passed') {
      expect(getString(runResult, 'failure_code')).toBeUndefined();
    } else {
      expect(getString(runResult, 'failure_code')).toBe('verification-failure');
    }
  }
});

test('eval validate appends run results and writes verifier artifacts', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const result = await run(['eval', 'validate', '--output', '.harness/run-results.jsonl'], root);
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain('harness eval validate passed: wrote .harness/run-results.jsonl');
  const secondResult = await run(
    ['eval', 'validate', '--output', '.harness/run-results.jsonl'],
    root,
  );
  expect(secondResult.code).toBe(ExitCode.ok);

  const lines = (await readFile(join(root, '.harness/run-results.jsonl'), 'utf8'))
    .trim()
    .split('\n');
  expect(lines.length).toBe(4);
  const schemas = await loadSchemaRegistry(process.cwd());
  const runIds = new Set<string>();
  for (const line of lines) {
    const runResult = JSON.parse(line);
    expect(schemas.validate('run-result', runResult)).toEqual([]);
    const runId = getString(runResult, 'run_id');
    if (runId === undefined) {
      throw new Error('run result did not include run_id');
    }
    runIds.add(runId);
    const verifierResult = getString(runResult, 'verifier_result');
    if (verifierResult === undefined) {
      throw new Error('run result did not include verifier_result');
    }
    const verifierArtifact = JSON.parse(await readFile(join(root, verifierResult), 'utf8'));
    expect(getString(verifierArtifact, 'schema_version')).toBe('0.1.0');
    expect(getString(verifierArtifact, 'run_id')).toBe(runId);
    expect(getString(verifierArtifact, 'status')).toBe(
      getString(getObject(runResult, 'execution') ?? {}, 'verifier_status'),
    );
  }
  expect(runIds.size).toBe(4);
});

test('eval validate treats dot output declarations as root-contained allowlists', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const taskPath = join(root, 'examples/evals/harness-self-test/v1.0.0/task.yaml');
  const task = await readFile(taskPath, 'utf8');
  await writeFile(
    taskPath,
    task.replace(
      `      - .harness/run-results.jsonl
      - .harness/verifier-results`,
      '      - .',
    ),
  );

  const result = await run(['eval', 'validate', '--output', '.harness/run-results.jsonl'], root);
  expect(result.code).toBe(ExitCode.ok);
});

test('eval validate canonicalizes candidate paths for trust checks', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const taskPath = join(root, 'examples/evals/harness-self-test/v1.0.0/task.yaml');
  const task = await readFile(taskPath, 'utf8');
  await writeFile(
    taskPath,
    task.replace(
      'artifact: examples/evals/harness-self-test/v1.0.0/oracle.txt',
      'artifact: ./examples/evals/harness-self-test/v1.0.0/oracle.txt',
    ),
  );

  const result = await run(['eval', 'validate', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.ok);
});

test('eval validate rejects stale dataset hashes before verifier execution', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const taskPath = join(root, 'examples/evals/harness-self-test/v1.0.0/task.yaml');
  const task = await readFile(taskPath, 'utf8');
  await writeFile(
    taskPath,
    task.replace(
      `command: grep -q '^schema-smoke passes' "$HARNESS_EVAL_CANDIDATE"`,
      `command: touch stale-verifier-ran && grep -q '^schema-smoke passes' "$HARNESS_EVAL_CANDIDATE"`,
    ),
  );
  await writeFile(
    join(root, 'examples/evals/harness-self-test/v1.0.0/oracle.txt'),
    'schema-smoke passes after an unrecorded dataset edit.\n',
  );

  const result = await run(['eval', 'validate', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.validationError);
  const evalResult = JSON.parse(result.stdout);
  expect(evalResult.status).toBe('failed');
  expect(result.stdout).toContain('dataset_hash mismatch');
  expect(getArray(evalResult, 'run_results')).toEqual([]);
  expect(await pathExistsForTest(join(root, 'stale-verifier-ran'))).toBe(false);
});

test('eval validate refuses unsafe verifier trust declarations', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const taskPath = join(root, 'examples/evals/harness-self-test/v1.0.0/task.yaml');
  const task = await readFile(taskPath, 'utf8');
  await writeFile(
    taskPath,
    task
      .replace(
        `command: grep -q '^schema-smoke passes' "$HARNESS_EVAL_CANDIDATE"`,
        'command: touch should-not-run',
      )
      .replace('network_access: false', 'network_access: true'),
  );

  const result = await run(['eval', 'validate', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.validationError);
  const evalResult = JSON.parse(result.stdout);
  expect(evalResult.status).toBe('error');
  const runResults = jsonObjects(getArray(evalResult, 'run_results'));
  expect(runResults.length).toBe(2);
  for (const runResult of runResults) {
    expect(getString(runResult, 'status')).toBe('error');
    expect(getString(runResult, 'failure_code')).toBe('sandbox-violation');
    expect(getObject(runResult, 'execution')).toEqual({
      mode: 'verifier-only',
      harness_status: 'failed',
      verifier_status: 'skipped',
    });
  }
  expect(await pathExistsForTest(join(root, 'should-not-run'))).toBe(false);
});

test('eval validate fails when oracle fails or broken twin passes unexpectedly', async () => {
  const oracleRoot = await tempRoot();
  await run(['init'], oracleRoot);
  await writeFile(
    join(oracleRoot, 'examples/evals/harness-self-test/v1.0.0/oracle.txt'),
    'schema-smoke no longer has the passing marker.\n',
  );
  await refreshSelfTestDatasetHash(oracleRoot);

  const oracleResult = await run(['eval', 'validate', '--format', 'json'], oracleRoot);
  expect(oracleResult.code).toBe(ExitCode.validationError);
  const oracleEval = JSON.parse(oracleResult.stdout);
  expect(oracleEval.status).toBe('failed');
  const oracleCases = jsonObjects(
    getArray(jsonObjects(getArray(oracleEval, 'tasks'))[0] ?? {}, 'cases'),
  );
  const failedOracleCase = objectWithString(oracleCases, 'case', 'oracle');
  expect(getString(failedOracleCase ?? {}, 'actual_status')).toBe('failed');
  expect(getBoolean(failedOracleCase ?? {}, 'expectation_met')).toBe(false);

  const brokenTwinRoot = await tempRoot();
  await run(['init'], brokenTwinRoot);
  await writeFile(
    join(brokenTwinRoot, 'examples/evals/harness-self-test/v1.0.0/broken-twin.txt'),
    'schema-smoke passes even though this is the broken twin.\n',
  );
  await refreshSelfTestDatasetHash(brokenTwinRoot);

  const brokenTwinResult = await run(['eval', 'validate', '--format', 'json'], brokenTwinRoot);
  expect(brokenTwinResult.code).toBe(ExitCode.validationError);
  const brokenTwinEval = JSON.parse(brokenTwinResult.stdout);
  expect(brokenTwinEval.status).toBe('failed');
  const brokenTwinCases = jsonObjects(
    getArray(jsonObjects(getArray(brokenTwinEval, 'tasks'))[0] ?? {}, 'cases'),
  );
  const passingBrokenTwinCase = objectWithString(brokenTwinCases, 'case', 'broken-twin');
  expect(getString(passingBrokenTwinCase ?? {}, 'actual_status')).toBe('passed');
  expect(getBoolean(passingBrokenTwinCase ?? {}, 'expectation_met')).toBe(false);
});

test('eval validate rejects run ids that could escape verifier output paths', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const result = await run(
    ['eval', 'validate', '--output', '.harness/run-results.jsonl', '--run-id', '../escape'],
    root,
  );
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('eval validate --run-id may contain only');
});

test('eval validate distinguishes verifier command errors from verification failures', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const taskPath = join(root, 'examples/evals/harness-self-test/v1.0.0/task.yaml');
  const task = await readFile(taskPath, 'utf8');
  await writeFile(
    taskPath,
    task.replace(
      `command: grep -q '^schema-smoke passes' "$HARNESS_EVAL_CANDIDATE"`,
      'command: definitely-not-a-harness-verifier-command',
    ),
  );

  const result = await run(['eval', 'validate', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.validationError);
  const evalResult = JSON.parse(result.stdout);
  expect(evalResult.status).toBe('error');
  const runResults = jsonObjects(getArray(evalResult, 'run_results'));
  expect(runResults.length).toBe(2);
  for (const runResult of runResults) {
    expect(getString(runResult, 'status')).toBe('error');
    expect(getString(runResult, 'failure_code')).toBe('verifier-error');
    expect(getObject(runResult, 'execution')).toEqual({
      mode: 'verifier-only',
      harness_status: 'passed',
      verifier_status: 'error',
    });
  }
});

test('eval validate reports verifier command timeouts distinctly', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const taskPath = join(root, 'examples/evals/harness-self-test/v1.0.0/task.yaml');
  const task = await readFile(taskPath, 'utf8');
  await writeFile(
    taskPath,
    task
      .replace(
        `command: grep -q '^schema-smoke passes' "$HARNESS_EVAL_CANDIDATE"`,
        'command: sleep 2',
      )
      .replace('timeout_seconds: 30', 'timeout_seconds: 1'),
  );

  const result = await run(['eval', 'validate', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.validationError);
  const evalResult = JSON.parse(result.stdout);
  expect(evalResult.status).toBe('error');
  const runResults = jsonObjects(getArray(evalResult, 'run_results'));
  expect(runResults.length).toBe(2);
  for (const runResult of runResults) {
    expect(getString(runResult, 'status')).toBe('error');
    expect(getString(runResult, 'failure_code')).toBe('timeout');
    expect(getObject(runResult, 'execution')).toEqual({
      mode: 'verifier-only',
      harness_status: 'passed',
      verifier_status: 'error',
    });
  }
});

test('eval validate refuses to write run results through symlinks', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  const sensitive = join(parent, 'sensitive');
  await mkdir(root);
  await mkdir(sensitive);
  await run(['init'], root);
  await rm(join(root, '.harness/run-results.jsonl'));
  await symlink(join(sensitive, 'run-results.jsonl'), join(root, '.harness/run-results.jsonl'));

  const result = await run(['eval', 'validate', '--output', '.harness/run-results.jsonl'], root);
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
  expect(help.stdout).toContain('eval       Run deterministic verifier-only eval validation.');
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

function jsonObjects(values: ReturnType<typeof getArray>): JsonObject[] {
  return (values ?? []).filter(isObject);
}

function objectWithString(
  objects: readonly JsonObject[],
  key: string,
  value: string,
): JsonObject | undefined {
  return objects.find((object) => getString(object, key) === value);
}

function getBoolean(object: JsonObject, key: string): boolean | undefined {
  const value = object[key];
  return typeof value === 'boolean' ? value : undefined;
}

async function refreshSelfTestDatasetHash(root: string): Promise<void> {
  const taskPath = join(root, 'examples/evals/harness-self-test/v1.0.0/task.yaml');
  const taskText = await readFile(taskPath, 'utf8');
  const task = await loadDocument(taskPath);
  if (!isObject(task)) {
    throw new Error('self-test task must be an object');
  }
  const datasetHash = await computeEvalTaskDatasetHash(root, task);
  await writeFile(
    taskPath,
    taskText.replace(/^dataset_hash: .+$/m, `dataset_hash: ${datasetHash}`),
  );
}

async function pathExistsForTest(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}
