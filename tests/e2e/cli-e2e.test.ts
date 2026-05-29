import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ICliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly signal?: string;
  readonly timedOut: boolean;
  readonly command: string;
}

type JsonObject = Record<string, unknown>;
type Timer = ReturnType<typeof setTimeout>;

const exitCode = {
  ok: 0,
  validationError: 1,
} as const;

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, '..', '..');
const cliPath = join(repoRoot, 'dist/index.js');
const fixtureRoot = join(testDirectory, 'projects/minimal-consumer');
const commandTimeoutMs = 10_000;
const e2eTestTimeoutMs = 120_000;
const fallbackExitCode = 70;
const runtimePath = process.execPath;

test(
  'package dry run includes CLI delivery artifacts',
  async () => {
    await assertCliBuilt();
    const packageJson = await readJsonObject(join(repoRoot, 'package.json'));
    expect(getString(getObject(packageJson, 'bin') ?? {}, 'harness')).toBe('./dist/index.js');
    expect(getArray(packageJson, 'files')).toEqual([
      'dist',
      'schemas',
      'examples',
      'docs',
      'README.md',
      'LICENSE',
    ]);

    const pack = await runProcess(repoRoot, runtimePath, [
      'pm',
      'pack',
      '--dry-run',
      '--ignore-scripts',
    ]);
    expectSuccess(pack, ['bun', 'pm', 'pack', '--dry-run']);
    const packedPaths = packedFilePaths(pack.stdout);
    for (const expected of [
      'package.json',
      'LICENSE',
      'dist/index.js',
      'schemas/harness.schema.json',
      'schemas/profile-run.schema.json',
      'examples/harness.yaml',
      'examples/profiles/gc-stability.yaml',
      'docs/guides/cli.md',
      'README.md',
    ]) {
      expect(packedPaths.has(expected)).toBe(true);
    }
    for (const packedPath of packedPaths) {
      expect(packedPath.startsWith('src/')).toBe(false);
      expect(packedPath.startsWith('tests/')).toBe(false);
      expect(packedPath.startsWith('plans/')).toBe(false);
      expect(packedPath.startsWith('.harness/')).toBe(false);
    }
  },
  e2eTestTimeoutMs,
);

test(
  'packed CLI contents initialize a downstream project',
  async () => {
    await assertCliBuilt();
    const parent = await mkdtemp(join(await realpath(tmpdir()), 'harness-pack-e2e-'));
    try {
      const pack = await runProcess(repoRoot, runtimePath, [
        'pm',
        'pack',
        '--filename',
        join(parent, 'harness-engineering.tgz'),
        '--ignore-scripts',
        '--quiet',
      ]);
      expectSuccess(pack, ['bun', 'pm', 'pack']);
      const extractDir = join(parent, 'extract');
      await mkdir(extractDir);
      expectSuccess(
        await runProcess(extractDir, 'tar', ['-xzf', join(parent, 'harness-engineering.tgz')]),
        ['tar', '-xzf'],
      );
      const packageRoot = join(extractDir, 'package');
      const downstreamRoot = join(parent, 'downstream');
      await mkdir(downstreamRoot);
      const packedCli = join(packageRoot, 'dist/index.js');
      const packageJson = await readJsonObject(join(packageRoot, 'package.json'));
      expect(getString(getObject(packageJson, 'bin') ?? {}, 'harness')).toBe('./dist/index.js');
      await expectFile(packageRoot, 'schemas/harness.schema.json');
      await expectFile(packageRoot, 'examples/harness.yaml');
      expectSuccess(await runProcess(downstreamRoot, runtimePath, [packedCli, 'version']), [
        'packed harness version',
      ]);
      expectSuccess(await runProcess(downstreamRoot, runtimePath, [packedCli, 'init']), [
        'packed harness init',
      ]);
      expectSuccess(await runProcess(downstreamRoot, runtimePath, [packedCli, 'validate']), [
        'packed harness validate',
      ]);
      const healthPath = '.harness/outputs/health/packed-health.json';
      expectSuccess(
        await runProcess(downstreamRoot, runtimePath, [
          packedCli,
          'health',
          '--accept-unsandboxed-execution',
          '--format',
          'json',
          '--output',
          healthPath,
        ]),
        ['packed harness health'],
      );
      expect(getString(await readJsonObject(join(downstreamRoot, healthPath)), 'status')).toBe(
        'passed',
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  },
  e2eTestTimeoutMs,
);

test(
  'built CLI initializes and exercises a downstream project end to end',
  async () => {
    await withFixtureProject(async (root) => {
      expect(await pathExists(join(root, 'harness.yaml'))).toBe(false);
      expectSuccess(await runProjectTest(root), ['bun', 'run', 'test']);
      expect(await readFile(join(root, 'README.md'), 'utf8')).toContain('Minimal Consumer');
      expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('Agent Instructions');
      await expectFile(root, 'src/greet.js');

      const binVersion = await runHarnessBin(root, ['version']);
      expectSuccess(binVersion, ['harness', 'version']);
      expect(binVersion.stdout.trim()).toBe(await packageVersion());

      expectSuccess(await runHarness(root, ['init']), ['init']);
      expect(await pathExists(join(root, 'harness.yaml'))).toBe(true);
      expect(await readFile(join(root, 'README.md'), 'utf8')).toContain('Minimal Consumer');
      expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('Agent Instructions');
      await expectFile(root, '.harness/evals/harness-self-test/v1.0.0/task.yaml');
      await expectFile(root, 'src/greet.js');
      expectSuccess(await runProjectTest(root), ['bun', 'run', 'test']);

      expectSuccess(await runHarness(root, ['validate']), ['validate']);

      const doctorPath = '.harness/outputs/doctor/e2e-doctor.json';
      expectSuccess(
        await runHarness(root, [
          'doctor',
          '--run-id',
          'e2e-doctor',
          '--format',
          'json',
          '--output',
          doctorPath,
        ]),
        ['doctor'],
      );
      expect(getString(await readJsonObject(join(root, doctorPath)), 'status')).toBe('passed');

      const healthPath = '.harness/outputs/health/e2e-health.json';
      expectSuccess(
        await runHarness(root, [
          'health',
          '--accept-unsandboxed-execution',
          '--format',
          'json',
          '--output',
          healthPath,
        ]),
        ['health'],
      );
      expect(getString(await readJsonObject(join(root, healthPath)), 'status')).toBe('passed');

      const gcPath = '.harness/outputs/gc/e2e-gc.json';
      expectSuccess(
        await runHarness(root, [
          'gc',
          'audit',
          '--format',
          'json',
          '--output',
          gcPath,
          '--audit-id',
          'e2e-gc-clean',
          '--generated-at',
          '2026-05-26T00:00:00Z',
        ]),
        ['gc', 'audit'],
      );
      const profilePath = '.harness/outputs/profile-runs/e2e-profile.json';
      expectSuccess(
        await runHarness(root, [
          'profile',
          'run',
          '.harness/profiles/gc-stability.yaml',
          '--gc-evidence',
          gcPath,
          '--health-result',
          healthPath,
          '--output',
          profilePath,
          '--run-id',
          'e2e-profile',
          '--format',
          'json',
        ]),
        ['profile', 'run'],
      );
      const profileRun = await readJsonObject(join(root, profilePath));
      expect(getString(getObject(profileRun, 'handoff') ?? {}, 'status')).toBe('met');

      expectSuccess(
        await runHarness(root, [
          'eval',
          'validate',
          '--run-id',
          'e2e-eval-validate',
          '--output',
          '.harness/outputs/run-results.jsonl',
        ]),
        ['eval', 'validate'],
      );
      const verifierResults = await readJsonLines(join(root, '.harness/outputs/run-results.jsonl'));
      expect(verifierResults.map((result) => getString(result, 'status')).sort()).toEqual([
        'failed',
        'passed',
      ]);

      const scoreboardPath = '.harness/judges/calibration/scoreboard-self-test.json';
      await expectFile(root, scoreboardPath);

      const traceValidation = await runAndParseJson(root, [
        'trace',
        'validate',
        '--format',
        'json',
      ]);
      expect(getString(traceValidation, 'status')).toBe('passed');

      const report = await runHarness(root, [
        'report',
        '--trace',
        '.harness/traces/samples/recorded-external-trace.json',
        '--scoreboard',
        scoreboardPath,
        '--doctor-result',
        doctorPath,
      ]);
      expectSuccess(report, ['report']);
      expect(report.stdout).toContain(
        '- scoreboard: .harness/judges/calibration/scoreboard-self-test.json',
      );
      expect(report.stdout).toContain('- doctor result: .harness/outputs/doctor/e2e-doctor.json');
      await mkdir(join(root, '.harness/outputs/reports'), { recursive: true });
      await writeFile(join(root, '.harness/outputs/reports/e2e-report.md'), report.stdout);
      await mkdir(join(root, '.harness/repair-actions'), { recursive: true });
      await writeFile(
        join(root, '.harness/repair-actions/approved-schema-fix.yaml'),
        `schema_version: "0.1.0"
x-stability: provisional
action_id: approved-schema-fix
target_files:
  - harness.yaml
risk_class: low
repair_mode: preview-backed
preview_diff: |
  diff --git a/harness.yaml b/harness.yaml
  --- a/harness.yaml
  +++ b/harness.yaml
equivalent_cli_command:
  command: harness validate
  timeout_seconds: 300
approval_state: approved
sandbox_requirement: worktree
trust_requirements:
  trust_level: sandboxed
  sandbox_required: worktree
  network_access: false
  secret_access: false
  host_file_access: false
  allowed_inputs:
    - harness.yaml
  allowed_outputs:
    - .harness/outputs/repairs/approved-schema-fix.patch
rollback_notes: Delete generated repair preview artifacts if the proposal is rejected.
evidence_links:
  - path: harness.yaml
    media_type: application/yaml
    description: Initialized downstream harness file.
`,
      );

      const mixedLedgerAssessment = await runAndParseJson(root, [
        'assess',
        '--format',
        'json',
        '--doctor-result',
        doctorPath,
        '--health-result',
        healthPath,
        '--run-results',
        '.harness/outputs/run-results.jsonl',
        '--trace',
        '.harness/traces/samples/recorded-external-trace.json',
        '--scoreboard',
        scoreboardPath,
        '--report',
        '.harness/outputs/reports/e2e-report.md',
      ]);
      expect(getString(mixedLedgerAssessment, 'status')).toBe('needs-work');
      expect(
        getString(
          objectWithString(
            jsonObjects(getArray(mixedLedgerAssessment, 'scorecard')),
            'id',
            'run-results',
          ) ?? {},
          'status',
        ),
      ).toBe('partial');
      const mixedProjectHealth = objectWithString(
        jsonObjects(getArray(mixedLedgerAssessment, 'scorecard')),
        'id',
        'project-health',
      );
      expect(getString(mixedProjectHealth ?? {}, 'status')).toBe('present');

      const assessmentRunResultPath = '.harness/judges/calibration/run-result.json';
      const assessment = await runAndParseJson(root, [
        'assess',
        '--format',
        'json',
        '--doctor-result',
        doctorPath,
        '--health-result',
        healthPath,
        '--run-results',
        assessmentRunResultPath,
        '--trace',
        '.harness/traces/samples/recorded-external-trace.json',
        '--scoreboard',
        scoreboardPath,
        '--report',
        '.harness/outputs/reports/e2e-report.md',
        '--repair-actions-dir',
        '.harness/repair-actions',
      ]);
      expect(getString(assessment, 'status')).toBe('ready');
      const maturity = getObject(assessment, 'maturity') ?? {};
      expect(getNumber(maturity, 'score')).toBeGreaterThanOrEqual(8);
      expect(getNumber(maturity, 'max_score')).toBe(10);
      const projectHealth = objectWithString(
        jsonObjects(getArray(assessment, 'scorecard')),
        'id',
        'project-health',
      );
      expect(getString(projectHealth ?? {}, 'status')).toBe('present');
      expect(
        getString(getObject(assessment, 'implementation_routing') ?? {}, 'selected_route'),
      ).toBe('execution-loop');
      const assessmentRoutes = jsonObjects(
        getArray(getObject(assessment, 'implementation_routing') ?? {}, 'routes'),
      );
      const unrelatedRepairRoute = objectWithString(
        assessmentRoutes,
        'id',
        'repair-action:approved-schema-fix',
      );
      expect(getString(unrelatedRepairRoute ?? {}, 'status')).toBe('unavailable');
      expect(getString(unrelatedRepairRoute ?? {}, 'applicability')).toBe('not-applicable');
      expect(getString(unrelatedRepairRoute ?? {}, 'approval_trust')).toBe('untrusted');
      expect(getString(getObject(assessment, 'adapter_path') ?? {}, 'command')).toBe(
        'harness assess --format json',
      );

      await installLoopEvidence(root);
      const loopStart = await runHarness(root, [
        'loop',
        'validate',
        '--phase',
        'start',
        '--continuity',
        '.harness/outputs/continuity/e2e-loop-state.yaml',
      ]);
      expectSuccess(loopStart, ['loop', 'validate', '--phase', 'start']);
      expect(loopStart.stdout).toContain('phase: start');

      const absoluteCompletionVerificationPath = join(
        root,
        '.harness/outputs/verification/e2e-completion.yaml',
      );
      const loopComplete = await runHarness(root, [
        'loop',
        'validate',
        '--phase',
        'complete',
        '--continuity',
        '.harness/outputs/continuity/e2e-loop-state.yaml',
        '--verification',
        absoluteCompletionVerificationPath,
      ]);
      expectSuccess(loopComplete, ['loop', 'validate', '--phase', 'complete']);
      expect(loopComplete.stdout).toContain('phase: complete');
      expect(loopComplete.stdout).toContain('gates: startup=passed, completion=passed');
    });
  },
  e2eTestTimeoutMs,
);

test(
  'built CLI rejects invalid trace and report inputs',
  async () => {
    await withFixtureProject(async (root) => {
      expectSuccess(await runHarness(root, ['init']), ['init']);

      const tracePath = join(root, '.harness/traces/samples/recorded-external-trace.json');
      const originalTrace = await readFile(tracePath, 'utf8');
      await writeFile(tracePath, '{ "schema_version": "0.1.0" }\n');
      const traceResult = await runHarness(root, ['trace', 'validate', '--format', 'json']);
      expectValidationFailure(traceResult, ['trace', 'validate']);
      expect(traceResult.stderr).toContain('Trace discovery failed');
      expect(traceResult.stderr).toContain('.harness/traces/samples/recorded-external-trace.json');
      await writeFile(tracePath, originalTrace);

      const runResultsPath = join(root, '.harness/outputs/run-results.jsonl');
      await writeFile(runResultsPath, '{ "schema_version": "0.1.0" }\n');
      const reportResult = await runHarness(root, [
        'report',
        '--run-result',
        '.harness/outputs/run-results.jsonl',
      ]);
      expectValidationFailure(reportResult, ['report', '--run-result']);
      expect(reportResult.stderr).toContain('run result artifact failed schema validation');
      await writeFile(runResultsPath, '');
    });
  },
  e2eTestTimeoutMs,
);

test(
  'built CLI rejects a downstream harness with a broken starter reference',
  async () => {
    await withFixtureProject(async (root) => {
      expectSuccess(await runHarness(root, ['init']), ['init']);

      const harnessPath = join(root, 'harness.yaml');
      const harness = await readFile(harnessPath, 'utf8');
      await writeFile(
        harnessPath,
        harness.replace(
          'environment: .harness/environments/local.yaml',
          'environment: .harness/environments/missing.yaml',
        ),
      );

      const result = await runHarness(root, ['validate']);
      expectValidationFailure(result, ['validate']);
      expect(result.stdout).toContain('harness validate failed');
      expect(result.stdout).toContain('.harness/environments/missing.yaml');
    });
  },
  e2eTestTimeoutMs,
);

test(
  'built CLI refuses loop completion when required evidence is missing',
  async () => {
    await withFixtureProject(async (root) => {
      expectSuccess(await runHarness(root, ['init']), ['init']);
      await installLoopEvidence(root);

      const completionPath = join(root, '.harness/outputs/verification/e2e-completion.yaml');
      const completion = await readFile(completionPath, 'utf8');
      await writeFile(
        completionPath,
        completion.replace('- id: handoff-artifact-ready', '- id: handoff-artifact-not-ready'),
      );

      const result = await runHarness(root, [
        'loop',
        'validate',
        '--phase',
        'complete',
        '--continuity',
        '.harness/outputs/continuity/e2e-loop-state.yaml',
        '--verification',
        '.harness/outputs/verification/e2e-completion.yaml',
      ]);
      expectValidationFailure(result, ['loop', 'validate', '--phase', 'complete']);
      expect(result.stdout).toContain('LOOP_COMPLETION_ACCEPTANCE_MISSING');
    });
  },
  e2eTestTimeoutMs,
);

async function withFixtureProject(runTest: (root: string) => Promise<void>): Promise<void> {
  await assertCliBuilt();
  const parent = await mkdtemp(join(await realpath(tmpdir()), 'harness-e2e-'));
  const root = join(parent, 'minimal-consumer');
  await cp(fixtureRoot, root, { recursive: true });
  try {
    await runTest(root);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

async function installLoopEvidence(root: string): Promise<void> {
  await mkdir(join(root, '.harness/outputs/continuity'), { recursive: true });
  await mkdir(join(root, '.harness/outputs/verification'), { recursive: true });
  await mkdir(join(root, 'plans/minimal-consumer-loop'), { recursive: true });
  await writeFile(
    join(root, '.harness/outputs/continuity/e2e-loop-state.yaml'),
    `schema_version: "0.1.0"
session_id: minimal-consumer-e2e-loop
feature_list:
  - id: fixture-loop-validation
    title: Validate fixture-local loop evidence.
    status: done
    refs:
      - path: plans/minimal-consumer-loop/todo.md
        media_type: text/markdown
        description: Fixture-local handoff note.
progress_log:
  - timestamp: "2026-05-22T00:00:00Z"
    event: E2E startup verification passed before fixture work began.
    refs:
      - path: .harness/outputs/verification/e2e-startup.yaml
        media_type: application/yaml
        description: Fixture-local startup self-verification evidence.
  - timestamp: "2026-05-22T00:10:00Z"
    event: E2E completion verification recorded before completion claim.
    refs:
      - path: .harness/outputs/verification/e2e-completion.yaml
        media_type: application/yaml
        description: Fixture-local completion self-verification evidence.
startup_verification:
  status: passed
  command:
    command: harness validate
    timeout_seconds: 300
  evidence:
    - path: .harness/outputs/verification/e2e-startup.yaml
      media_type: application/yaml
      description: Startup self-verification evidence.
  self_verification_ref: .harness/outputs/verification/e2e-startup.yaml
git_checkpoint_sha: abc1234
handoff_artifacts:
  - path: plans/minimal-consumer-loop/todo.md
    media_type: text/markdown
    description: Fixture-local loop validation handoff.
unresolved_risks: []
`,
  );
  await writeFile(
    join(root, '.harness/outputs/verification/e2e-startup.yaml'),
    `schema_version: "0.1.0"
verification_id: e2e-startup
spec_ref: harness.yaml
spec_reread:
  ref: harness.yaml
  timestamp: "2026-05-22T00:00:00Z"
  digest: sha256:1111111111111111111111111111111111111111111111111111111111111111
  status: matched
acceptance_checks:
  - id: startup-smoke-test-passed
    expected: The harness startup smoke test passes before fixture work begins.
    actual: harness validate passed and continuity state links this startup evidence.
    status: passed
checks_run:
  - command:
      command: harness validate
      timeout_seconds: 300
    status: passed
    evidence:
      - path: harness.yaml
        media_type: application/yaml
        description: Harness file consumed by the startup smoke test.
artifacts:
  - path: harness.yaml
    media_type: application/yaml
    description: Harness file validated by the startup smoke test.
unresolved_risks: []
evidence_links:
  - path: harness.yaml
    media_type: application/yaml
    description: Startup verification input.
`,
  );
  await writeFile(
    join(root, '.harness/outputs/verification/e2e-completion.yaml'),
    `schema_version: "0.1.0"
verification_id: e2e-completion
spec_ref: plans/minimal-consumer-loop/todo.md
spec_reread:
  ref: plans/minimal-consumer-loop/todo.md
  timestamp: "2026-05-22T00:10:00Z"
  digest: sha256:2222222222222222222222222222222222222222222222222222222222222222
  status: matched
acceptance_checks:
  - id: original-spec-reread
    expected: Completion evidence records that the fixture-local loop spec was reread.
    actual: spec_reread.status is matched for the fixture-local handoff note.
    status: passed
  - id: acceptance-criteria-compared
    expected: Completion evidence compares the required loop acceptance criteria.
    actual: This evidence includes passed checks for startup, policy, sandbox, verification, and handoff gates.
    status: passed
  - id: approval-policy-followed-or-escalated
    expected: Approval policy decisions are read and either followed or explicitly escalated.
    actual: .harness/policies/approval-policy.yaml was read and no escalation was required for fixture validation.
    status: passed
  - id: sandbox-policy-followed-or-escalated
    expected: Sandbox policy decisions are read and either followed or explicitly escalated.
    actual: .harness/policies/sandbox-policy.yaml was read and the declared worktree tier was accepted.
    status: passed
  - id: startup-verification-recorded
    expected: Startup verification runs before work begins and is recorded in continuity state.
    actual: .harness/outputs/continuity/e2e-loop-state.yaml records the startup self-verification as the first progress event.
    status: passed
  - id: handoff-artifact-ready
    expected: Long-running work has a handoff artifact before completion is claimed.
    actual: Continuity state links plans/minimal-consumer-loop/todo.md as the handoff artifact.
    status: passed
checks_run:
  - command:
      command: harness validate
      timeout_seconds: 300
    status: passed
    evidence:
      - path: harness.yaml
        media_type: application/yaml
        description: Harness file validated for completion.
  - command:
      command: harness doctor --file harness.yaml
      timeout_seconds: 300
    status: passed
    evidence:
      - path: .harness/outputs/doctor/e2e-doctor.json
        media_type: application/json
        description: Passing doctor-result evidence.
artifacts:
  - path: harness.yaml
    media_type: application/yaml
    description: Initialized downstream harness file.
  - path: .harness/outputs/continuity/e2e-loop-state.yaml
    media_type: application/yaml
    description: Fixture-local continuity state consumed by the loop validator.
unresolved_risks: []
evidence_links:
  - path: .harness/policies/approval-policy.yaml
    media_type: application/yaml
    description: Approval policy read before completion.
  - path: .harness/policies/sandbox-policy.yaml
    media_type: application/yaml
    description: Sandbox policy read before completion.
  - path: .harness/outputs/verification/e2e-startup.yaml
    media_type: application/yaml
    description: Startup self-verification evidence consumed by continuity state.
  - path: .harness/outputs/continuity/e2e-loop-state.yaml
    media_type: application/yaml
    description: Continuity state with startup and completion progress evidence.
  - path: plans/minimal-consumer-loop/todo.md
    media_type: text/markdown
    description: Fixture-local loop validation handoff.
`,
  );
  await writeFile(
    join(root, 'plans/minimal-consumer-loop/todo.md'),
    '# Minimal consumer loop validation\n\nE2E handoff artifact for fixture-local loop validation.\n',
  );
}

async function runAndParseJson(root: string, args: readonly string[]): Promise<JsonObject> {
  const result = await runHarness(root, args);
  expectSuccess(result, args);
  return parseJsonObject(result.stdout, args.join(' '));
}

async function runHarness(cwd: string, args: readonly string[]): Promise<ICliResult> {
  return await runProcess(cwd, runtimePath, [cliPath, ...args], {
    commandLabel: [runtimePath, cliPath, ...args].join(' '),
  });
}

async function runHarnessBin(cwd: string, args: readonly string[]): Promise<ICliResult> {
  const binPath = await packageHarnessBinPath();
  if (process.platform !== 'win32' && (await commandExists('node'))) {
    return await runProcess(cwd, binPath, args, { commandLabel: ['harness', ...args].join(' ') });
  }
  return await runProcess(cwd, runtimePath, [binPath, ...args], {
    commandLabel: [runtimePath, binPath, ...args].join(' '),
  });
}

async function runProjectTest(cwd: string): Promise<ICliResult> {
  return await runProcess(cwd, runtimePath, ['run', 'test'], { commandLabel: 'bun run test' });
}

async function runProcess(
  cwd: string,
  executable: string,
  args: readonly string[],
  options: { readonly commandLabel?: string } = {},
): Promise<ICliResult> {
  return await new Promise((resolve, reject) => {
    const command = options.commandLabel ?? [executable, ...args].join(' ');
    const detached = process.platform !== 'win32';
    const child = spawn(executable, [...args], {
      cwd,
      detached,
      env: e2eEnvironment(),
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timeout: Timer | undefined;
    let forceKill: Timer | undefined;
    function finish(result: ICliResult): void {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (forceKill !== undefined) {
        clearTimeout(forceKill);
      }
      resolve(result);
    }
    function recordKillError(error: unknown, signal: NodeJS.Signals): void {
      if (isErrorWithCode(error, 'ESRCH')) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      stderr += `\nFailed to send ${signal} to ${command}: ${message}\n`;
    }
    function killProcess(signal: NodeJS.Signals): void {
      try {
        if (process.platform === 'win32' && child.pid !== undefined) {
          killWindowsProcessTree(child.pid, signal, (error) => recordKillError(error, signal));
        } else if (detached && child.pid !== undefined) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch (error) {
        recordKillError(error, signal);
      }
    }
    timeout = setTimeout(() => {
      timedOut = true;
      killProcess('SIGTERM');
    }, commandTimeoutMs);
    timeout.unref();
    forceKill = setTimeout(() => {
      if (settled || !timedOut || child.exitCode !== null) {
        return;
      }
      killProcess('SIGKILL');
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish({
        code: fallbackExitCode,
        stdout,
        stderr,
        signal: 'SIGKILL',
        timedOut,
        command,
      });
    }, commandTimeoutMs + 1_000);
    forceKill.unref();
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (forceKill !== undefined) {
        clearTimeout(forceKill);
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      reject(error);
    });
    child.on('close', (code, signal) => {
      finish({
        code: code ?? fallbackExitCode,
        stdout,
        stderr,
        ...(signal === null ? {} : { signal }),
        timedOut,
        command,
      });
    });
  });
}

function killWindowsProcessTree(
  pid: number,
  signal: NodeJS.Signals,
  onError: (error: unknown) => void,
): void {
  const args = ['/pid', String(pid), '/t'];
  if (signal === 'SIGKILL') {
    args.push('/f');
  }
  const killer = spawn('taskkill', args, {
    env: e2eEnvironment(),
    stdio: 'ignore',
    windowsHide: true,
  });
  killer.on('error', onError);
}

async function commandExists(command: string): Promise<boolean> {
  const checker =
    process.platform === 'win32'
      ? await runProcess(repoRoot, 'where', [command])
      : await runProcess(repoRoot, '/bin/sh', ['-c', `command -v ${command}`]);
  return checker.code === exitCode.ok;
}

function e2eEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ['NO_COLOR']: '1' };
  for (const key of [
    'PATH',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'TMP',
    'TEMP',
    'TMPDIR',
  ]) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

async function assertCliBuilt(): Promise<void> {
  const entry = await stat(cliPath).catch((error: unknown) => {
    if (isErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  });
  if (entry === undefined) {
    throw new Error('Built CLI not found at dist/index.js. Run `bun run build` before e2e tests.');
  }
  if (process.platform !== 'win32' && (entry.mode & 0o111) === 0) {
    throw new Error('Built CLI at dist/index.js is not executable.');
  }
}

async function packageVersion(): Promise<string> {
  return requiredString(await readJsonObject(join(repoRoot, 'package.json')), 'version');
}

async function packageHarnessBinPath(): Promise<string> {
  const packageJson = await readJsonObject(join(repoRoot, 'package.json'));
  const bin = getObject(packageJson, 'bin');
  if (bin === undefined) {
    throw new Error('package.json must declare a bin object.');
  }
  return join(repoRoot, requiredString(bin, 'harness'));
}

function packedFilePaths(stdout: string): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^packed\s+\S+\s+(.+)$/.exec(line.trim());
    if (match?.[1] !== undefined) {
      paths.add(match[1]);
    }
  }
  return paths;
}

function expectSuccess(result: ICliResult, args: readonly string[]): void {
  if (result.code !== exitCode.ok) {
    throw new Error(formatUnexpectedResult('success', args, result));
  }
  expect(result.timedOut).toBe(false);
}

function expectValidationFailure(result: ICliResult, args: readonly string[]): void {
  if (result.code !== exitCode.validationError) {
    throw new Error(formatUnexpectedResult('validation failure', args, result));
  }
  expect(result.timedOut).toBe(false);
}

function formatUnexpectedResult(
  expected: string,
  args: readonly string[],
  result: ICliResult,
): string {
  const signal = result.signal === undefined ? 'none' : result.signal;
  return [
    `Expected ${args.join(' ')} to return ${expected}, got exit ${result.code}.`,
    `command: ${result.command}`,
    `timed out: ${result.timedOut}`,
    `signal: ${signal}`,
    'stdout:',
    result.stdout,
    'stderr:',
    result.stderr,
  ].join('\n');
}

async function expectFile(root: string, path: string): Promise<void> {
  const entry = await stat(join(root, path));
  expect(entry.isFile()).toBe(true);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isErrorWithCode(error, 'ENOENT')) {
      return false;
    }
    throw error;
  }
}

async function readJsonObject(path: string): Promise<JsonObject> {
  return parseJsonObject(await readFile(path, 'utf8'), path);
}

async function readJsonLines(path: string): Promise<readonly JsonObject[]> {
  const lines = (await readFile(path, 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.map((line, index) => parseJsonObject(line, `${path}:${index + 1}`));
}

function parseJsonObject(text: string, source: string): JsonObject {
  const parsed: unknown = JSON.parse(text);
  if (!isJsonObject(parsed)) {
    throw new Error(`${source} did not produce a JSON object.`);
  }
  return parsed;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(object: JsonObject, key: string): string {
  const value = getString(object, key);
  if (value === undefined) {
    throw new Error(`Expected JSON string field ${key}.`);
  }
  return value;
}

function getString(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumber(object: JsonObject, key: string): number {
  const value = object[key];
  return typeof value === 'number' ? value : 0;
}

function getObject(object: JsonObject, key: string): JsonObject | undefined {
  const value = object[key];
  return isJsonObject(value) ? value : undefined;
}

function getArray(object: JsonObject, key: string): readonly unknown[] {
  const value = object[key];
  return Array.isArray(value) ? value : [];
}

function jsonObjects(values: readonly unknown[]): readonly JsonObject[] {
  return values.filter(isJsonObject);
}

function objectWithString(
  objects: readonly JsonObject[],
  key: string,
  value: string,
): JsonObject | undefined {
  return objects.find((object) => getString(object, key) === value);
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  );
}
