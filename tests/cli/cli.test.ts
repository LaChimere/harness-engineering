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

test('adapter validate proves selected scope is a subset of the capability matrix', async () => {
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

test('assess emits schema-valid JSON and leaves unrelated repair actions unselected', async () => {
  const result = await run([
    'assess',
    '--format',
    'json',
    '--file',
    'examples/harness.yaml',
    '--doctor-result',
    'examples/doctor/results/pass.json',
    '--health-result',
    'examples/health/results/pass.json',
    '--run-results',
    'examples/run-results/run-result.json',
    '--trace',
    'examples/traces/native-cli-trace.json',
    '--scoreboard',
    'examples/scoreboards/self-test.json',
    '--report',
    'examples/reports/harness-report.md',
  ]);
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(assessment, 'status')).toBe('ready');
  expect(getString(getObject(assessment, 'adapter_path') ?? {}, 'kind')).toBe('cli-command');
  expect(getString(getObject(assessment, 'source') ?? {}, 'harness')).toBe('examples/harness.yaml');
  expect(getString(getObject(assessment, 'implementation_routing') ?? {}, 'selected_route')).toBe(
    'execution-loop',
  );
  expect(
    getString(
      objectWithString(
        jsonObjects(getArray(getObject(assessment, 'implementation_routing') ?? {}, 'routes')),
        'id',
        'external-workflow-skill',
      ) ?? {},
      'status',
    ),
  ).toBe('unavailable');
  expect(
    getString(
      objectWithString(jsonObjects(getArray(assessment, 'scorecard')), 'id', 'run-results') ?? {},
      'status',
    ),
  ).toBe('present');
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('assessment', assessment)).toEqual([]);
  const routing = getObject(assessment, 'implementation_routing') ?? {};
  const routes = jsonObjects(getArray(routing, 'routes'));
  const repairRoute = objectWithString(routes, 'kind', 'repair-action') ?? {};
  expect(getString(repairRoute, 'id')).toBe('repair-action:approved-schema-fix');
  expect(getString(repairRoute, 'status')).toBe('unavailable');
  expect(getString(repairRoute, 'applicability')).toBe('not-applicable');
  expect(getString(repairRoute, 'approval_state')).toBe('approved');
  expect(getString(repairRoute, 'approval_trust')).toBe('untrusted');
  expect(getString(repairRoute, 'risk_class')).toBe('low');
  expect(getString(repairRoute, 'repair_mode')).toBe('preview-backed');
  expect(getString(repairRoute, 'sandbox_requirement')).toBe('worktree');
  expect(getArray(repairRoute, 'target_files')).toEqual([
    'examples/fixtures/invalid/harness-with-plugin-key.yaml',
  ]);
  expect('command' in repairRoute).toBe(false);
  expect(
    schemas.validate('assessment', {
      ...assessment,
      implementation_routing: {
        ...routing,
        routes: routes.map((route) =>
          getString(route, 'kind') === 'repair-action'
            ? { ...route, command: { command: 'harness migrate --dry-run' } }
            : route,
        ),
      },
    }).length,
  ).toBeGreaterThan(0);
  expect(
    schemas.validate('assessment', {
      ...assessment,
      implementation_routing: {
        ...routing,
        selected_route: 'repair-action',
      },
    }).length,
  ).toBeGreaterThan(0);
  expect(
    schemas.validate('assessment', {
      ...assessment,
      implementation_routing: {
        ...routing,
        routes: routes.map((route) =>
          getString(route, 'kind') === 'execution-loop'
            ? { ...route, command: { command: 'harness loop validate --phase start' } }
            : route,
        ),
      },
    }).length,
  ).toBeGreaterThan(0);
  expect(
    schemas.validate('assessment', {
      ...assessment,
      implementation_routing: {
        ...routing,
        routes: routes.map((route) =>
          getString(route, 'kind') === 'repair-action'
            ? { ...route, approval_state: 'proposed', status: 'available' }
            : route,
        ),
      },
    }).length,
  ).toBeGreaterThan(0);
  expect(
    schemas.validate('assessment', invalidExternalSourceMaterialAssessment(assessment, routing))
      .length,
  ).toBeGreaterThan(0);
  expect(
    schemas.validate('assessment', {
      ...assessment,
      implementation_routing: {
        ...routing,
        selected_route: 'external-source-material',
      },
    }).length,
  ).toBeGreaterThan(0);
  expect(getString(objectWithString(routes, 'id', 'external-workflow-skill') ?? {}, 'status')).toBe(
    'unavailable',
  );
});

test('assess does not trust repo-declared repair approvals by default', async () => {
  const result = await run([
    'assess',
    '--format',
    'json',
    '--file',
    'examples/fixtures/invalid/harness-with-plugin-key.yaml',
  ]);
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(assessment, 'status')).toBe('needs-work');
  const routing = getObject(assessment, 'implementation_routing') ?? {};
  const routes = jsonObjects(getArray(routing, 'routes'));
  expect(getString(routing, 'selected_route')).toBe('execution-loop');
  const repairRoute = objectWithString(routes, 'id', 'repair-action:approved-schema-fix') ?? {};
  expect(getString(repairRoute, 'status')).toBe('needs-approval');
  expect(getString(repairRoute, 'applicability')).toBe('applicable');
  expect(getString(repairRoute, 'approval_trust')).toBe('untrusted');
  const repairScore = objectWithString(
    jsonObjects(getArray(assessment, 'scorecard')),
    'id',
    'repair-routing',
  );
  expect(getString(repairScore ?? {}, 'status')).toBe('partial');
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('assessment', assessment)).toEqual([]);
});

test('assess selects repair actions only with trusted approval and matching gaps', async () => {
  const result = await run([
    'assess',
    '--format',
    'json',
    '--file',
    'examples/fixtures/invalid/harness-with-plugin-key.yaml',
    '--trusted-repair-action',
    'approved-schema-fix',
  ]);
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  const routing = getObject(assessment, 'implementation_routing') ?? {};
  const routes = jsonObjects(getArray(routing, 'routes'));
  expect(getString(routing, 'selected_route')).toBe('repair-action');
  const repairRoute = objectWithString(routes, 'id', 'repair-action:approved-schema-fix') ?? {};
  expect(getString(repairRoute, 'status')).toBe('available');
  expect(getString(repairRoute, 'applicability')).toBe('applicable');
  expect(getString(repairRoute, 'approval_trust')).toBe('trusted');
  const repairScore = objectWithString(
    jsonObjects(getArray(assessment, 'scorecard')),
    'id',
    'repair-routing',
  );
  expect(getString(repairScore ?? {}, 'status')).toBe('present');
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('assessment', assessment)).toEqual([]);
});

test('assess emits markdown assessment with execution-loop routing when no repair action exists', async () => {
  const result = await run([
    'assess',
    '--file',
    'examples/harness.yaml',
    '--repair-actions-dir',
    'examples/fixtures/missing-repair-actions',
  ]);
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain('# Harness assessment');
  expect(result.stdout).toContain('Read-only assessment');
  expect(result.stdout).toContain('## Maturity scorecard');
  expect(result.stdout).toContain('- selected route: **execution-loop**');
  expect(result.stdout).toContain('external-workflow-skill (unavailable)');
  expect(result.stdout).toContain('cli-fallback (fallback)');
});

test('assess markdown exposes repair route safety metadata', async () => {
  const result = await run([
    'assess',
    '--file',
    'examples/harness.yaml',
    '--doctor-result',
    'examples/doctor/results/pass.json',
    '--run-results',
    'examples/run-results/run-result.json',
    '--trace',
    'examples/traces/native-cli-trace.json',
    '--scoreboard',
    'examples/scoreboards/self-test.json',
    '--report',
    'examples/reports/harness-report.md',
  ]);
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain(
    'repair-action:approved-schema-fix (unavailable) [applicability=not-applicable, approval-trust=untrusted, approval=approved, mode=preview-backed, risk=low, sandbox=worktree',
  );
});

test('assess reports missing harness and keeps fallback routing machine-readable', async () => {
  const root = await tempRoot();

  const result = await run(['assess', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(assessment, 'status')).toBe('missing-harness');
  expect(getString(getObject(assessment, 'implementation_routing') ?? {}, 'selected_route')).toBe(
    'cli-fallback',
  );
  expect(
    getString(
      objectWithString(jsonObjects(getArray(assessment, 'scorecard')), 'id', 'harness-source') ??
        {},
      'status',
    ),
  ).toBe('missing');
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('assessment', assessment)).toEqual([]);
});

test('assess records malformed optional artifacts without executing fallback work', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await writeFile(join(root, 'doctor.json'), '{not valid json');

  const result = await run(['assess', '--format', 'json', '--doctor-result', 'doctor.json'], root);
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(
    getString(
      objectWithString(jsonObjects(getArray(assessment, 'scorecard')), 'id', 'doctor-evidence') ??
        {},
      'status',
    ),
  ).toBe('partial');
  expect(result.stdout).toContain('Could not parse');
});

test('assess reports missing scoreboard artifacts explicitly', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await writeFile(join(root, 'report.md'), '# Report\n');

  const result = await run(
    [
      'assess',
      '--format',
      'json',
      '--scoreboard',
      'missing-scoreboard.json',
      '--report',
      'report.md',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  const scoreboardReport = objectWithString(
    jsonObjects(getArray(assessment, 'scorecard')),
    'id',
    'scoreboard-report',
  );
  expect(getString(scoreboardReport ?? {}, 'status')).toBe('partial');
  expect(getString(scoreboardReport ?? {}, 'summary')).toContain(
    'scoreboard not found: missing-scoreboard.json',
  );
});

test('assess requires harness-generated report text for scoreboard/report maturity', async () => {
  const result = await run([
    'assess',
    '--format',
    'json',
    '--file',
    'examples/harness.yaml',
    '--doctor-result',
    'examples/doctor/results/pass.json',
    '--run-results',
    'examples/run-results/run-result.json',
    '--trace',
    'examples/traces/native-cli-trace.json',
    '--scoreboard',
    'examples/scoreboards/self-test.json',
    '--report',
    'docs/cli.md',
  ]);
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(assessment, 'status')).toBe('needs-work');
  const scoreboardReport = objectWithString(
    jsonObjects(getArray(assessment, 'scorecard')),
    'id',
    'scoreboard-report',
  );
  expect(getString(scoreboardReport ?? {}, 'status')).toBe('partial');
  expect(getString(scoreboardReport ?? {}, 'summary')).toContain(
    'report must be generated by harness report',
  );
});

test('assess downgrades failing doctor, run-result, and scoreboard evidence', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await writeFile(
    join(root, 'doctor-fail.json'),
    await readFile('examples/doctor/results/fail.json', 'utf8'),
  );
  await writeFile(
    join(root, 'run-failed.json'),
    await readFile('examples/run-results/failed-run-result.json', 'utf8'),
  );
  const scoreboard = await loadDocument('examples/scoreboards/self-test.json');
  if (!isObject(scoreboard)) {
    throw new Error('scoreboard fixture must be an object');
  }
  await writeFile(
    join(root, 'scoreboard-failed.json'),
    JSON.stringify({ ...scoreboard, status: 'failed' }, null, 2),
  );
  await writeFile(
    join(root, 'report.md'),
    'Harness report\n- harness: harness.yaml\n- cited paths:\n  - harness.yaml\n',
  );

  const result = await run(
    [
      'assess',
      '--format',
      'json',
      '--doctor-result',
      'doctor-fail.json',
      '--run-results',
      'run-failed.json',
      '--scoreboard',
      'scoreboard-failed.json',
      '--report',
      'report.md',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(assessment, 'status')).toBe('needs-work');
  const scorecard = jsonObjects(getArray(assessment, 'scorecard'));
  expect(getString(objectWithString(scorecard, 'id', 'doctor-evidence') ?? {}, 'status')).toBe(
    'partial',
  );
  expect(getString(objectWithString(scorecard, 'id', 'run-results') ?? {}, 'status')).toBe(
    'partial',
  );
  expect(getString(objectWithString(scorecard, 'id', 'scoreboard-report') ?? {}, 'status')).toBe(
    'partial',
  );
  expect(
    getString(objectWithString(scorecard, 'id', 'doctor-evidence') ?? {}, 'summary'),
  ).toContain('not passing');
  expect(getString(objectWithString(scorecard, 'id', 'run-results') ?? {}, 'summary')).toContain(
    '0 passed',
  );
  expect(
    getString(objectWithString(scorecard, 'id', 'scoreboard-report') ?? {}, 'summary'),
  ).toContain('Scoreboard status is failed');
});

test('assess accepts JSON run-result arrays and summarizes each entry', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const passedRun = await loadDocument('examples/run-results/run-result.json');
  const failedRun = await loadDocument('examples/run-results/failed-run-result.json');
  await writeFile(join(root, 'run-results.json'), JSON.stringify([passedRun, failedRun], null, 2));

  const result = await run(
    ['assess', '--format', 'json', '--run-results', 'run-results.json'],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  const runResults = objectWithString(
    jsonObjects(getArray(assessment, 'scorecard')),
    'id',
    'run-results',
  );
  expect(getString(runResults ?? {}, 'status')).toBe('partial');
  expect(getString(runResults ?? {}, 'summary')).toContain('2 run-result record(s)');
  expect(getString(runResults ?? {}, 'summary')).toContain('1 passed, 1 failed');
  expect(getString(runResults ?? {}, 'summary')).toContain('all counted records must be passed');
});

test('assess falls back to direct CLI guidance when no native route is configured', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const harnessPath = join(root, 'harness.yaml');
  const harness = await readFile(harnessPath, 'utf8');
  const withoutContinuity = harness.replace(/^continuity:\n(?: {2}.+\n)+/m, '');
  expect(withoutContinuity).not.toContain('continuity:');
  await writeFile(harnessPath, withoutContinuity);

  const result = await run(
    [
      'assess',
      '--format',
      'json',
      '--repair-actions-dir',
      'examples/fixtures/missing-repair-actions',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(getObject(assessment, 'implementation_routing') ?? {}, 'selected_route')).toBe(
    'cli-fallback',
  );
  const routes = jsonObjects(
    getArray(getObject(assessment, 'implementation_routing') ?? {}, 'routes'),
  );
  const fallbackRoute = objectWithString(routes, 'id', 'cli-fallback') ?? {};
  expect('command' in fallbackRoute).toBe(false);
  expect(
    getString(
      objectWithString(jsonObjects(getArray(assessment, 'scorecard')), 'id', 'continuity-loop') ??
        {},
      'status',
    ),
  ).toBe('missing');
});

test('assess reports invalid repair actions without selecting them', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await mkdir(join(root, 'examples/repair-actions'), { recursive: true });
  await writeFile(
    join(root, 'examples/repair-actions/invalid.yaml'),
    'schema_version: "0.1.0"\naction_id: invalid-repair\n',
  );

  const result = await run(['assess', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(getObject(assessment, 'implementation_routing') ?? {}, 'selected_route')).toBe(
    'execution-loop',
  );
  const routing = getObject(assessment, 'implementation_routing') ?? {};
  const routes = jsonObjects(getArray(routing, 'routes'));
  expect(routes.some((route) => getString(route, 'kind') === 'repair-action')).toBe(false);
  const repairScore = objectWithString(
    jsonObjects(getArray(assessment, 'scorecard')),
    'id',
    'repair-routing',
  );
  expect(getString(repairScore ?? {}, 'status')).toBe('partial');
  expect(getString(repairScore ?? {}, 'summary')).toContain('none are schema-valid');
});

test('assess reports proposed repair actions without selecting them', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const harnessPath = join(root, 'harness.yaml');
  await writeFile(
    harnessPath,
    `${await readFile(harnessPath, 'utf8')}\nplugins:\n  copilot:\n    enabled: true\n`,
  );
  await mkdir(join(root, 'examples/repair-actions'), { recursive: true });
  const proposedRepairAction = (
    await readFile('examples/repair-actions/advisory-cli-redirect.yaml', 'utf8')
  ).replaceAll('examples/harness.yaml', 'harness.yaml');
  await writeFile(join(root, 'examples/repair-actions/proposed.yaml'), proposedRepairAction);

  const result = await run(['assess', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(getObject(assessment, 'implementation_routing') ?? {}, 'selected_route')).toBe(
    'execution-loop',
  );
  const routing = getObject(assessment, 'implementation_routing') ?? {};
  const repairRoute = objectWithString(
    jsonObjects(getArray(routing, 'routes')),
    'id',
    'repair-action:advisory-cli-redirect',
  );
  expect(getString(repairRoute ?? {}, 'status')).toBe('needs-approval');
  expect(getString(repairRoute ?? {}, 'applicability')).toBe('applicable');
  expect(getString(repairRoute ?? {}, 'approval_trust')).toBe('untrusted');
  expect(getString(repairRoute ?? {}, 'approval_state')).toBe('proposed');
  const repairScore = objectWithString(
    jsonObjects(getArray(assessment, 'scorecard')),
    'id',
    'repair-routing',
  );
  expect(getString(repairScore ?? {}, 'status')).toBe('partial');
  expect(getString(repairScore ?? {}, 'summary')).toContain(
    'none have trusted approval for routing',
  );
});

test('assess rejects unsafe repair action identifiers before routing output', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await mkdir(join(root, 'examples/repair-actions'), { recursive: true });
  const unsafeRepairAction = (
    await readFile('examples/repair-actions/approved-schema-fix.yaml', 'utf8')
  ).replace('action_id: approved-schema-fix', 'action_id: "unsafe route"');
  await writeFile(join(root, 'examples/repair-actions/unsafe.yaml'), unsafeRepairAction);

  const result = await run(['assess', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(getObject(assessment, 'implementation_routing') ?? {}, 'selected_route')).toBe(
    'execution-loop',
  );
  const routes = jsonObjects(
    getArray(getObject(assessment, 'implementation_routing') ?? {}, 'routes'),
  );
  expect(routes.some((route) => getString(route, 'kind') === 'repair-action')).toBe(false);
  const repairScore = objectWithString(
    jsonObjects(getArray(assessment, 'scorecard')),
    'id',
    'repair-routing',
  );
  expect(getString(repairScore ?? {}, 'status')).toBe('partial');
  expect(getString(repairScore ?? {}, 'summary')).toContain('pattern');
});

test('assess rejects unsafe trusted repair action ids', async () => {
  const result = await run([
    'assess',
    '--format',
    'json',
    '--trusted-repair-action',
    '../approved-schema-fix',
  ]);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('--trusted-repair-action');
});

test('assess rejects duplicate repair action ids before trusting approvals', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await mkdir(join(root, 'examples/fixtures/invalid'), { recursive: true });
  await writeFile(
    join(root, 'examples/fixtures/invalid/harness-with-plugin-key.yaml'),
    await readFile('examples/fixtures/invalid/harness-with-plugin-key.yaml', 'utf8'),
  );
  await mkdir(join(root, 'examples/repair-actions'), { recursive: true });
  const approvedRepairAction = await readFile(
    'examples/repair-actions/approved-schema-fix.yaml',
    'utf8',
  );
  await writeFile(join(root, 'examples/repair-actions/first.yaml'), approvedRepairAction);
  await writeFile(join(root, 'examples/repair-actions/second.yaml'), approvedRepairAction);

  const result = await run(
    [
      'assess',
      '--format',
      'json',
      '--file',
      'examples/fixtures/invalid/harness-with-plugin-key.yaml',
      '--trusted-repair-action',
      'approved-schema-fix',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(getObject(assessment, 'implementation_routing') ?? {}, 'selected_route')).toBe(
    'execution-loop',
  );
  const routes = jsonObjects(
    getArray(getObject(assessment, 'implementation_routing') ?? {}, 'routes'),
  );
  expect(routes.some((route) => getString(route, 'kind') === 'repair-action')).toBe(false);
  const repairScore = objectWithString(
    jsonObjects(getArray(assessment, 'scorecard')),
    'id',
    'repair-routing',
  );
  expect(getString(repairScore ?? {}, 'status')).toBe('partial');
  expect(getString(repairScore ?? {}, 'summary')).toContain('duplicate action_id');
});

test('assess reports mixed approved and invalid repair action candidates', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await mkdir(join(root, 'examples/fixtures/invalid'), { recursive: true });
  await writeFile(
    join(root, 'examples/fixtures/invalid/harness-with-plugin-key.yaml'),
    await readFile('examples/fixtures/invalid/harness-with-plugin-key.yaml', 'utf8'),
  );
  await mkdir(join(root, 'examples/repair-actions'), { recursive: true });
  await writeFile(
    join(root, 'examples/repair-actions/valid.yaml'),
    await readFile('examples/repair-actions/approved-schema-fix.yaml', 'utf8'),
  );
  await writeFile(
    join(root, 'examples/repair-actions/invalid.yaml'),
    'schema_version: "0.1.0"\naction_id: invalid-repair\n',
  );

  const result = await run(
    [
      'assess',
      '--format',
      'json',
      '--file',
      'examples/fixtures/invalid/harness-with-plugin-key.yaml',
      '--trusted-repair-action',
      'approved-schema-fix',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const assessment = JSON.parse(result.stdout);
  expect(getString(getObject(assessment, 'implementation_routing') ?? {}, 'selected_route')).toBe(
    'repair-action',
  );
  const repairScore = objectWithString(
    jsonObjects(getArray(assessment, 'scorecard')),
    'id',
    'repair-routing',
  );
  expect(getString(repairScore ?? {}, 'status')).toBe('partial');
  expect(getString(repairScore ?? {}, 'summary')).toContain(
    '1 trusted applicable approved repair action candidate(s) discovered, but 1 candidate(s) are invalid',
  );
});

test('assess rejects artifact paths that escape root', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);
  await run(['init'], root);
  await writeFile(join(parent, 'doctor.json'), '{}');

  const result = await run(['assess', '--doctor-result', '../doctor.json'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('doctor result escapes root');
});

test('assess rejects symlinked artifact inputs', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  const outside = join(parent, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await run(['init'], root);
  await writeFile(
    join(outside, 'trace.json'),
    await readFile('examples/traces/native-cli-trace.json', 'utf8'),
  );
  await symlink(join(outside, 'trace.json'), join(root, 'trace-link.json'));

  const result = await run(['assess', '--trace', 'trace-link.json'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Refusing to read through symlink');
});

test('loop validate accepts start and complete gates', async () => {
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

test('migrate rejects apply mode during the no-op phase', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const result = await run(['migrate', '--apply'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('migrate currently only supports dry-run/no-op evidence');
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

test('health emits schema-valid JSON and can feed assess', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const missingFlag = await run(['health', '--format', 'json'], root);
  expect(missingFlag.code).toBe(ExitCode.usageError);
  expect(missingFlag.stderr).toContain('--accept-unsandboxed-execution');
  const harnessPath = join(root, 'harness.yaml');
  const harness = await readFile(harnessPath, 'utf8');
  await writeFile(
    harnessPath,
    harness.replace(
      '        - path: AGENTS.md\n          media_type: text/markdown\n          description: Agent instruction file.',
      '        - path: AGENTS.md\n          media_type: text/markdown\n          description: Agent instruction file.\n        - path: https://example.invalid/health-reference\n          media_type: text/plain\n          description: External health reference that does not require allowed_inputs.',
    ),
  );
  const healthPath = '.harness/health/result.json';
  const health = await run(
    ['health', '--accept-unsandboxed-execution', '--format', 'json', '--output', healthPath],
    root,
  );
  expect(health.code).toBe(ExitCode.ok);
  expect(health.stdout).toContain('harness health passed');
  const healthResult = JSON.parse(await readFile(join(root, healthPath), 'utf8'));
  expect(getString(healthResult, 'status')).toBe('passed');
  expect(getString(healthResult, 'sandbox_enforcement')).toBe('declarative');
  expect(healthResult.runtime_enforced).toBe(false);
  const healthCheck = jsonObjects(getArray(healthResult, 'checks'))[0] ?? {};
  expect(getString(healthCheck, 'id')).toBe('docs-present');
  expect(getString(healthCheck, 'sandbox_enforcement')).toBe('declarative');
  expect(getBoolean(healthCheck, 'runtime_enforced')).toBe(false);
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('health-result', healthResult)).toEqual([]);

  const assessment = await run(['assess', '--format', 'json', '--health-result', healthPath], root);
  expect(assessment.code).toBe(ExitCode.ok);
  const assessmentJson = JSON.parse(assessment.stdout);
  expect(getString(assessmentJson, 'scorecard_version')).toBe('0.2.0');
  expect(getObject(assessmentJson, 'maturity')).toMatchObject({ max_score: 10 });
  expect(
    getString(
      objectWithString(
        jsonObjects(getArray(assessmentJson, 'scorecard')),
        'id',
        'project-health',
      ) ?? {},
      'status',
    ),
  ).toBe('present');
  expect(schemas.validate('assessment', assessmentJson)).toEqual([]);

  const staleHealthPath = '.harness/health/stale-result.json';
  await writeFile(
    join(root, staleHealthPath),
    JSON.stringify(
      {
        ...healthResult,
        checks: [
          {
            ...healthCheck,
            status: 'failed',
            failure_code: 'command-failed',
            summary: 'Stale failed check should not bind as present.',
          },
          {
            ...healthCheck,
            id: 'extra-stale-check',
          },
        ],
      },
      null,
      2,
    ),
  );
  const staleAssessment = await run(
    ['assess', '--format', 'json', '--health-result', staleHealthPath],
    root,
  );
  expect(staleAssessment.code).toBe(ExitCode.ok);
  const staleAssessmentJson = JSON.parse(staleAssessment.stdout);
  const staleProjectHealth =
    objectWithString(
      jsonObjects(getArray(staleAssessmentJson, 'scorecard')),
      'id',
      'project-health',
    ) ?? {};
  expect(getString(staleProjectHealth, 'status')).toBe('partial');
  expect(getString(staleProjectHealth, 'summary')).toContain('is not configured');
  expect(getString(staleProjectHealth, 'summary')).toContain('status is not passed');

  const noHealthAssessment = await run(['assess', '--format', 'json'], root);
  expect(noHealthAssessment.code).toBe(ExitCode.ok);
  const noHealthAssessmentJson = JSON.parse(noHealthAssessment.stdout);
  expect(getObject(noHealthAssessmentJson, 'maturity')).toMatchObject({ max_score: 10 });
  expect(
    getString(
      objectWithString(
        jsonObjects(getArray(noHealthAssessmentJson, 'scorecard')),
        'id',
        'project-health',
      ) ?? {},
      'status',
    ),
  ).toBe('missing');
});

test('health reports failed checks with a distinct exit code', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const harnessPath = join(root, 'harness.yaml');
  const harness = await readFile(harnessPath, 'utf8');
  await writeFile(
    harnessPath,
    harness.replace('test -f README.md && test -f AGENTS.md', 'test -f missing-health-file.txt'),
  );
  const result = await run(['health', '--accept-unsandboxed-execution', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.healthFailure);
  const healthResult = JSON.parse(result.stdout);
  expect(getString(healthResult, 'status')).toBe('failed');
  expect(getString(jsonObjects(getArray(healthResult, 'checks'))[0] ?? {}, 'failure_code')).toBe(
    'command-failed',
  );
});

test('health refuses unsafe and policy-mismatched declarations', async () => {
  const unsafeRoot = await tempRoot();
  await run(['init'], unsafeRoot);
  const unsafeHarnessPath = join(unsafeRoot, 'harness.yaml');
  const unsafeHarness = await readFile(unsafeHarnessPath, 'utf8');
  await writeFile(
    unsafeHarnessPath,
    unsafeHarness.replace(
      '      command:\n        command: test -f README.md && test -f AGENTS.md\n        timeout_seconds: 30\n      trust_requirements:\n        trust_level: sandboxed',
      '      command:\n        command: test -f README.md && test -f AGENTS.md\n        timeout_seconds: 30\n      trust_requirements:\n        trust_level: trusted',
    ),
  );
  const unsafe = await run(
    ['health', '--accept-unsandboxed-execution', '--format', 'json'],
    unsafeRoot,
  );
  expect(unsafe.code).toBe(ExitCode.validationError);
  const unsafeCheck = jsonObjects(getArray(JSON.parse(unsafe.stdout), 'checks'))[0] ?? {};
  expect(getString(unsafeCheck, 'status')).toBe('skipped');
  expect(getString(unsafeCheck, 'failure_code')).toBe('trust-requirements-unsafe');

  const networkRoot = await tempRoot();
  await run(['init'], networkRoot);
  const networkHarnessPath = join(networkRoot, 'harness.yaml');
  const networkHarness = await readFile(networkHarnessPath, 'utf8');
  await writeFile(
    networkHarnessPath,
    networkHarness.replace(
      '      command:\n        command: test -f README.md && test -f AGENTS.md\n        timeout_seconds: 30\n      trust_requirements:\n        trust_level: sandboxed\n        sandbox_required: process\n        network_access: false',
      '      command:\n        command: test -f README.md && test -f AGENTS.md\n        timeout_seconds: 30\n      trust_requirements:\n        trust_level: sandboxed\n        sandbox_required: process\n        network_access: true',
    ),
  );
  const network = await run(
    ['health', '--accept-unsandboxed-execution', '--format', 'json'],
    networkRoot,
  );
  expect(network.code).toBe(ExitCode.validationError);
  const networkCheck = jsonObjects(getArray(JSON.parse(network.stdout), 'checks'))[0] ?? {};
  expect(getString(networkCheck, 'status')).toBe('skipped');
  expect(getString(networkCheck, 'failure_code')).toBe('trust-requirements-unsafe');

  const root = await tempRoot();
  await run(['init'], root);
  const sandboxPath = join(root, 'examples/policies/sandbox-policy.yaml');
  const sandbox = await readFile(sandboxPath, 'utf8');
  await writeFile(sandboxPath, sandbox.replace('allow_spawn: true', 'allow_spawn: false'));
  const result = await run(['health', '--accept-unsandboxed-execution', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.validationError);
  const check = jsonObjects(getArray(JSON.parse(result.stdout), 'checks'))[0] ?? {};
  expect(getString(check, 'status')).toBe('skipped');
  expect(getString(check, 'failure_code')).toBe('policy-mismatch-process');
});

test('health records timeout errors', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const harnessPath = join(root, 'harness.yaml');
  const harness = await readFile(harnessPath, 'utf8');
  await writeFile(
    harnessPath,
    harness
      .replace('command: test -f README.md && test -f AGENTS.md', 'command: sleep 2')
      .replace('timeout_seconds: 30', 'timeout_seconds: 1'),
  );
  const result = await run(['health', '--accept-unsandboxed-execution', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.healthFailure);
  const check = jsonObjects(getArray(JSON.parse(result.stdout), 'checks'))[0] ?? {};
  expect(getString(check, 'status')).toBe('error');
  expect(getString(check, 'failure_code')).toBe('timeout');
});

test('health refuses missing declared artifacts and symlinked output', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const harnessPath = join(root, 'harness.yaml');
  const harness = await readFile(harnessPath, 'utf8');
  await writeFile(
    harnessPath,
    harness
      .replace(
        '        allowed_inputs:\n          - README.md\n          - AGENTS.md\n        allowed_outputs:\n          - .harness/health',
        '        allowed_inputs:\n          - missing-health-artifact.md\n          - AGENTS.md\n        allowed_outputs:\n          - .harness/health',
      )
      .replace(
        '        - path: README.md\n          media_type: text/markdown\n          description: User-facing project README.',
        '        - path: missing-health-artifact.md\n          media_type: text/markdown\n          description: Missing health fixture.',
      ),
  );
  const missingArtifact = await run(
    ['health', '--accept-unsandboxed-execution', '--format', 'json'],
    root,
  );
  expect(missingArtifact.code).toBe(ExitCode.validationError);
  const missingCheck = jsonObjects(getArray(JSON.parse(missingArtifact.stdout), 'checks'))[0] ?? {};
  expect(getString(missingCheck, 'failure_code')).toBe('missing-artifact');

  await symlink('../../harness.yaml', join(root, '.harness/health/link.json'));
  const beforeSymlinkedOutput = await run(
    ['health', '--output', '.harness/health/link.json'],
    root,
  );
  expect(beforeSymlinkedOutput.code).toBe(ExitCode.usageError);
  expect(beforeSymlinkedOutput.stderr).toContain('Refusing to write through symlink');

  const symlinkedOutput = await run(
    ['health', '--accept-unsandboxed-execution', '--output', '.harness/health/link.json'],
    root,
  );
  expect(symlinkedOutput.code).toBe(ExitCode.usageError);
  expect(symlinkedOutput.stderr).toContain('Refusing to write through symlink');

  const outsideOutput = await run(
    ['health', '--accept-unsandboxed-execution', '--output', '.harness/outside-health.json'],
    root,
  );
  expect(outsideOutput.code).toBe(ExitCode.usageError);
  expect(outsideOutput.stderr).toContain('health --output must be inside health.output_dir');

  const traversalOutput = await run(
    ['health', '--accept-unsandboxed-execution', '--output', '.harness/health/../../harness.yaml'],
    root,
  );
  expect(traversalOutput.code).toBe(ExitCode.usageError);
  expect(traversalOutput.stderr).toContain('health --output must be inside health.output_dir');

  const uniqueOutput = await run(
    ['health', '--accept-unsandboxed-execution', '--output', '.harness/health/result.json'],
    root,
  );
  expect(uniqueOutput.code).toBe(ExitCode.validationError);
  const duplicateOutput = await run(
    ['health', '--accept-unsandboxed-execution', '--output', '.harness/health/result.json'],
    root,
  );
  expect(duplicateOutput.code).toBe(ExitCode.usageError);
  expect(duplicateOutput.stderr).toContain('Health output already exists');
});

test('health rejects symlinked harness before output preflight reads it', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await symlink('harness.yaml', join(root, 'harness-link.yaml'));
  const result = await run(
    ['health', '--file', 'harness-link.yaml', '--output', '.harness/health/symlink-harness.json'],
    root,
  );
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Refusing to read through symlink');
});

test('runner readiness reports stub and live readiness without executing models', async () => {
  const stub = await run([
    'runner',
    'readiness',
    '--file',
    'examples/harness.yaml',
    '--format',
    'json',
  ]);
  expect(stub.code).toBe(ExitCode.ok);
  const stubReadiness = JSON.parse(stub.stdout);
  expect(getString(stubReadiness, 'mode')).toBe('stub');
  expect(getBoolean(stubReadiness, 'live_ready')).toBe(false);
  expect(
    getString(
      objectWithString(
        jsonObjects(getArray(stubReadiness, 'checks')),
        'id',
        'execution-boundary',
      ) ?? {},
      'status',
    ),
  ).toBe('passed');

  const live = await run([
    'runner',
    'readiness',
    '--file',
    'examples/harness.yaml',
    '--runner',
    'examples/agent-runners/live-ready.yaml',
    '--format',
    'json',
  ]);
  expect(live.code).toBe(ExitCode.ok);
  const liveReadiness = JSON.parse(live.stdout);
  expect(getString(liveReadiness, 'mode')).toBe('live');
  expect(getBoolean(liveReadiness, 'live_ready')).toBe(true);
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('runner-readiness', liveReadiness)).toEqual([]);
});

test('runner readiness refuses unsupported live prerequisites', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await writeFile(
    join(root, 'examples/model-profiles/live-ready.yaml'),
    await readFile('examples/model-profiles/live-ready.yaml', 'utf8'),
  );
  await writeFile(
    join(root, 'examples/policies/live-sandbox-policy.yaml'),
    await readFile('examples/policies/live-sandbox-policy.yaml', 'utf8'),
  );
  await writeFile(
    join(root, 'examples/agent-runners/live-missing-redaction.yaml'),
    (await readFile('examples/agent-runners/live-ready.yaml', 'utf8'))
      .replace(
        'sandbox: examples/policies/live-sandbox-policy.yaml',
        'sandbox: examples/policies/sandbox-policy.yaml',
      )
      .replace(/trace_redaction:\n(?: {2}.+\n)+credential_reference:/, 'credential_reference:'),
  );
  const result = await run(
    [
      'runner',
      'readiness',
      '--runner',
      'examples/agent-runners/live-missing-redaction.yaml',
      '--format',
      'json',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.validationError);
  const readiness = JSON.parse(result.stdout);
  expect(getString(readiness, 'status')).toBe('failed');
  expect(
    getString(
      objectWithString(jsonObjects(getArray(readiness, 'checks')), 'id', 'sandbox') ?? {},
      'failure_code',
    ),
  ).toBe('sandbox-violation');
  expect(
    getString(
      objectWithString(jsonObjects(getArray(readiness, 'checks')), 'id', 'trace-redaction') ?? {},
      'failure_code',
    ),
  ).toBe('trace-redaction-missing');

  await writeFile(
    join(root, 'examples/agent-runners/live-stub-model.yaml'),
    (await readFile('examples/agent-runners/live-ready.yaml', 'utf8'))
      .replace(
        'model_profile: examples/model-profiles/live-ready.yaml',
        'model_profile: examples/model-profiles/stub.yaml',
      )
      .replace('trace_output: .harness/traces', 'trace_output: ../../traces'),
  );
  const stubModel = await run(
    [
      'runner',
      'readiness',
      '--runner',
      'examples/agent-runners/live-stub-model.yaml',
      '--format',
      'json',
    ],
    root,
  );
  expect(stubModel.code).toBe(ExitCode.validationError);
  const stubModelReadiness = JSON.parse(stubModel.stdout);
  expect(
    getString(
      objectWithString(
        jsonObjects(getArray(stubModelReadiness, 'checks')),
        'id',
        'model-profile',
      ) ?? {},
      'failure_code',
    ),
  ).toBe('model-profile-stub');
  expect(
    getString(
      objectWithString(jsonObjects(getArray(stubModelReadiness, 'checks')), 'id', 'trace-output') ??
        {},
      'failure_code',
    ),
  ).toBe('trace-output-invalid');

  await writeFile(
    join(root, 'examples/policies/live-sandbox-policy-extra-secret.yaml'),
    (await readFile('examples/policies/live-sandbox-policy.yaml', 'utf8'))
      .replace('    - HARNESS_LIVE_API_KEY', '    - HARNESS_LIVE_API_KEY\n    - EXTRA_API_KEY')
      .replace('  allowed_secret_refs: []', '  allowed_secret_refs:\n    - vault://extra'),
  );
  await writeFile(
    join(root, 'examples/agent-runners/live-extra-secret.yaml'),
    (await readFile('examples/agent-runners/live-ready.yaml', 'utf8')).replace(
      'sandbox: examples/policies/live-sandbox-policy.yaml',
      'sandbox: examples/policies/live-sandbox-policy-extra-secret.yaml',
    ),
  );
  const extraSecret = await run(
    [
      'runner',
      'readiness',
      '--runner',
      'examples/agent-runners/live-extra-secret.yaml',
      '--format',
      'json',
    ],
    root,
  );
  expect(extraSecret.code).toBe(ExitCode.validationError);
  expect(
    getString(
      objectWithString(
        jsonObjects(getArray(JSON.parse(extraSecret.stdout), 'checks')),
        'id',
        'sandbox',
      ) ?? {},
      'failure_code',
    ),
  ).toBe('sandbox-violation');
});

test('profile validates and runs gc stability evidence', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await mkdir(join(root, '.harness/gc'), { recursive: true });
  await writeFile(
    join(root, '.harness/gc/clean.json'),
    JSON.stringify(
      {
        schema_version: '0.1.0',
        audit_id: 'profile-clean-gc',
        generated_at: '2026-05-26T00:00:00Z',
        findings: [],
      },
      null,
      2,
    ),
  );
  const health = await run(
    [
      'health',
      '--accept-unsandboxed-execution',
      '--format',
      'json',
      '--output',
      '.harness/health/profile-health.json',
      '--run-id',
      'profile-health',
    ],
    root,
  );
  expect(health.code).toBe(ExitCode.ok);

  const validate = await run(['profile', 'validate', 'examples/profiles/gc-stability.yaml'], root);
  expect(validate.code).toBe(ExitCode.ok);

  const result = await run(
    [
      'profile',
      'run',
      'examples/profiles/gc-stability.yaml',
      '--gc-evidence',
      '.harness/gc/clean.json',
      '--health-result',
      '.harness/health/profile-health.json',
      '--output',
      '.harness/profiles/gc-stability.json',
      '--run-id',
      'profile-clean',
      '--format',
      'json',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  expect(result.stdout).toContain('harness profile run met');
  const profileRun = JSON.parse(
    await readFile(join(root, '.harness/profiles/gc-stability.json'), 'utf8'),
  );
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('profile-run', profileRun)).toEqual([]);
  expect(getString(profileRun, 'profile_id')).toBe('gc-stability');
  expect(getString(getObject(profileRun, 'handoff') ?? {}, 'next_step')).toBe('stop');
  expect(getString(getObject(profileRun, 'handoff') ?? {}, 'status')).toBe('met');
  expect(getString(jsonObjects(getArray(profileRun, 'evidence_inputs'))[0] ?? {}, 'kind')).toBe(
    'gc-evidence',
  );

  const repeated = await run(
    [
      'profile',
      'run',
      'examples/profiles/gc-stability.yaml',
      '--gc-evidence',
      '.harness/gc/clean.json',
      '--health-result',
      '.harness/health/profile-health.json',
      '--previous-run',
      '.harness/profiles/gc-stability.json',
      '--run-id',
      'profile-clean-repeat',
      '--format',
      'json',
    ],
    root,
  );
  expect(repeated.code).toBe(ExitCode.ok);
  const repeatedRun = JSON.parse(repeated.stdout);
  expect(
    getNumberForTest(getObject(repeatedRun, 'stop_condition_evaluation') ?? {}, 'clean_streak'),
  ).toBe(2);

  await writeFile(
    join(root, '.harness/profiles/foreign.json'),
    JSON.stringify({ ...profileRun, profile_id: 'other-profile' }, null, 2),
  );
  const foreignPrevious = await run(
    [
      'profile',
      'run',
      'examples/profiles/gc-stability.yaml',
      '--gc-evidence',
      '.harness/gc/clean.json',
      '--health-result',
      '.harness/health/profile-health.json',
      '--previous-run',
      '.harness/profiles/foreign.json',
      '--format',
      'json',
    ],
    root,
  );
  expect(foreignPrevious.code).toBe(ExitCode.validationError);
  expect(foreignPrevious.stderr).toContain(
    'previous profile run profile_id other-profile does not match',
  );

  const profileWithoutPreviousInput = (
    await readFile(join(root, 'examples/profiles/gc-stability.yaml'), 'utf8')
  ).replace(/ {2}- id: previous-gc-stability\n {4}kind: profile-run\n {4}required: false\n/, '');
  await writeFile(
    join(root, 'examples/profiles/gc-stability-no-previous.yaml'),
    profileWithoutPreviousInput,
  );
  const harnessPath = join(root, 'harness.yaml');
  await writeFile(
    harnessPath,
    (await readFile(harnessPath, 'utf8')).replace(
      '    - examples/profiles/gc-stability.yaml',
      '    - examples/profiles/gc-stability.yaml\n    - examples/profiles/gc-stability-no-previous.yaml',
    ),
  );
  const undeclaredPrevious = await run(
    [
      'profile',
      'run',
      'examples/profiles/gc-stability-no-previous.yaml',
      '--gc-evidence',
      '.harness/gc/clean.json',
      '--health-result',
      '.harness/health/profile-health.json',
      '--previous-run',
      '.harness/profiles/gc-stability.json',
      '--format',
      'json',
    ],
    root,
  );
  expect(undeclaredPrevious.code).toBe(ExitCode.validationError);
  expect(undeclaredPrevious.stderr).toContain('profile-run evidence');

  const missingRequired = await run(
    [
      'profile',
      'run',
      'examples/profiles/gc-stability.yaml',
      '--health-result',
      '.harness/health/profile-health.json',
      '--format',
      'json',
    ],
    root,
  );
  expect(missingRequired.code).toBe(ExitCode.validationError);
  expect(missingRequired.stderr).toContain('profile run requires --gc-evidence');

  await writeFile(
    join(root, 'examples/profiles/unlisted.yaml'),
    await readFile(join(root, 'examples/profiles/gc-stability.yaml'), 'utf8'),
  );
  const unlisted = await run(
    [
      'profile',
      'run',
      '--profile',
      'examples/profiles/unlisted.yaml',
      '--gc-evidence',
      '.harness/gc/clean.json',
      '--health-result',
      '.harness/health/profile-health.json',
      '--format',
      'json',
    ],
    root,
  );
  expect(unlisted.code).toBe(ExitCode.validationError);
  expect(unlisted.stderr).toContain('recurring_profiles.profiles');

  const outsideOutput = await run(
    [
      'profile',
      'run',
      'examples/profiles/gc-stability.yaml',
      '--gc-evidence',
      '.harness/gc/clean.json',
      '--health-result',
      '.harness/health/profile-health.json',
      '--output',
      'profile-outside.json',
    ],
    root,
  );
  expect(outsideOutput.code).toBe(ExitCode.validationError);
  expect(outsideOutput.stderr).toContain('profile output must be under');

  const outsideInput = await run(
    [
      'profile',
      'run',
      'examples/profiles/gc-stability.yaml',
      '--gc-evidence',
      'gc-outside.json',
      '--health-result',
      '.harness/health/profile-health.json',
      '--format',
      'json',
    ],
    root,
  );
  expect(outsideInput.code).toBe(ExitCode.validationError);
  expect(outsideInput.stderr).toContain('trust_requirements.allowed_inputs');

  const traversalInput = await run(
    [
      'profile',
      'run',
      'examples/profiles/gc-stability.yaml',
      '--gc-evidence',
      '.harness/gc/../../harness.yaml',
      '--health-result',
      '.harness/health/profile-health.json',
      '--format',
      'json',
    ],
    root,
  );
  expect(traversalInput.code).toBe(ExitCode.validationError);
  expect(traversalInput.stderr).toContain('trust_requirements.allowed_inputs');

  const traversalOutput = await run(
    [
      'profile',
      'run',
      'examples/profiles/gc-stability.yaml',
      '--gc-evidence',
      '.harness/gc/clean.json',
      '--health-result',
      '.harness/health/profile-health.json',
      '--output',
      '.harness/profiles/../profile-outside.json',
    ],
    root,
  );
  expect(traversalOutput.code).toBe(ExitCode.validationError);
  expect(traversalOutput.stderr).toContain('profile output must be under');
});

test('profile run reports not-met without cleanup for dirty gc evidence', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await mkdir(join(root, '.harness/gc'), { recursive: true });
  await writeFile(
    join(root, '.harness/gc/dirty.json'),
    JSON.stringify(
      {
        schema_version: '0.1.0',
        audit_id: 'profile-dirty-gc',
        generated_at: '2026-05-26T00:00:00Z',
        findings: [
          {
            category: 'broken-reference',
            severity: 'error',
            confidence: 1,
            evidence_refs: [
              {
                path: 'harness.yaml',
                media_type: 'application/yaml',
                description: 'Dirty fixture evidence.',
              },
            ],
            proposed_cleanup_slice: {
              id: 'review-broken-reference',
              description: 'Review broken reference.',
              target_files: ['harness.yaml'],
            },
            blast_radius: 'Fixture only.',
            atomicity_notes: 'Review independently.',
            promotion_decision_refs: [],
            retirement_decision_refs: [],
          },
        ],
      },
      null,
      2,
    ),
  );
  const health = await run(
    [
      'health',
      '--accept-unsandboxed-execution',
      '--format',
      'json',
      '--output',
      '.harness/health/profile-health.json',
    ],
    root,
  );
  expect(health.code).toBe(ExitCode.ok);

  const result = await run(
    [
      'profile',
      'run',
      '--profile',
      'examples/profiles/gc-stability.yaml',
      '--gc-evidence',
      '.harness/gc/dirty.json',
      '--health-result',
      '.harness/health/profile-health.json',
      '--format',
      'json',
      '--run-id',
      'profile-dirty',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const profileRun = JSON.parse(result.stdout);
  expect(getString(getObject(profileRun, 'handoff') ?? {}, 'status')).toBe('not_met');
  expect(getString(getObject(profileRun, 'handoff') ?? {}, 'next_step')).toBe('continue');
  expect(
    getString(
      getObject(jsonObjects(getArray(profileRun, 'actions_taken'))[0] ?? {}, 'summary') ?? {},
      'status',
    ),
  ).toBe('not_met');
});

test('gc audit emits schema-valid JSON for a healthy harness', async () => {
  const result = await run([
    'gc',
    'audit',
    '--format',
    'json',
    '--file',
    'examples/harness.yaml',
    '--audit-id',
    'test-gc-clean',
    '--generated-at',
    '2026-05-24T00:00:00Z',
  ]);
  expect(result.code).toBe(ExitCode.ok);
  const evidence = JSON.parse(result.stdout);
  expect(getString(evidence, 'audit_id')).toBe('test-gc-clean');
  expect(getArray(evidence, 'findings')).toEqual([]);
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('gc-evidence', evidence)).toEqual([]);
});

test('gc audit detects deterministic categories', async () => {
  const brokenReference = await run([
    'gc',
    'audit',
    '--format',
    'json',
    '--file',
    'examples/fixtures/gc/broken-reference-harness.yaml',
  ]);
  expect(brokenReference.code).toBe(ExitCode.ok);
  expect(
    jsonObjects(getArray(JSON.parse(brokenReference.stdout), 'findings')).some(
      (finding) => getString(finding, 'category') === 'broken-reference',
    ),
  ).toBe(true);

  const stale = await run([
    'gc',
    'audit',
    '--format',
    'json',
    '--file',
    'examples/fixtures/gc/stale-schema-version-harness.yaml',
  ]);
  expect(stale.code).toBe(ExitCode.ok);
  expect(
    jsonObjects(getArray(JSON.parse(stale.stdout), 'findings')).some(
      (finding) => getString(finding, 'category') === 'stale-schema-version',
    ),
  ).toBe(true);

  const duplicate = await run([
    'gc',
    'audit',
    '--format',
    'json',
    '--file',
    'examples/fixtures/gc/duplicate-doctor-id-harness.yaml',
  ]);
  expect(duplicate.code).toBe(ExitCode.ok);
  const duplicateFinding = jsonObjects(getArray(JSON.parse(duplicate.stdout), 'findings')).find(
    (finding) => getString(finding, 'category') === 'duplicate-id',
  );
  expect(duplicateFinding).toBeDefined();
  expect(
    getArray(getObject(duplicateFinding ?? {}, 'proposed_cleanup_slice') ?? {}, 'target_files'),
  ).toEqual(['examples/fixtures/gc/duplicate-doctor-id-harness.yaml']);
});

test('gc audit accepts explicit capability ledger path', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await writeFile(
    join(root, 'custom-capabilities.yaml'),
    [
      'capabilities:',
      '  - capability_id: duplicate-capability',
      '  - capability_id: duplicate-capability',
      '',
    ].join('\n'),
  );
  const result = await run(
    ['gc', 'audit', '--format', 'json', '--capability-ledger', 'custom-capabilities.yaml'],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  expect(
    jsonObjects(getArray(JSON.parse(result.stdout), 'findings')).some(
      (finding) => getString(finding, 'category') === 'duplicate-id',
    ),
  ).toBe(true);
});

test('gc audit accepts run-result JSONL evidence', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const failedRunResult = await readFile('examples/run-results/failed-run-result.json', 'utf8');
  const runResult = JSON.parse(failedRunResult) as JsonObject;
  const firstRecord = { ...runResult, run_id: 'run-cleanup-collision' };
  const secondRecord = { ...runResult, run_id: 'run-cleanup-collision' };
  const collidingRecord = { ...runResult, run_id: 'run-cleanup-collision-2' };
  await writeFile(
    join(root, '.harness/run-results.JSONL'),
    `${JSON.stringify(firstRecord)}\n${JSON.stringify(secondRecord)}\n${JSON.stringify(collidingRecord)}\n`,
  );
  const result = await run(
    ['gc', 'audit', '--format', 'json', '--run-results', '.harness/run-results.JSONL'],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const findings = jsonObjects(getArray(JSON.parse(result.stdout), 'findings'));
  expect(findings.some((finding) => getString(finding, 'category') === 'execution-evidence')).toBe(
    true,
  );
  const cleanupIds = findings
    .map((finding) => getString(getObject(finding, 'proposed_cleanup_slice') ?? {}, 'id'))
    .filter((id): id is string => id !== undefined);
  expect(new Set(cleanupIds).size).toBe(cleanupIds.length);
  const evidenceRefs = findings.flatMap((finding) =>
    jsonObjects(getArray(finding, 'evidence_refs')),
  );
  expect(evidenceRefs.some((ref) => getString(ref, 'media_type') === 'application/jsonl')).toBe(
    true,
  );
});

test('gc audit detects evidence-driven categories', async () => {
  const result = await run([
    'gc',
    'audit',
    '--format',
    'json',
    '--file',
    'examples/harness.yaml',
    '--verification',
    'examples/fixtures/execution-loop/completion-failed-acceptance.yaml',
    '--run-results',
    'examples/run-results/failed-run-result.json',
    '--scoreboard',
    'examples/fixtures/gc/failing-scoreboard.json',
    '--trace',
    'examples/fixtures/gc/failing-trace.json',
    '--judge-result',
    'examples/judges/results/stale-advisory.json',
  ]);
  expect(result.code).toBe(ExitCode.ok);
  const categories = jsonObjects(getArray(JSON.parse(result.stdout), 'findings')).map((finding) =>
    getString(finding, 'category'),
  );
  expect(categories).toContain('verification-evidence');
  expect(categories).toContain('execution-evidence');
  expect(categories).toContain('eval-evidence');
  expect(categories).toContain('trace-evidence');
  expect(categories).toContain('judge-calibration');
});

test('gc validate accepts schema-valid evidence and rejects semantic gaps', async () => {
  const valid = await run(['gc', 'validate', 'examples/gc/evidence.json', '--format', 'json']);
  expect(valid.code).toBe(ExitCode.ok);
  expect(getString(JSON.parse(valid.stdout), 'status')).toBe('passed');

  const root = await tempRoot();
  const invalidPath = join(root, 'invalid-gc.json');
  await writeFile(
    invalidPath,
    JSON.stringify(
      {
        schema_version: '0.1.0',
        audit_id: 'invalid-gc',
        generated_at: '2026-05-24T00:00:00Z',
        findings: [
          {
            category: 'broken-reference',
            severity: 'warning',
            confidence: 0.5,
            evidence_refs: [{ path: 'harness.yaml' }],
            proposed_cleanup_slice: {
              id: 'duplicate-cleanup',
              description: 'Fragment target.',
              target_files: ['harness.yaml#/doctor/checks/0'],
            },
            blast_radius: 'Single file.',
            atomicity_notes: 'Invalid semantic fixture.',
            promotion_decision_refs: [],
            retirement_decision_refs: [],
          },
          {
            category: 'duplicate-id',
            severity: 'warning',
            confidence: 0.5,
            evidence_refs: [{ path: 'harness.yaml' }],
            proposed_cleanup_slice: {
              id: 'duplicate-cleanup',
              description: 'Duplicate cleanup id.',
              target_files: ['harness.yaml'],
            },
            blast_radius: 'None.',
            atomicity_notes: 'Invalid semantic fixture.',
            promotion_decision_refs: [],
            retirement_decision_refs: [],
          },
        ],
      },
      null,
      2,
    ),
  );
  const invalid = await run(['gc', 'validate', 'invalid-gc.json', '--format', 'json'], root);
  expect(invalid.code).toBe(ExitCode.validationError);
  const invalidResult = JSON.parse(invalid.stdout);
  expect(getString(invalidResult, 'status')).toBe('failed');
  expect(getArray(invalidResult, 'issues')?.join('\n')).toContain(
    'duplicates proposed_cleanup_slice.id',
  );
  expect(getArray(invalidResult, 'issues')?.join('\n')).toContain(
    'cleanup target file must not include a fragment',
  );
  expect(getArray(invalidResult, 'issues')?.join('\n')).toContain('path does not exist');
});

test('gc validate checks local references and supports reference-only escapes', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const validEvidence = {
    schema_version: '0.1.0',
    audit_id: 'gc-reference-valid',
    generated_at: '2026-05-24T00:00:00Z',
    previous_audit_ref: 'harness://gc/previous',
    findings: [
      {
        category: 'broken-reference',
        severity: 'warning',
        confidence: 0.5,
        evidence_refs: [{ path: '#/findings/0' }, { path: 'https://example.invalid/gc.json' }],
        proposed_cleanup_slice: {
          id: 'valid-reference-checks',
          description: 'Valid local cleanup target with external evidence refs.',
          target_files: ['harness.yaml'],
        },
        blast_radius: 'Single file.',
        atomicity_notes: 'Reference validation fixture.',
        promotion_decision_refs: [{ path: '#/findings/0' }],
        retirement_decision_refs: [],
      },
    ],
  };
  await writeFile(join(root, 'valid-gc.json'), JSON.stringify(validEvidence, null, 2));
  const valid = await run(['gc', 'validate', 'valid-gc.json', '--format', 'json'], root);
  expect(valid.code).toBe(ExitCode.ok);

  const invalidEvidence = {
    ...validEvidence,
    audit_id: 'gc-reference-invalid',
    previous_audit_ref: '../old-gc.json',
    findings: [
      {
        ...validEvidence.findings[0],
        proposed_cleanup_slice: {
          id: 'invalid-reference-checks',
          description: 'External cleanup target must be rejected.',
          target_files: ['https://example.invalid/cleanup.yaml'],
        },
      },
    ],
  };
  await writeFile(join(root, 'invalid-ref-gc.json'), JSON.stringify(invalidEvidence, null, 2));
  const invalid = await run(['gc', 'validate', 'invalid-ref-gc.json', '--format', 'json'], root);
  expect(invalid.code).toBe(ExitCode.validationError);
  const issues = getArray(JSON.parse(invalid.stdout), 'issues')?.join('\n');
  expect(issues).toContain('previous_audit_ref path is not inside root');
  expect(issues).toContain('cleanup target must be a local file path');

  const skipped = await run(
    ['gc', 'validate', 'invalid-ref-gc.json', '--format', 'json', '--skip-reference-checks'],
    root,
  );
  expect(skipped.code).toBe(ExitCode.ok);
});

test('gc validate rejects symlinked local refs', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await symlink('harness.yaml', join(root, 'harness-link.yaml'));
  await writeFile(
    join(root, 'symlink-gc.json'),
    JSON.stringify(
      {
        schema_version: '0.1.0',
        audit_id: 'gc-symlink',
        generated_at: '2026-05-24T00:00:00Z',
        findings: [
          {
            category: 'broken-reference',
            severity: 'warning',
            confidence: 0.5,
            evidence_refs: [{ path: 'harness-link.yaml' }],
            proposed_cleanup_slice: {
              id: 'symlink-reference',
              description: 'Symlink evidence ref.',
              target_files: ['harness.yaml'],
            },
            blast_radius: 'Single file.',
            atomicity_notes: 'Symlink reference validation fixture.',
            promotion_decision_refs: [],
            retirement_decision_refs: [],
          },
        ],
      },
      null,
      2,
    ),
  );
  const result = await run(['gc', 'validate', 'symlink-gc.json', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.usageError);
  expect(result.stderr).toContain('Refusing to read through symlink');
});

test('gc audit writes append-only output', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const outputPath = '.harness/gc/test-gc.json';
  const first = await run(
    ['gc', 'audit', '--format', 'json', '--output', outputPath, '--audit-id', 'append-only-gc'],
    root,
  );
  expect(first.code).toBe(ExitCode.ok);
  expect(first.stdout).toContain('wrote .harness/gc/test-gc.json');

  const second = await run(['gc', 'audit', '--output', outputPath], root);
  expect(second.code).toBe(ExitCode.usageError);
  expect(second.stderr).toContain('GC output already exists');
});

test('gc audit rejects invalid previous-audit paths before producing evidence', async () => {
  const root = await tempRoot();
  await run(['init'], root);

  const escaped = await run(['gc', 'audit', '--previous-audit', '../old-gc.json'], root);
  expect(escaped.code).toBe(ExitCode.usageError);
  expect(escaped.stderr).toContain('GC previous audit escapes root');

  const missing = await run(['gc', 'audit', '--previous-audit', '.harness/gc/missing.json'], root);
  expect(missing.code).toBe(ExitCode.notFound);
  expect(missing.stderr).toContain('GC previous audit not found');
});

test('gc audit refuses schema-invalid harnesses', async () => {
  const result = await run([
    'gc',
    'audit',
    '--file',
    'examples/fixtures/invalid/harness-with-plugin-key.yaml',
  ]);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stderr).toContain('GC audit requires a schema-valid harness');
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
        dataset_hash: 'sha256:27aa95663ba3847b713dae33b3beed3a33280d3aeeff5cb9177f5bc9817c81fd',
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

test('report rejects symlinked judge artifact reads', async () => {
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
      'sha256:27aa95663ba3847b713dae33b3beed3a33280d3aeeff5cb9177f5bc9817c81fd',
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
    expect(schemas.validate('verifier-result', verifierArtifact)).toEqual([]);
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
  expect(schemas.validate('verifier-result', verifierResult)).toEqual([]);
  expect(getString(verifierResult, 'status')).toBe('passed');
  const agentOutputPath = requiredStringForTest(summary, 'agent_output');
  expect(await readFile(join(root, agentOutputPath), 'utf8')).toContain('schema-smoke passes');
});

test('run imports an external candidate and writes external-import artifacts', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await writeFile(
    join(root, 'candidate.txt'),
    'schema-smoke passes\n\nGenerated outside harness by Copilot-as-model.\n',
  );

  const result = await run(
    [
      'run',
      '--external-candidate',
      'candidate.txt',
      '--external-model-id',
      'copilot-cli',
      '--run-id',
      'stage18-5-import',
      '--session-id',
      'session-stage18-5',
      '--format',
      'json',
    ],
    root,
  );
  expect(result.code).toBe(ExitCode.ok);
  const summary = JSON.parse(result.stdout);
  expect(getString(summary, 'actual_status')).toBe('passed');
  expect(getString(summary, 'source_candidate')).toBe('candidate.txt');

  const runResults = await readJsonLines(join(root, '.harness/run-results.jsonl'));
  expect(runResults.length).toBe(1);
  const runResult = runResults[0] ?? {};
  const schemas = await loadSchemaRegistry(process.cwd());
  expect(schemas.validate('run-result', runResult)).toEqual([]);
  expect(getString(runResult, 'kind')).toBe('external-import');
  expect(getString(runResult, 'model_profile')).toBe('harness://external-import/copilot-cli');
  expect(getObject(runResult, 'execution')).toEqual({
    mode: 'external-import',
    harness_status: 'passed',
    verifier_status: 'passed',
  });
  expect(getString(getObject(runResult, 'usage') ?? {}, 'source')).toBe('external');
  expect(getNumberForTest(getObject(runResult, 'usage') ?? {}, 'requests')).toBe(0);

  const tracePath = requiredStringForTest(summary, 'trace');
  const trace = JSON.parse(await readFile(join(root, tracePath), 'utf8'));
  expect(schemas.validate('trace', trace)).toEqual([]);
  expect(getString(trace, 'determinism_level')).toBe('external-import');
  expect(getString(getObject(trace, 'credential_reference') ?? {}, 'source')).toBe('external');
  expect(getString(getObject(trace, 'usage') ?? {}, 'source')).toBe('external');
  expect(
    jsonObjects(getArray(trace, 'actions')).some(
      (action) => getString(action, 'id') === `${getString(summary, 'run_id')}-external-import`,
    ),
  ).toBe(true);

  const verifierResult = JSON.parse(
    await readFile(join(root, requiredStringForTest(summary, 'verifier_result')), 'utf8'),
  );
  expect(schemas.validate('verifier-result', verifierResult)).toEqual([]);
  expect(getString(verifierResult, 'case')).toBe('oracle');
  expect(getString(verifierResult, 'status')).toBe('passed');

  const externalOnlyAssessment = await run(
    ['assess', '--format', 'json', '--run-results', '.harness/run-results.jsonl'],
    root,
  );
  expect(externalOnlyAssessment.code).toBe(ExitCode.ok);
  const runResultsScore = objectWithString(
    jsonObjects(getArray(JSON.parse(externalOnlyAssessment.stdout), 'scorecard')),
    'id',
    'run-results',
  );
  expect(getString(runResultsScore ?? {}, 'status')).toBe('partial');
  expect(getString(runResultsScore ?? {}, 'summary')).toContain(
    'not counted as agent-run evidence',
  );

  await writeFile(
    join(root, 'examples/model-profiles/live-ready.yaml'),
    await readFile('examples/model-profiles/live-ready.yaml', 'utf8'),
  );
  await writeFile(
    join(root, 'examples/policies/live-sandbox-policy.yaml'),
    await readFile('examples/policies/live-sandbox-policy.yaml', 'utf8'),
  );
  await writeFile(
    join(root, 'examples/agent-runners/live-ready.yaml'),
    await readFile('examples/agent-runners/live-ready.yaml', 'utf8'),
  );
  const liveRunnerImport = await run(
    [
      'run',
      '--runner',
      'examples/agent-runners/live-ready.yaml',
      '--external-candidate',
      'candidate.txt',
      '--external-model-id',
      'copilot-cli',
      '--run-id',
      'stage18-5-live-runner-import',
      '--format',
      'json',
    ],
    root,
  );
  expect(liveRunnerImport.code).toBe(ExitCode.ok);
  const liveRunnerRunResults = await readJsonLines(join(root, '.harness/run-results.jsonl'));
  const liveRunnerRunResult = liveRunnerRunResults.find((entry) =>
    requiredStringForTest(entry, 'run_id').startsWith('stage18-5-live-runner-import'),
  );
  expect(liveRunnerRunResult).toBeDefined();
  expect(getString(liveRunnerRunResult ?? {}, 'kind')).toBe('external-import');
  expect(getString(getObject(liveRunnerRunResult ?? {}, 'usage') ?? {}, 'source')).toBe('external');
});

test('run refuses to replace agent-run evidence with external-import evidence', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await writeFile(join(root, 'candidate.txt'), 'schema-smoke passes\nexternal replacement\n');
  const baseRunId = 'stage18-5-ledger-kind';

  const agentRun = await run(['run', '--run-id', baseRunId, '--format', 'json'], root);
  expect(agentRun.code).toBe(ExitCode.ok);
  const agentOutputPath = requiredStringForTest(JSON.parse(agentRun.stdout), 'agent_output');
  const originalAgentOutput = await readFile(join(root, agentOutputPath), 'utf8');
  expect(originalAgentOutput).not.toContain('external replacement');

  const externalImport = await run(
    ['run', '--external-candidate', 'candidate.txt', '--run-id', baseRunId, '--format', 'json'],
    root,
  );
  expect(externalImport.code).toBe(ExitCode.validationError);
  expect(externalImport.stderr).toContain('Refusing to replace run-result');
  expect(externalImport.stderr).toContain('eval/agent-run -> external-import/external-import');

  const runResults = await readJsonLines(join(root, '.harness/run-results.jsonl'));
  expect(runResults.length).toBe(1);
  expect(getString(runResults[0] ?? {}, 'kind')).toBe('eval');
  expect(await readFile(join(root, agentOutputPath), 'utf8')).toBe(originalAgentOutput);
});

test('eval run refuses to replace external-import evidence before writing artifacts', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  await writeFile(join(root, 'candidate.txt'), 'schema-smoke passes\nexternal import remains\n');
  const baseRunId = 'stage18-5-eval-ledger-kind';

  const externalImport = await run(
    ['run', '--external-candidate', 'candidate.txt', '--run-id', baseRunId, '--format', 'json'],
    root,
  );
  expect(externalImport.code).toBe(ExitCode.ok);
  const externalSummary = JSON.parse(externalImport.stdout);
  const agentOutputPath = requiredStringForTest(externalSummary, 'agent_output');
  const originalAgentOutput = await readFile(join(root, agentOutputPath), 'utf8');
  expect(originalAgentOutput).toContain('external import remains');

  const evalRun = await run(['eval', 'run', '--run-id', baseRunId, '--format', 'json'], root);
  expect(evalRun.code).toBe(ExitCode.validationError);
  expect(evalRun.stderr).toContain('Refusing to replace run-result');
  expect(evalRun.stderr).toContain('external-import/external-import -> eval/agent-run');

  const runResults = await readJsonLines(join(root, '.harness/run-results.jsonl'));
  expect(runResults.length).toBe(1);
  expect(getString(runResults[0] ?? {}, 'kind')).toBe('external-import');
  expect(await readFile(join(root, agentOutputPath), 'utf8')).toBe(originalAgentOutput);
});

test('run refuses unsafe external candidates and records verifier failures honestly', async () => {
  const parent = await tempRoot();
  const root = join(parent, 'repo');
  await mkdir(root);
  await run(['init'], root);
  await writeFile(join(parent, 'outside.txt'), 'schema-smoke passes outside root.\n');

  const escaped = await run(
    ['run', '--external-candidate', '../outside.txt', '--run-id', 'stage18-5-escape'],
    root,
  );
  expect(escaped.code).toBe(ExitCode.usageError);
  expect(escaped.stderr).toContain('External candidate escapes root');

  await writeFile(join(root, 'bad-candidate.txt'), 'schema-smoke fails\n');
  const failed = await run(
    [
      'run',
      '--external-candidate',
      'bad-candidate.txt',
      '--run-id',
      'stage18-5-failed',
      '--format',
      'json',
    ],
    root,
  );
  expect(failed.code).toBe(ExitCode.validationError);
  const runResults = await readJsonLines(join(root, '.harness/run-results.jsonl'));
  const runResult = runResults[0] ?? {};
  expect(getString(runResult, 'kind')).toBe('external-import');
  expect(getString(runResult, 'status')).toBe('failed');
  expect(getString(runResult, 'failure_code')).toBe('verification-failure');
  expect(getObject(runResult, 'execution')).toEqual({
    mode: 'external-import',
    harness_status: 'passed',
    verifier_status: 'failed',
  });
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
  const externalModelWithoutCandidate = await run(
    ['run', '--external-model-id', 'copilot-cli'],
    await tempRoot(),
  );
  expect(externalModelWithoutCandidate.code).toBe(ExitCode.usageError);
  expect(externalModelWithoutCandidate.stderr).toContain(
    'run --external-model-id requires --external-candidate',
  );

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

test('run rejects non-stub credential sources', async () => {
  const root = await tempRoot();
  await run(['init'], root);
  const runnerPath = join(root, 'examples/agent-runners/stub.yaml');
  const runner = await readFile(runnerPath, 'utf8');
  await writeFile(runnerPath, runner.replace('source: stub', 'source: env'));

  const result = await run(['run', '--run-id', 'stage6-env-credential', '--format', 'json'], root);
  expect(result.code).toBe(ExitCode.validationError);
  expect(result.stderr).toContain(
    'deterministic runner requires credential_reference.source: stub',
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
  expect(help.stdout).toContain(
    'assess     Read existing artifacts and emit agent-facing maturity/routing guidance.',
  );
  expect(help.stdout).toContain('doctor     Run deterministic structural harness checks.');
  expect(help.stdout).toContain('health     Run declared local project health checks.');
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

function invalidExternalSourceMaterialAssessment(
  assessment: JsonObject,
  routing: JsonObject,
): JsonObject {
  return {
    ...assessment,
    implementation_routing: {
      ...routing,
      selected_route: 'execution-loop',
      routes: [
        ...jsonObjects(getArray(routing, 'routes')).filter(
          (route) => getString(route, 'kind') !== 'external-source-material',
        ),
        {
          id: 'external-workflow-skill',
          kind: 'external-source-material',
          status: 'available',
          summary: 'Future source-material route.',
          evidence: [],
        },
      ],
    },
  };
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
