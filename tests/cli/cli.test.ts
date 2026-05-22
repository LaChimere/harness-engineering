import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
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

test('adapter validate proves selected scope is a subset of the Stage 8 matrix', async () => {
  const result = await run(['adapter', 'validate']);
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain('harness adapter validate ok');
  expect(result.stdout).toContain('host: github-copilot-cli');
  expect(result.stdout).toContain('tier: limited-adapter');
  expect(result.stdout).toContain('capabilities: 7 implemented, 2 unavailable');
  expect(result.stdout).toContain(
    'write classes: init=advisory-only, migrate=advisory-only, repair=advisory-only',
  );
});

test('adapter validate rejects scope that overclaims partial matrix capabilities', async () => {
  const root = await tempRoot();
  await mkdir(join(root, 'examples/adapters/github-copilot-cli'), { recursive: true });
  await mkdir(join(root, 'examples/plugin-capabilities'), { recursive: true });
  await writeFile(
    join(root, 'examples/plugin-capabilities/stage8-agent-cli-capability-matrix.json'),
    await readFile('examples/plugin-capabilities/stage8-agent-cli-capability-matrix.json', 'utf8'),
  );
  const scope = await loadDocument('examples/adapters/github-copilot-cli/adapter-scope.json');
  if (!isObject(scope)) {
    throw new Error('adapter scope fixture must be an object');
  }
  const invalidScope = {
    ...scope,
    implemented_capabilities: [
      ...jsonObjects(getArray(scope, 'implemented_capabilities')),
      {
        capability: 'annotation_apis',
        fallback: 'supported',
        evidence_ids: ['github-copilot-cli-hooks'],
        user_label: 'Durable inline annotations',
        note: 'Invalidly promotes partial annotation support.',
      },
    ],
    unavailable_capabilities: jsonObjects(getArray(scope, 'unavailable_capabilities')).filter(
      (capability) => getString(capability, 'capability') !== 'annotation_apis',
    ),
  };
  await writeFile(
    join(root, 'examples/adapters/github-copilot-cli/adapter-scope.json'),
    JSON.stringify(invalidScope, null, 2),
  );

  const result = await run(['adapter', 'validate'], root);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('ASM_CAPABILITY_OVERCLAIM');
  expect(result.stdout).toContain('annotation_apis cannot be implemented');
});

test('adapter validate rejects resolution order modes absent from scope management modes', async () => {
  const root = await tempRoot();
  await mkdir(join(root, 'examples/adapters/github-copilot-cli'), { recursive: true });
  await mkdir(join(root, 'examples/plugin-capabilities'), { recursive: true });
  await writeFile(
    join(root, 'examples/plugin-capabilities/stage8-agent-cli-capability-matrix.json'),
    await readFile('examples/plugin-capabilities/stage8-agent-cli-capability-matrix.json', 'utf8'),
  );
  const scope = await loadDocument('examples/adapters/github-copilot-cli/adapter-scope.json');
  if (!isObject(scope)) {
    throw new Error('adapter scope fixture must be an object');
  }
  await writeFile(
    join(root, 'examples/adapters/github-copilot-cli/adapter-scope.json'),
    JSON.stringify(
      {
        ...scope,
        cli_management_modes: ['repo-pinned', 'bootstrap'],
        cli_resolution_order: ['repo-pinned', 'user-installed'],
      },
      null,
      2,
    ),
  );

  const result = await run(['adapter', 'validate'], root);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('ASM_RESOLUTION_ORDER_UNMAPPED');
  expect(result.stdout).toContain('user-installed');
});

test('adapter validate rejects scope and matrix paths that escape root', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);
  await writeFile(join(parent, 'adapter-scope.json'), '{}');

  const result = await run(['adapter', 'validate', '--scope', '../adapter-scope.json'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Adapter scope escapes root');
});

test('loop validate accepts Stage 10 start and complete gates', async () => {
  const startResult = await run([
    'loop',
    'validate',
    '--phase',
    'start',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/continuity/stage10-loop-state.yaml',
  ]);
  expect(startResult.code).toBe(ExitCode.ok);
  expect(startResult.stdout).toContain('harness loop validate ok');
  expect(startResult.stdout).toContain('phase: start');
  expect(startResult.stdout).toContain('gates: startup=passed');

  const completeResult = await run([
    'loop',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/continuity/stage10-loop-state.yaml',
    '--verification',
    'examples/verification/stage10-completion.yaml',
  ]);
  expect(completeResult.code).toBe(ExitCode.ok);
  expect(completeResult.stdout).toContain('phase: complete');
  expect(completeResult.stdout).toContain('approval policy: default-approval');
  expect(completeResult.stdout).toContain('sandbox policy: default-sandbox (worktree)');
  expect(completeResult.stdout).toContain('gates: startup=passed, completion=passed');

  const absoluteVerificationResult = await run([
    'loop',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/continuity/stage10-loop-state.yaml',
    '--verification',
    join(process.cwd(), 'examples/verification/stage10-completion.yaml'),
  ]);
  expect(absoluteVerificationResult.code).toBe(ExitCode.ok);
  expect(absoluteVerificationResult.stdout).toContain(
    'completion verification: examples/verification/stage10-completion.yaml',
  );
});

test('loop validate refuses to start when startup verification failed', async () => {
  const result = await run([
    'loop',
    'validate',
    '--phase',
    'start',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/fixtures/execution-loop/startup-failed-state.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_STARTUP_NOT_PASSED');
});

test('loop validate refuses startup evidence recorded after work began', async () => {
  const result = await run([
    'loop',
    'validate',
    '--phase',
    'start',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/fixtures/execution-loop/startup-after-work-state.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_STARTUP_PROGRESS_ORDER');
});

test('loop validate refuses startup evidence missing from progress log', async () => {
  const result = await run([
    'loop',
    'validate',
    '--phase',
    'start',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/fixtures/execution-loop/empty-progress.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_STARTUP_PROGRESS_MISSING');
});

test('loop validate refuses startup when linked self-verification fails', async () => {
  const result = await run([
    'loop',
    'validate',
    '--phase',
    'start',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/fixtures/execution-loop/startup-self-verification-failed-state.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_ACCEPTANCE_CHECK_NOT_PASSED');
});

test('loop validate refuses startup when self-verification omits startup command', async () => {
  const result = await run([
    'loop',
    'validate',
    '--phase',
    'start',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/fixtures/execution-loop/startup-command-not-run-state.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_STARTUP_COMMAND_NOT_RUN');
});

test('loop validate refuses startup command and timeout mismatches against harness', async () => {
  const commandMismatch = await run([
    'loop',
    'validate',
    '--phase',
    'start',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/fixtures/execution-loop/startup-command-mismatch-state.yaml',
  ]);
  expect(commandMismatch.code).toBe(ExitCode.validationError);
  expect(commandMismatch.stdout).toContain('LOOP_STARTUP_COMMAND_MISMATCH');

  const timeoutMismatch = await run([
    'loop',
    'validate',
    '--phase',
    'start',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/fixtures/execution-loop/startup-timeout-mismatch-state.yaml',
  ]);
  expect(timeoutMismatch.code).toBe(ExitCode.validationError);
  expect(timeoutMismatch.stdout).toContain('LOOP_STARTUP_TIMEOUT_MISMATCH');
});

test('loop validate refuses completion when acceptance evidence fails', async () => {
  const result = await run([
    'loop',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/continuity/stage10-loop-state.yaml',
    '--verification',
    'examples/fixtures/execution-loop/completion-failed-acceptance.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_ACCEPTANCE_CHECK_NOT_PASSED');
});

test('loop validate refuses completion when required check evidence fails', async () => {
  const result = await run([
    'loop',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/continuity/stage10-loop-state.yaml',
    '--verification',
    'examples/fixtures/execution-loop/completion-failed-check.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_CHECK_NOT_PASSED');
});

test('loop validate refuses completion without required doctor evidence', async () => {
  const result = await run([
    'loop',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/continuity/stage10-loop-state.yaml',
    '--verification',
    'examples/fixtures/execution-loop/completion-missing-doctor.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_REQUIRED_CHECK_MISSING');
  expect(result.stdout).toContain('harness doctor');
});

test('loop validate refuses wrapped command strings as required check evidence', async () => {
  const result = await run([
    'loop',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/continuity/stage10-loop-state.yaml',
    '--verification',
    'examples/fixtures/execution-loop/completion-wrapped-command.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_REQUIRED_CHECK_MISSING');
  expect(result.stdout).toContain('harness validate');
  expect(result.stdout).toContain('harness doctor');
});

test('loop validate refuses completion without policy and sandbox artifact evidence', async () => {
  const result = await run([
    'loop',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/continuity/stage10-loop-state.yaml',
    '--verification',
    'examples/fixtures/execution-loop/completion-missing-policy-evidence.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_POLICY_EVIDENCE_MISSING');
  expect(result.stdout).toContain('approval policy artifact');
  expect(result.stdout).toContain('sandbox policy artifact');
});

test('loop validate refuses completion without handoff artifacts', async () => {
  const result = await run([
    'loop',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/fixtures/execution-loop/completion-missing-handoff-state.yaml',
    '--verification',
    'examples/verification/stage10-completion.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_HANDOFF_MISSING');
});

test('loop validate refuses completion when continuity does not link completion evidence', async () => {
  const result = await run([
    'loop',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/fixtures/execution-loop/completion-unlinked-state.yaml',
    '--verification',
    'examples/verification/stage10-completion.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stdout).toContain('LOOP_COMPLETION_PROGRESS_MISSING');
});

test('loop validate requires completion verification evidence for complete phase', async () => {
  const result = await run([
    'loop',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--continuity',
    'examples/continuity/stage10-loop-state.yaml',
  ]);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('requires --verification');
});

test('loop validate rejects continuity and verification paths that escape root', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);
  await run(['init'], root);
  await writeFile(
    join(parent, 'continuity.yaml'),
    await readFile('examples/continuity/stage10-loop-state.yaml', 'utf8'),
  );

  const continuityEscape = await run(
    ['loop', 'validate', '--phase', 'start', '--continuity', '../continuity.yaml'],
    root,
  );
  expect(continuityEscape.code).toBe(ExitCode.usageError);
  expect(continuityEscape.stderr).toContain('Continuity state escapes root');

  await copyStage10LoopArtifacts(root);
  await writeFile(
    join(parent, 'completion.yaml'),
    await readFile('examples/verification/stage10-completion.yaml', 'utf8'),
  );
  const verificationEscape = await run(
    [
      'loop',
      'validate',
      '--continuity',
      'examples/continuity/stage10-loop-state.yaml',
      '--verification',
      '../completion.yaml',
    ],
    root,
  );
  expect(verificationEscape.code).toBe(ExitCode.usageError);
  expect(verificationEscape.stderr).toContain('Completion self-verification escapes root');
});

test('loop validate rejects symlinked continuity and verification inputs', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  const outside = join(parent, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await run(['init'], root);
  await copyStage10LoopArtifacts(root);
  await writeFile(
    join(outside, 'continuity.yaml'),
    await readFile('examples/continuity/stage10-loop-state.yaml', 'utf8'),
  );
  await writeFile(
    join(outside, 'completion.yaml'),
    await readFile('examples/verification/stage10-completion.yaml', 'utf8'),
  );
  await symlink(join(outside, 'continuity.yaml'), join(root, 'continuity-link.yaml'));
  await symlink(join(outside, 'completion.yaml'), join(root, 'completion-link.yaml'));

  const symlinkedContinuity = await run(
    ['loop', 'validate', '--phase', 'start', '--continuity', 'continuity-link.yaml'],
    root,
  );
  expect(symlinkedContinuity.code).toBe(ExitCode.usageError);
  expect(symlinkedContinuity.stderr).toContain('Refusing to read through symlink');

  const symlinkedVerification = await run(
    [
      'loop',
      'validate',
      '--continuity',
      'examples/continuity/stage10-loop-state.yaml',
      '--verification',
      'completion-link.yaml',
    ],
    root,
  );
  expect(symlinkedVerification.code).toBe(ExitCode.usageError);
  expect(symlinkedVerification.stderr).toContain('Refusing to read through symlink');
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

test('report validates judge policy and advisory or blocking judge results', async () => {
  const cases: readonly {
    readonly path: string;
    readonly effect: string;
    readonly calibration: string;
    readonly agreement?: string;
  }[] = [
    {
      path: 'examples/judges/results/calibrated-blocking.json',
      effect: 'blocking',
      calibration: 'passed',
      agreement: '0.8 percent_agreement',
    },
    {
      path: 'examples/judges/results/advisory-only.json',
      effect: 'advisory',
      calibration: 'uncalibrated',
    },
    {
      path: 'examples/judges/results/below-threshold.json',
      effect: 'advisory',
      calibration: 'below-threshold',
      agreement: '0.6 percent_agreement',
    },
    {
      path: 'examples/judges/results/stale-advisory.json',
      effect: 'advisory',
      calibration: 'stale',
      agreement: '0.8 percent_agreement',
    },
  ] as const;

  for (const fixture of cases) {
    const result = await run([
      'report',
      '--file',
      'examples/harness.yaml',
      '--judge-result',
      fixture.path,
    ]);
    expect(result.code).toBe(ExitCode.ok);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`- judge result: ${fixture.path}`);
    expect(result.stdout).toContain('  policy: examples/judges/policy.yaml');
    expect(result.stdout).toContain(`  effect: ${fixture.effect}`);
    expect(result.stdout).toContain(`  calibration: ${fixture.calibration}`);
    if (fixture.agreement !== undefined) {
      expect(result.stdout).toContain(`  agreement: ${fixture.agreement}`);
    }
  }

  const policySummary = await run([
    'report',
    '--file',
    'examples/harness.yaml',
    '--judge-policy',
    'examples/judges/policy.yaml',
    '--judge-result',
    'examples/judges/results/calibrated-blocking.json',
  ]);
  expect(policySummary.code).toBe(ExitCode.ok);
  expect(policySummary.stdout).toContain('- judge policy: examples/judges/policy.yaml');
  expect(policySummary.stdout).toContain('  labeled sample minimum: 5');
  expect(policySummary.stdout).toContain('  blocking threshold: 0.8');
});

test('report rejects judge results that try to block without satisfied policy', async () => {
  const semanticInvalidCases = [
    {
      path: 'examples/judges/results/policy-violations/blocking-low-agreement.json',
      message: 'agreement_score 0.6 is below blocking threshold 0.8',
    },
    {
      path: 'examples/judges/results/policy-violations/blocking-too-few-samples.json',
      message: 'labeled_sample_count 4 is below policy minimum 5',
    },
    {
      path: 'examples/judges/results/policy-violations/policy-id-mismatch.json',
      message: 'policy_id different-policy does not match harness-self-test-judge-policy',
    },
    {
      path: 'examples/judges/results/policy-violations/judge-id-mismatch.json',
      message: 'judge_id different-judge does not match harness-self-test-reviewer',
    },
    {
      path: 'examples/judges/results/policy-violations/metric-mismatch.json',
      message: 'agreement_metric cohen_kappa does not match percent_agreement',
    },
    {
      path: 'examples/judges/results/policy-violations/below-threshold-high-score.json',
      message: 'below-threshold result has agreement_score 0.8 at or above 0.8',
    },
    {
      path: 'examples/judges/results/policy-violations/blocking-stale-by-date.json',
      message: 'calibration age 505 days exceeds stale_after_days 90; status must be stale',
    },
    {
      path: 'examples/judges/results/policy-violations/blocking-future-calibrated-at.json',
      message: 'calibration.calibrated_at must not be after produced_at',
    },
    {
      path: 'examples/judges/results/policy-violations/stale-fresh-date.json',
      message: 'stale calibration status requires age > stale_after_days 90, got 14 days',
    },
    {
      path: 'examples/judges/results/policy-violations/policy-digest-mismatch.json',
      message:
        'policy_digest sha256:0000000000000000000000000000000000000000000000000000000000000000 does not match',
    },
    {
      path: 'examples/judges/results/policy-violations/agreement-score-mismatch.json',
      message: 'agreement_score 0.99 does not match calibration examples percent_agreement 0.8',
    },
  ] as const;

  for (const fixture of semanticInvalidCases) {
    const result = await run([
      'report',
      '--file',
      'examples/harness.yaml',
      '--judge-result',
      fixture.path,
    ]);
    expect(result.code).toBe(ExitCode.validationError);
    expect(result.stderr).toContain('Judge result violates policy');
    expect(result.stderr).toContain(fixture.message);
  }

  const schemaInvalid = await run([
    'report',
    '--file',
    'examples/harness.yaml',
    '--judge-result',
    'examples/fixtures/invalid/judge-result-blocking-uncalibrated.json',
  ]);
  expect(schemaInvalid.code).toBe(ExitCode.validationError);
  expect(schemaInvalid.stderr).toContain('judge result artifact failed schema validation');

  const mismatchedPolicyPath = await run([
    'report',
    '--file',
    'examples/harness.yaml',
    '--judge-policy',
    'examples/judges/alternate-policy.yaml',
    '--judge-result',
    'examples/judges/results/calibrated-blocking.json',
  ]);
  expect(mismatchedPolicyPath.code).toBe(ExitCode.validationError);
  expect(mismatchedPolicyPath.stderr).toContain('does not match --judge-policy');

  const invalidPolicy = await run([
    'report',
    '--file',
    'examples/harness.yaml',
    '--judge-policy',
    'examples/fixtures/invalid/judge-policy-missing-rubric.yaml',
    '--judge-result',
    'examples/judges/results/calibrated-blocking.json',
  ]);
  expect(invalidPolicy.code).toBe(ExitCode.validationError);
  expect(invalidPolicy.stderr).toContain('judge policy artifact failed schema validation');

  const mismatchedRunResult = await run([
    'report',
    '--file',
    'examples/harness.yaml',
    '--run-result',
    'examples/run-results/run-result.json',
    '--judge-result',
    'examples/judges/results/calibrated-blocking.json',
  ]);
  expect(mismatchedRunResult.code).toBe(ExitCode.validationError);
  expect(mismatchedRunResult.stderr).toContain(
    'run_id stage7-example-run does not match run result run-schema-smoke-001',
  );
  expect(mismatchedRunResult.stderr).toContain('is not linked from run result judge_results');
});

test('report validates judge results linked from run-result artifacts', async () => {
  const valid = await run([
    'report',
    '--file',
    'examples/harness.yaml',
    '--run-result',
    'examples/run-results/run-result-with-judge.json',
  ]);
  expect(valid.code).toBe(ExitCode.ok);
  expect(valid.stdout).toContain('- run result: examples/run-results/run-result-with-judge.json');
  expect(valid.stdout).toContain('  status: passed');
  expect(valid.stdout).toContain('  judge results: 1');

  const root = await tempRoot();
  await run(['init'], root);
  await mkdir(join(root, 'examples/judges/results/policy-violations'), { recursive: true });
  await writeFile(
    join(root, 'examples/judges/results/policy-violations/blocking-low-agreement.json'),
    await readFile('examples/judges/results/policy-violations/blocking-low-agreement.json', 'utf8'),
  );
  await writeFile(
    join(root, 'run-result-with-invalid-judge.json'),
    JSON.stringify(
      {
        schema_version: '0.1.0',
        run_id: 'stage7-semantic-invalid-run',
        kind: 'eval',
        suite_id: 'harness-self-test',
        task_id: 'schema-smoke',
        task_version: '1.0.0',
        dataset_hash: 'sha256:0b327293fe4cc3ebef6126c1ee7531b310ed50a3397576de46a0170dac2aed7f',
        split: 'optimization',
        model_profile: 'harness://verifier-only/no-model',
        harness_version: '0.1.0',
        status: 'passed',
        execution: {
          mode: 'verifier-only',
          harness_status: 'passed',
          verifier_status: 'passed',
        },
        usage: {
          billed_model_id: 'verifier-only',
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          requests: 0,
          incurred_cost_usd: 0,
          source: 'stub',
        },
        trace: 'harness://verifier-only/no-agent-trace',
        verifier_result: 'examples/verifier-results/schema-smoke.json',
        judge_results: [
          {
            path: 'examples/judges/results/policy-violations/blocking-low-agreement.json',
            media_type: 'application/json',
            description: 'Policy-violating judge result.',
          },
        ],
        artifacts: [],
      },
      null,
      2,
    ),
  );
  const invalid = await run(['report', '--run-result', 'run-result-with-invalid-judge.json'], root);
  expect(invalid.code).toBe(ExitCode.validationError);
  expect(invalid.stderr).toContain('Linked judge result');
  expect(invalid.stderr).toContain('agreement_score 0.6 is below blocking threshold 0.8');
});

test('report rejects symlinked Stage 7 artifact reads', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);
  await run(['init'], root);
  await symlink(
    join(root, 'examples/judges/results/advisory-only.json'),
    join(root, 'judge-result-link.json'),
  );

  const result = await run(['report', '--judge-result', 'judge-result-link.json'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Refusing to read through symlink');
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
      'sha256:0b327293fe4cc3ebef6126c1ee7531b310ed50a3397576de46a0170dac2aed7f',
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

test('run executes a deterministic stub task and writes agent artifacts', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const result = await run(
    [
      'run',
      'examples/evals/harness-self-test/v1.0.0/task.yaml',
      '--run-id',
      'stage6-single',
      '--session-id',
      'session-stage6',
      '--format',
      'json',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const summary = JSON.parse(result.stdout);
  expect(getString(summary, 'case')).toBe('oracle');
  expect(getString(summary, 'actual_status')).toBe('passed');

  const tracePath = requiredStringForTest(summary, 'trace');
  const verifierResultPath = requiredStringForTest(summary, 'verifier_result');
  const runResults = await readJsonLines(join(root, '.harness/run-results.jsonl'));
  expect(runResults.length).toBe(1);
  const runResult = runResults[0] ?? {};
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('run-result', runResult)).toEqual([]);
  expect(getString(runResult, 'trace')).toBe(tracePath);
  expect(getString(runResult, 'verifier_result')).toBe(verifierResultPath);
  expect(getObject(runResult, 'execution')).toEqual({
    mode: 'agent-run',
    harness_status: 'passed',
    verifier_status: 'passed',
    agent_status: 'passed',
    model_status: 'passed',
  });

  const trace = JSON.parse(await readFile(join(root, tracePath), 'utf8'));
  expect(schemas.validate('trace', trace)).toEqual([]);
  expect(getString(trace, 'session_id')).toBe('session-stage6');
  expect(getString(getObject(trace, 'credential_reference') ?? {}, 'source')).toBe('stub');
  expect(getNumberForTest(getObject(trace, 'budgets') ?? {}, 'max_requests')).toBe(1);
  expect(getString(getObject(trace, 'usage') ?? {}, 'source')).toBe('stub');
  expect(getNumberForTest(getObject(trace, 'usage') ?? {}, 'requests')).toBe(1);

  const verifierResult = JSON.parse(await readFile(join(root, verifierResultPath), 'utf8'));
  expect(getString(verifierResult, 'status')).toBe('passed');
  const agentOutputPath = requiredStringForTest(summary, 'agent_output');
  expect(await readFile(join(root, agentOutputPath), 'utf8')).toContain('schema-smoke passes');
});

test('run preserves explicit session association across separate runs', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const first = await run(
    [
      'run',
      '--run-id',
      'stage6-session-a',
      '--session-id',
      'shared-stage6-session',
      '--format',
      'json',
    ],
    root,
  );
  const second = await run(
    [
      'run',
      '--run-id',
      'stage6-session-b',
      '--session-id',
      'shared-stage6-session',
      '--format',
      'json',
    ],
    root,
  );
  expect(first.code).toBe(ExitCode.ok);
  expect(second.code).toBe(ExitCode.ok);

  const firstTrace = JSON.parse(
    await readFile(join(root, requiredStringForTest(JSON.parse(first.stdout), 'trace')), 'utf8'),
  );
  const secondTrace = JSON.parse(
    await readFile(join(root, requiredStringForTest(JSON.parse(second.stdout), 'trace')), 'utf8'),
  );
  expect(getString(firstTrace, 'session_id')).toBe('shared-stage6-session');
  expect(getString(secondTrace, 'session_id')).toBe('shared-stage6-session');
});

test('run replaces duplicate agent-run ledger entries for the same run id', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const args = [
    'run',
    '--run-id',
    'stage6-repeat',
    '--session-id',
    'session-stage6-repeat',
    '--format',
    'json',
  ];
  const first = await run(args, root);
  const second = await run(args, root);
  expect(first.code).toBe(ExitCode.ok);
  expect(second.code).toBe(ExitCode.ok);

  const runResults = await readJsonLines(join(root, '.harness/run-results.jsonl'));
  expect(runResults.length).toBe(1);
  expect(requiredStringForTest(runResults[0] ?? {}, 'run_id')).toContain('stage6-repeat');
});

test('run rejects empty session ids and symlinked stub outputs', async () => {
  const emptySession = await run(['run', '--session-id='], await tempRoot());
  expect(emptySession.code).toBe(ExitCode.usageError);
  expect(emptySession.stderr).toContain('run --session-id must not be empty');
  const emptyEvalSession = await run(['eval', 'run', '--session-id='], await tempRoot());
  expect(emptyEvalSession.code).toBe(ExitCode.usageError);
  expect(emptyEvalSession.stderr).toContain('eval run --session-id must not be empty');

  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);
  await run(['init'], root);
  await writeFile(join(parent, 'outside-oracle.txt'), 'schema-smoke passes outside root.\n');
  await rm(join(root, 'examples/evals/harness-self-test/v1.0.0/oracle.txt'));
  await symlink(
    join(parent, 'outside-oracle.txt'),
    join(root, 'examples/evals/harness-self-test/v1.0.0/oracle.txt'),
  );
  await refreshSelfTestDatasetHash(root);

  const symlinkedOutput = await run(['run', '--format', 'json'], root);
  expect(symlinkedOutput.code).toBe(ExitCode.usageError);
  expect(symlinkedOutput.stderr).toContain('Refusing to write through symlink');
});

test('run rejects deterministic runners without explicit budgets', async () => {
  const result = await run([
    'run',
    '--file',
    'examples/harness.yaml',
    '--runner',
    'examples/fixtures/invalid/agent-runner-missing-budgets.yaml',
    '--run-id',
    'stage6-missing-budgets',
    '--format',
    'json',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stderr).toContain('Agent runner validation failed');
  expect(result.stderr).toContain("must have required property 'budgets'");
});

test('run rejects non-stub credential sources during Stage 6', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const runnerPath = join(root, 'examples/agent-runners/stub.yaml');
  const runner = await readFile(runnerPath, 'utf8');
  await writeFile(runnerPath, runner.replace('source: stub', 'source: env'));

  const result = await run(['run', '--run-id', 'stage6-env-credential', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stderr).toContain(
    'Stage 6 deterministic runner requires credential_reference.source: stub',
  );
});

test('eval run emits agent-run results, traces, and a failure-bucket scoreboard', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const result = await run(
    [
      'eval',
      'run',
      '--run-id',
      'stage6-suite',
      '--session-id',
      'session-stage6-suite',
      '--format',
      'json',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const evalRun = JSON.parse(result.stdout);
  expect(getString(evalRun, 'status')).toBe('passed');
  expect(getString(evalRun, 'session_id')).toBe('session-stage6-suite');

  const schemas = await loadSchemaRegistry(process.cwd());
  const runResults = jsonObjects(getArray(evalRun, 'run_results'));
  expect(runResults.length).toBe(2);
  const ledgerRunResults = await readJsonLines(join(root, '.harness/run-results.jsonl'));
  expect(ledgerRunResults.map((runResult) => getString(runResult, 'run_id')).sort()).toEqual(
    runResults.map((runResult) => getString(runResult, 'run_id')).sort(),
  );
  const oracle = runResults.find((runResult) =>
    requiredStringForTest(runResult, 'run_id').includes('-oracle-'),
  );
  const brokenTwin = runResults.find((runResult) =>
    requiredStringForTest(runResult, 'run_id').includes('-broken-twin-'),
  );
  expect(getString(oracle ?? {}, 'status')).toBe('passed');
  expect(getString(brokenTwin ?? {}, 'status')).toBe('failed');
  expect(getString(brokenTwin ?? {}, 'failure_code')).toBe('agent-failure');
  for (const runResult of runResults) {
    expect(getString(runResult, 'trace')).not.toBe('harness://verifier-only/no-agent-trace');
    expect(getString(getObject(runResult, 'execution') ?? {}, 'mode')).toBe('agent-run');
    const tracePath = requiredStringForTest(runResult, 'trace');
    const verifierResultPath = requiredStringForTest(runResult, 'verifier_result');
    const trace = JSON.parse(await readFile(join(root, tracePath), 'utf8'));
    expect(schemas.validate('trace', trace)).toEqual([]);
    expect(getString(trace, 'session_id')).toBe('session-stage6-suite');
    expect(getNumberForTest(getObject(trace, 'usage') ?? {}, 'requests')).toBe(1);
    const modelActions = jsonObjects(getArray(trace, 'actions')).filter(
      (action) => getString(action, 'type') === 'model',
    );
    expect(modelActions.length).toBe(1);
    expect(getObject(getObject(modelActions[0] ?? {}, 'model_call') ?? {}, 'usage')).toEqual(
      getObject(trace, 'usage'),
    );
    const verifierResult = JSON.parse(await readFile(join(root, verifierResultPath), 'utf8'));
    expect(getString(verifierResult, 'run_id')).toBe(getString(runResult, 'run_id'));
  }

  const scoreboardPath = requiredStringForTest(evalRun, 'scoreboard');
  const scoreboard = JSON.parse(await readFile(join(root, scoreboardPath), 'utf8'));
  expect(schemas.validate('scoreboard', scoreboard)).toEqual([]);
  expect(getString(scoreboard, 'status')).toBe('passed');
  const totals = getObject(scoreboard, 'totals') ?? {};
  expect(getNumberForTest(totals, 'total')).toBe(2);
  expect(getNumberForTest(totals, 'passed')).toBe(1);
  expect(getNumberForTest(totals, 'failed')).toBe(1);
  const buckets = getObject(totals, 'failure_buckets') ?? {};
  expect(getNumberForTest(buckets, 'agent-failure')).toBe(1);
  expect(getNumberForTest(buckets, 'model-failure')).toBe(0);
  expect(getNumberForTest(buckets, 'harness-error')).toBe(0);
  expect(getNumberForTest(buckets, 'verifier-error')).toBe(0);
  expect(getNumberForTest(buckets, 'verification-failure')).toBe(0);
  expect(getNumberForTest(buckets, 'budget-exceeded')).toBe(0);
  expect(getNumberForTest(buckets, 'credential-missing')).toBe(0);
  const splits = jsonObjects(getArray(scoreboard, 'splits'));
  const optimization = objectWithString(splits, 'split', 'optimization');
  const holdout = objectWithString(splits, 'split', 'holdout');
  expect(getNumberForTest(optimization ?? {}, 'total')).toBe(2);
  expect(getNumberForTest(holdout ?? {}, 'total')).toBe(0);
});

test('eval run maps harness refusals into scoreboard failure buckets', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const taskPath = join(root, 'examples/evals/harness-self-test/v1.0.0/task.yaml');
  const task = await readFile(taskPath, 'utf8');
  await writeFile(taskPath, task.replace('network_access: false', 'network_access: true'));

  const result = await run(['eval', 'run', '--run-id', 'stage6-sandbox', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.validationError);
  const evalRun = JSON.parse(result.stdout);
  expect(getString(evalRun, 'status')).toBe('error');
  const runResults = jsonObjects(getArray(evalRun, 'run_results'));
  expect(runResults.length).toBe(2);
  for (const runResult of runResults) {
    expect(getString(runResult, 'failure_code')).toBe('sandbox-violation');
    expect(getObject(runResult, 'execution')).toEqual({
      mode: 'agent-run',
      harness_status: 'failed',
      verifier_status: 'skipped',
      agent_status: 'skipped',
      model_status: 'skipped',
    });
  }

  const trace = JSON.parse(
    await readFile(join(root, requiredStringForTest(runResults[0] ?? {}, 'trace')), 'utf8'),
  );
  expect(getNumberForTest(getObject(trace, 'usage') ?? {}, 'requests')).toBe(0);
  expect(
    jsonObjects(getArray(trace, 'actions')).map((action) => getString(action, 'type')),
  ).toEqual(['system']);
  expect(await readdir(join(root, '.harness/agent-outputs'))).toEqual([]);

  const scoreboard = JSON.parse(
    await readFile(join(root, requiredStringForTest(evalRun, 'scoreboard')), 'utf8'),
  );
  const buckets = getObject(getObject(scoreboard, 'totals') ?? {}, 'failure_buckets') ?? {};
  expect(getNumberForTest(buckets, 'harness-error')).toBe(2);
  expect(getNumberForTest(buckets, 'verifier-error')).toBe(0);
  expect(getNumberForTest(buckets, 'agent-failure')).toBe(0);
});

test('eval run maps verifier command errors into scoreboard failure buckets', async () => {
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

  const result = await run(
    ['eval', 'run', '--run-id', 'stage6-verifier-error', '--format', 'json'],
    root,
  );
  expect(result.code).toBe(ExitCode.validationError);
  const evalRun = JSON.parse(result.stdout);
  expect(getString(evalRun, 'status')).toBe('error');
  const runResults = jsonObjects(getArray(evalRun, 'run_results'));
  expect(runResults.length).toBe(2);
  for (const runResult of runResults) {
    expect(getString(runResult, 'failure_code')).toBe('verifier-error');
    expect(getObject(runResult, 'execution')).toEqual({
      mode: 'agent-run',
      harness_status: 'passed',
      verifier_status: 'error',
      agent_status: 'skipped',
      model_status: 'passed',
    });
  }
  const scoreboard = JSON.parse(
    await readFile(join(root, requiredStringForTest(evalRun, 'scoreboard')), 'utf8'),
  );
  const buckets = getObject(getObject(scoreboard, 'totals') ?? {}, 'failure_buckets') ?? {};
  expect(getNumberForTest(buckets, 'verifier-error')).toBe(2);
  expect(getNumberForTest(buckets, 'model-failure')).toBe(0);
  expect(getNumberForTest(buckets, 'harness-error')).toBe(0);
  expect(getNumberForTest(buckets, 'agent-failure')).toBe(0);
});

test('trace validates configured examples and imports normalized traces', async () => {
  const validate = await run([
    'trace',
    'validate',
    '--file',
    'examples/harness.yaml',
    '--format',
    'json',
  ]);
  expect(validate.code).toBe(ExitCode.ok);
  const validation = JSON.parse(validate.stdout);
  expect(getString(validation, 'status')).toBe('passed');
  expect(jsonObjects(getArray(validation, 'traces')).length).toBe(2);

  const root = await tempRoot();
  await run(['init'], root);
  const imported = await run(
    [
      'trace',
      'import',
      '--input',
      'examples/traces/external-import.json',
      '--output',
      '.harness/traces/imported.json',
    ],
    root,
  );
  expect(imported.code).toBe(ExitCode.ok);
  expect(imported.stdout).toContain('harness trace import passed');
  const trace = JSON.parse(await readFile(join(root, '.harness/traces/imported.json'), 'utf8'));
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('trace', trace)).toEqual([]);
  expect(getString(trace, 'determinism_level')).toBe('external-import');

  const parent = await tempRoot();
  const symlinkRoot = join(parent, 'repo');
  await mkdir(symlinkRoot);
  await run(['init'], symlinkRoot);
  await symlink(join(parent, 'outside-trace.json'), join(symlinkRoot, '.harness/traces/link.json'));
  const symlinkedOutput = await run(
    [
      'trace',
      'import',
      '--input',
      'examples/traces/external-import.json',
      '--output',
      '.harness/traces/link.json',
    ],
    symlinkRoot,
  );
  expect(symlinkedOutput.code).toBe(ExitCode.usageError);
  expect(symlinkedOutput.stderr).toContain('Refusing to write through symlink');
});

test('trace commands reject directory and symlink inputs', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);
  await run(['init'], root);
  await symlink(join(root, 'examples/traces/native-cli-trace.json'), join(root, 'trace-link.json'));

  const symlinkedInput = await run(['trace', 'validate', 'trace-link.json'], root);
  expect(symlinkedInput.code).toBe(ExitCode.usageError);
  expect(symlinkedInput.stderr).toContain('Refusing to write through symlink');

  const directoryInput = await run(['trace', 'validate', 'examples/traces'], root);
  expect(directoryInput.code).toBe(ExitCode.usageError);
  expect(directoryInput.stderr).toContain('Trace artifact must be a file');
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
  expect(help.stdout).toContain(
    'loop       Validate native execution-loop startup and completion gates.',
  );
  expect(help.stdout).toContain('doctor     Run deterministic structural harness checks.');
  expect(help.stdout).toContain('run        Run deterministic stub agent tasks.');
  expect(help.stdout).toContain(
    'eval       Run eval validation or deterministic behavioral evals.',
  );
  expect(help.stdout).toContain('trace      Validate or import normalized traces.');
  expect(help.stdout).toContain('version    Print CLI version.');
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'harness-cli-test-'));
  tempRoots.push(root);
  return root;
}

async function copyStage10LoopArtifacts(root: string): Promise<void> {
  await mkdir(join(root, 'examples/continuity'), { recursive: true });
  await mkdir(join(root, 'examples/verification'), { recursive: true });
  await writeFile(
    join(root, 'examples/continuity/stage10-loop-state.yaml'),
    await readFile('examples/continuity/stage10-loop-state.yaml', 'utf8'),
  );
  await writeFile(
    join(root, 'examples/verification/stage10-startup.yaml'),
    await readFile('examples/verification/stage10-startup.yaml', 'utf8'),
  );
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

function getNumberForTest(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === 'number' ? value : undefined;
}

function requiredStringForTest(object: JsonObject, key: string): string {
  const value = getString(object, key);
  if (value === undefined) {
    throw new Error(`Expected ${key} to be a string`);
  }
  return value;
}

async function readJsonLines(path: string): Promise<JsonObject[]> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    .filter(isObject);
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
