import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { CliError } from './errors.ts';
import { computeEvalTaskDatasetHash, discoverEvalTaskPathsFromHarness } from './eval.ts';
import { ExitCode } from './exit-codes.ts';
import {
  assertNoSymlinkWithinRoot,
  loadDocument,
  pathKind,
  writeTextNoFollowCreatingDirectories,
} from './files.ts';
import { validateHarnessConfiguration } from './harness.ts';
import type { JsonObject, JsonValue } from './json.ts';
import { getArray, getObject, getString, isObject } from './json.ts';
import { relativePathFromRoot, resolveInsideRoot } from './paths.ts';
import { runShellCommand } from './process.ts';
import { formatValidationIssue, type SchemaRegistry } from './schema-registry.ts';

type AgentRunStatus = 'passed' | 'failed' | 'error';
type AgentCaseKind = 'oracle' | 'broken-twin';
type AgentExecutionMode = 'agent-run' | 'external-import';
type ScoreboardFailureBucket = (typeof supportedFailureBuckets)[number];
type FailureCode =
  | 'agent-failure'
  | 'budget-exceeded'
  | 'credential-missing'
  | 'harness-error'
  | 'model-failure'
  | 'sandbox-violation'
  | 'timeout'
  | 'verifier-error'
  | 'verification-failure';

export interface AgentRunRequest {
  readonly root: string;
  readonly harnessPath: string;
  readonly cliVersion: string;
  readonly schemas: SchemaRegistry;
  readonly runnerPath?: string;
  readonly taskPath?: string;
  readonly runId?: string;
  readonly sessionId?: string;
  readonly caseKind?: AgentCaseKind;
  readonly externalCandidatePath?: string;
  readonly externalModelId?: string;
}

export interface AgentEvalRunRequest {
  readonly root: string;
  readonly harnessPath: string;
  readonly cliVersion: string;
  readonly schemas: SchemaRegistry;
  readonly runnerPath?: string;
  readonly taskPath?: string;
  readonly runId?: string;
  readonly sessionId?: string;
}

export interface AgentRunArtifacts {
  readonly status: AgentRunStatus;
  readonly expectationMet: boolean;
  readonly summary: JsonObject;
  readonly runResult: JsonObject;
  readonly trace: JsonObject;
  readonly verifierResult: JsonObject;
  readonly runResultOutputPath: string;
  readonly tracePath: string;
  readonly verifierResultPath: string;
  readonly agentOutputPath: string;
}

export interface AgentEvalRunArtifacts {
  readonly status: AgentRunStatus;
  readonly result: JsonObject;
  readonly markdown: string;
  readonly runs: readonly AgentRunArtifacts[];
  readonly scoreboard: JsonObject;
  readonly scoreboardPath: string;
  readonly runResultOutputPath: string;
}

interface RunnerContext {
  readonly root: string;
  readonly harnessPath: string;
  readonly harness: JsonObject;
  readonly cliVersion: string;
  readonly schemas: SchemaRegistry;
  readonly runnerPath: string;
  readonly runner: JsonObject;
  readonly taskPath: string;
  readonly task: EvalTaskData;
  readonly modelProfilePath: string;
  readonly modelProfile: JsonObject;
  readonly runResultOutputPath: string;
  readonly traceOutputDir: string;
  readonly verifierOutputDir: string;
  readonly agentOutputDir: string;
  readonly scoreboardDir: string;
  readonly sessionId: string;
}

interface EvalTaskData {
  readonly taskPath: string;
  readonly document: JsonObject;
  readonly suiteId: string;
  readonly taskId: string;
  readonly taskVersion: string;
  readonly datasetHash: string;
  readonly split: 'optimization' | 'holdout';
  readonly instruction: string;
  readonly environment: string;
  readonly timeoutSeconds: number;
  readonly verifier: JsonObject;
  readonly oracle?: EvalTaskArtifact;
  readonly baseline?: EvalTaskArtifact;
}

interface EvalTaskArtifact {
  readonly kind: string;
  readonly artifact: string;
}

interface AgentExecution {
  readonly mode: AgentExecutionMode;
  readonly status: AgentRunStatus;
  readonly failureCode?: FailureCode;
  readonly harnessStatus: AgentRunStatus;
  readonly verifierStatus: 'passed' | 'failed' | 'error' | 'skipped';
  readonly agentStatus?: 'passed' | 'failed' | 'error' | 'skipped';
  readonly modelStatus?: 'passed' | 'failed' | 'error' | 'skipped';
  readonly exitCode?: number;
  readonly signal?: string;
  readonly timedOut: boolean;
  readonly summary: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly externalModelId?: string;
  readonly importedCandidate?: {
    readonly sourcePath: string;
    readonly sha256: string;
  };
}

const schemaVersion = '0.1.0';
const defaultAgentOutputDir = '.harness/outputs/agent-outputs';
const defaultVerifierOutputDir = '.harness/outputs/verifier-results';
const defaultRunResultOutputPath = '.harness/outputs/run-results.jsonl';
const defaultScoreboardDir = '.harness/outputs/scoreboards';
const supportedFailureBuckets = [
  'agent-failure',
  'model-failure',
  'harness-error',
  'verifier-error',
  'verification-failure',
  'budget-exceeded',
  'credential-missing',
] as const;

export async function runAgentTask(request: AgentRunRequest): Promise<AgentRunArtifacts> {
  const context = await loadRunnerContext(request);
  const runId = runIdForCase(
    request.runId ??
      `${request.externalCandidatePath === undefined ? 'agent' : 'external'}-${randomUUID()}`,
    context.task,
    request.caseKind ?? 'oracle',
  );
  await validateRunResultLedgerReplacement(context.root, context.runResultOutputPath, [
    runResultIdentityForPreflight(
      runId,
      request.externalCandidatePath === undefined ? 'eval' : 'external-import',
      request.externalCandidatePath === undefined ? 'agent-run' : 'external-import',
    ),
  ]);
  if (request.externalCandidatePath !== undefined) {
    return await runExternalCandidateCase({
      context,
      runId,
      caseKind: request.caseKind ?? 'oracle',
      externalCandidatePath: request.externalCandidatePath,
      externalModelId: request.externalModelId ?? 'external-candidate',
    });
  }
  return await runAgentCase({
    context,
    runId,
    caseKind: request.caseKind ?? 'oracle',
  });
}

export async function runAgentEvalSuite(
  request: AgentEvalRunRequest,
): Promise<AgentEvalRunArtifacts> {
  const context = await loadRunnerContext(request);
  if (request.taskPath === undefined) {
    const discovery = await discoverEvalTaskPathsFromHarness({
      root: request.root,
      harnessPath: context.harnessPath,
      cliVersion: request.cliVersion,
      schemas: request.schemas,
    });
    if (discovery.issues.length > 0) {
      throw new CliError(
        `Eval task discovery failed for ${context.harnessPath}: ${discovery.issues.join('; ')}`,
        ExitCode.validationError,
      );
    }
    if (!discovery.taskPaths.includes(context.taskPath)) {
      throw new CliError(
        `runner.task_input ${context.taskPath} is not part of the configured eval suites.`,
        ExitCode.validationError,
      );
    }
    if (discovery.taskPaths.length !== 1) {
      throw new CliError(
        'eval run currently supports exactly one configured eval task for the selected runner. Multi-task runner mapping is a future capability.',
        ExitCode.validationError,
      );
    }
  }
  const taskPaths = [context.taskPath];
  const baseRunId = request.runId ?? `eval-run-${randomUUID()}`;
  await validateRunResultLedgerReplacement(
    context.root,
    context.runResultOutputPath,
    agentCasesForTask(context.task).map((caseKind) =>
      runResultIdentityForPreflight(
        runIdForCase(baseRunId, context.task, caseKind),
        'eval',
        'agent-run',
      ),
    ),
  );
  const runs: AgentRunArtifacts[] = [];
  for (const taskPath of taskPaths) {
    const taskContext =
      taskPath === context.taskPath ? context : await loadRunnerContext({ ...request, taskPath });
    for (const caseKind of agentCasesForTask(taskContext.task)) {
      runs.push(
        await runAgentCase({
          context: taskContext,
          runId: runIdForCase(baseRunId, taskContext.task, caseKind),
          caseKind,
        }),
      );
    }
  }

  const status = statusForRuns(runs);
  const scoreboardPath = `${context.scoreboardDir}/${baseRunId}.json`;
  const scoreboard = scoreboardForRuns({
    runId: baseRunId,
    sessionId: context.sessionId,
    cliVersion: context.cliVersion,
    status,
    runs,
    runResultOutputPath: context.runResultOutputPath,
  });
  const result: JsonObject = {
    schema_version: schemaVersion,
    run_id: baseRunId,
    session_id: context.sessionId,
    status,
    scoreboard: scoreboardPath,
    run_results: runs.map((run) => run.runResult),
    traces: runs.map((run) => run.tracePath),
    verifier_results: runs.map((run) => run.verifierResultPath),
  };

  return {
    status,
    result,
    markdown: renderEvalRunMarkdown(result, scoreboard),
    runs,
    scoreboard,
    scoreboardPath,
    runResultOutputPath: context.runResultOutputPath,
  };
}

function executionParticipants(
  mode: AgentExecutionMode,
  status: 'passed' | 'failed' | 'error',
): Pick<AgentExecution, 'agentStatus' | 'modelStatus'> {
  if (mode === 'external-import') {
    return {};
  }
  if (status === 'passed') {
    return { agentStatus: 'passed', modelStatus: 'passed' };
  }
  if (status === 'failed') {
    return { agentStatus: 'failed', modelStatus: 'passed' };
  }
  return { agentStatus: 'skipped', modelStatus: 'passed' };
}

export async function writeAgentRunArtifacts(
  root: string,
  runs: readonly AgentRunArtifacts[],
): Promise<void> {
  const runResultsByOutput = new Map<string, JsonObject[]>();
  for (const run of runs) {
    const current = runResultsByOutput.get(run.runResultOutputPath) ?? [];
    current.push(run.runResult);
    runResultsByOutput.set(run.runResultOutputPath, current);
  }
  for (const [outputPath, runResults] of runResultsByOutput) {
    await validateRunResultLedgerReplacement(root, outputPath, runResults);
  }
  for (const run of runs) {
    await writeJsonArtifact(root, run.tracePath, run.trace);
    await writeJsonArtifact(root, run.verifierResultPath, run.verifierResult);
  }
  for (const [outputPath, runResults] of runResultsByOutput) {
    await writeRunResultLedger(root, outputPath, runResults);
  }
}

export async function writeScoreboardArtifact(
  root: string,
  scoreboardPath: string,
  scoreboard: JsonObject,
): Promise<void> {
  await writeJsonArtifact(root, scoreboardPath, scoreboard);
}

export function renderRunMarkdown(run: AgentRunArtifacts): string {
  const execution = getObject(run.runResult, 'execution');
  const mode = execution === undefined ? 'unknown' : (getString(execution, 'mode') ?? 'unknown');
  return [
    '# Harness run',
    '',
    `- run_id: ${getString(run.runResult, 'run_id') ?? 'unknown'}`,
    `- status: ${run.status}`,
    `- execution_mode: ${mode}`,
    `- session_id: ${getString(run.trace, 'session_id') ?? 'unknown'}`,
    `- trace: ${run.tracePath}`,
    `- verifier_result: ${run.verifierResultPath}`,
    `- run_results: ${run.runResultOutputPath}`,
    ...(mode === 'external-import'
      ? ['', 'External import: model output was generated outside harness; no model call was made.']
      : []),
    '',
  ].join('\n');
}

async function loadRunnerContext(request: AgentRunRequest): Promise<RunnerContext> {
  const canonicalHarnessPath = relativePathFromRoot(
    request.root,
    resolveInsideRoot(request.root, request.harnessPath, 'Harness file'),
    'Harness file',
  );
  const harnessValidation = await validateHarnessConfiguration({
    root: request.root,
    harnessPath: canonicalHarnessPath,
    cliVersion: request.cliVersion,
    schemas: request.schemas,
  });
  const harnessIssues = [
    ...harnessValidation.schemaIssues.map((issue) => `schema: ${issue}`),
    ...harnessValidation.compatibilityIssues.map((issue) => `engines: ${issue}`),
    ...harnessValidation.referenceIssues.map((issue) => `reference: ${issue}`),
  ];
  if (harnessIssues.length > 0 || harnessValidation.document === undefined) {
    throw new CliError(
      `Harness validation failed for ${canonicalHarnessPath}: ${harnessIssues.join('; ')}`,
      ExitCode.validationError,
    );
  }

  const runnerPath = canonicalRunnerPath(
    request.root,
    harnessValidation.document,
    request.runnerPath,
  );
  const runner = await loadSchemaDocument({
    root: request.root,
    path: runnerPath,
    label: 'Agent runner',
    schemaName: 'agent-runner',
    schemas: request.schemas,
  });
  const externalImport = request.externalCandidatePath !== undefined;
  if (!externalImport) {
    validateDeterministicRunner(runner);
  }

  const taskPath = await canonicalTaskPathForRunner(request.root, runner, request.taskPath);
  const task = taskData(
    taskPath,
    await loadSchemaDocument({
      root: request.root,
      path: taskPath,
      label: 'Eval task',
      schemaName: 'eval-task',
      schemas: request.schemas,
    }),
  );
  await validateTaskDatasetHash(request.root, task);
  validateRunnerTaskBinding(request.root, runner, taskPath);

  const modelProfilePath = canonicalArtifactPath(
    request.root,
    requiredString(runner, 'model_profile'),
    'Model profile',
  );
  const modelProfile = await loadSchemaDocument({
    root: request.root,
    path: modelProfilePath,
    label: 'Model profile',
    schemaName: 'model-profile',
    schemas: request.schemas,
  });
  if (!externalImport) {
    validateStubModelProfile(modelProfile);
  }

  const evals = requiredObject(harnessValidation.document, 'evals');
  const continuity = requiredObject(harnessValidation.document, 'continuity');
  return {
    root: request.root,
    harnessPath: canonicalHarnessPath,
    harness: harnessValidation.document,
    cliVersion: request.cliVersion,
    schemas: request.schemas,
    runnerPath,
    runner,
    taskPath,
    task,
    modelProfilePath,
    modelProfile,
    runResultOutputPath: canonicalOutputPath(
      request.root,
      getString(evals, 'run_results') ?? defaultRunResultOutputPath,
      'Run result output',
    ),
    traceOutputDir: canonicalOutputPath(
      request.root,
      requiredString(runner, 'trace_output'),
      'Trace output',
    ),
    verifierOutputDir: defaultVerifierOutputDir,
    agentOutputDir: defaultAgentOutputDir,
    scoreboardDir: canonicalOutputPath(
      request.root,
      getString(evals, 'scoreboards') ?? defaultScoreboardDir,
      'Scoreboard output',
    ),
    sessionId: sessionIdForRun(request.sessionId, continuity),
  };
}

async function runAgentCase(input: {
  readonly context: RunnerContext;
  readonly runId: string;
  readonly caseKind: AgentCaseKind;
}): Promise<AgentRunArtifacts> {
  const candidatePath = candidatePathForCase(
    input.context.root,
    input.context.task,
    input.caseKind,
  );
  const agentOutputPath = `${input.context.agentOutputDir}/${input.runId}.txt`;
  const tracePath = `${input.context.traceOutputDir}/${input.runId}.json`;
  const verifierResultPath = `${input.context.verifierOutputDir}/${input.runId}.json`;
  const startedAt = new Date();
  const trustIssue = validateVerifierTrust(input.context, agentOutputPath);
  const execution =
    trustIssue === undefined
      ? await emitStubOutputAndExecuteVerifier({
          context: input.context,
          candidatePath,
          agentOutputPath,
          caseKind: input.caseKind,
        })
      : harnessRefusalExecution(trustIssue);
  const completedAt = new Date();
  const expectationMet =
    input.caseKind === 'oracle' ? execution.status === 'passed' : execution.status === 'failed';
  const runResult = runResultForAgentCase({
    context: input.context,
    runId: input.runId,
    caseKind: input.caseKind,
    agentOutputPath,
    tracePath,
    verifierResultPath,
    execution,
  });
  const trace = traceForAgentCase({
    context: input.context,
    runId: input.runId,
    caseKind: input.caseKind,
    agentOutputPath,
    verifierResultPath,
    runResultOutputPath: input.context.runResultOutputPath,
    startedAt,
    completedAt,
    execution,
  });
  const verifierResult = verifierResultForAgentCase({
    context: input.context,
    runId: input.runId,
    caseKind: input.caseKind,
    candidatePath: agentOutputPath,
    execution,
  });
  return {
    status: execution.status,
    expectationMet,
    summary: {
      run_id: input.runId,
      case: input.caseKind,
      expected_status: input.caseKind === 'oracle' ? 'passed' : 'failed',
      actual_status: execution.status,
      expectation_met: expectationMet,
      agent_output: agentOutputPath,
      trace: tracePath,
      verifier_result: verifierResultPath,
    },
    runResult,
    trace,
    verifierResult,
    runResultOutputPath: input.context.runResultOutputPath,
    tracePath,
    verifierResultPath,
    agentOutputPath,
  };
}

async function runExternalCandidateCase(input: {
  readonly context: RunnerContext;
  readonly runId: string;
  readonly caseKind: AgentCaseKind;
  readonly externalCandidatePath: string;
  readonly externalModelId: string;
}): Promise<AgentRunArtifacts> {
  const agentOutputPath = `${input.context.agentOutputDir}/${input.runId}.txt`;
  const tracePath = `${input.context.traceOutputDir}/${input.runId}.json`;
  const verifierResultPath = `${input.context.verifierOutputDir}/${input.runId}.json`;
  const startedAt = new Date();
  const trustIssue = validateVerifierTrust(input.context, agentOutputPath);
  const execution =
    trustIssue === undefined
      ? await importExternalCandidateAndExecuteVerifier({
          context: input.context,
          externalCandidatePath: input.externalCandidatePath,
          agentOutputPath,
          caseKind: input.caseKind,
          externalModelId: input.externalModelId,
        })
      : harnessRefusalExecution(trustIssue, 'external-import');
  const completedAt = new Date();
  const expectationMet =
    input.caseKind === 'oracle' ? execution.status === 'passed' : execution.status === 'failed';
  const runResult = runResultForAgentCase({
    context: input.context,
    runId: input.runId,
    caseKind: input.caseKind,
    agentOutputPath,
    tracePath,
    verifierResultPath,
    execution,
  });
  const trace = traceForAgentCase({
    context: input.context,
    runId: input.runId,
    caseKind: input.caseKind,
    agentOutputPath,
    verifierResultPath,
    runResultOutputPath: input.context.runResultOutputPath,
    startedAt,
    completedAt,
    execution,
  });
  const verifierResult = verifierResultForAgentCase({
    context: input.context,
    runId: input.runId,
    caseKind: input.caseKind,
    candidatePath: agentOutputPath,
    execution,
  });
  return {
    status: execution.status,
    expectationMet,
    summary: {
      run_id: input.runId,
      case: input.caseKind,
      expected_status: input.caseKind === 'oracle' ? 'passed' : 'failed',
      actual_status: execution.status,
      expectation_met: expectationMet,
      source_candidate: execution.importedCandidate?.sourcePath ?? input.externalCandidatePath,
      agent_output: agentOutputPath,
      trace: tracePath,
      verifier_result: verifierResultPath,
    },
    runResult,
    trace,
    verifierResult,
    runResultOutputPath: input.context.runResultOutputPath,
    tracePath,
    verifierResultPath,
    agentOutputPath,
  };
}

async function executeVerifierForAgentOutput(input: {
  readonly context: RunnerContext;
  readonly candidatePath: string;
  readonly caseKind: AgentCaseKind;
  readonly mode: AgentExecutionMode;
  readonly externalModelId?: string;
  readonly importedCandidate?: AgentExecution['importedCandidate'];
}): Promise<AgentExecution> {
  const command = requiredObject(input.context.task.verifier, 'command');
  const timeoutSeconds = Math.min(
    getNumber(command, 'timeout_seconds') ?? input.context.task.timeoutSeconds,
    input.context.task.timeoutSeconds,
  );
  const workingDirectory = getString(command, 'working_directory');
  const cwd =
    workingDirectory === undefined
      ? input.context.root
      : resolveInsideRoot(input.context.root, workingDirectory, 'Verifier working directory');
  const result = await runShellCommand({
    command: requiredString(command, 'command'),
    cwd,
    timeoutSeconds,
    processLabel: 'Verifier process',
    environment: {
      ...stringMap(getObject(command, 'environment')),
      HARNESS_EVAL_CASE: input.caseKind,
      HARNESS_EVAL_EXPECTED_STATUS: input.caseKind === 'oracle' ? 'passed' : 'failed',
      HARNESS_EVAL_CANDIDATE: input.candidatePath,
      HARNESS_EVAL_TASK: input.context.task.taskPath,
      HARNESS_EVAL_SUITE_ID: input.context.task.suiteId,
      HARNESS_EVAL_TASK_ID: input.context.task.taskId,
      HARNESS_EVAL_TASK_VERSION: input.context.task.taskVersion,
      HARNESS_EVAL_DATASET_HASH: input.context.task.datasetHash,
      HARNESS_EVAL_SPLIT: input.context.task.split,
    },
  });

  if (result.timedOut) {
    return {
      mode: input.mode,
      status: 'error',
      harnessStatus: 'passed',
      verifierStatus: 'error',
      failureCode: 'timeout',
      ...executionParticipants(input.mode, 'error'),
      ...(input.externalModelId === undefined ? {} : { externalModelId: input.externalModelId }),
      ...(input.importedCandidate === undefined
        ? {}
        : { importedCandidate: input.importedCandidate }),
      ...(result.signal === undefined ? {} : { signal: result.signal }),
      timedOut: true,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: `Verifier timed out after ${timeoutSeconds} second(s).`,
    };
  }
  if (result.error !== undefined || result.exitCode === 126 || result.exitCode === 127) {
    return {
      mode: input.mode,
      status: 'error',
      harnessStatus: 'passed',
      verifierStatus: 'error',
      failureCode: 'verifier-error',
      ...executionParticipants(input.mode, 'error'),
      ...(input.externalModelId === undefined ? {} : { externalModelId: input.externalModelId }),
      ...(input.importedCandidate === undefined
        ? {}
        : { importedCandidate: input.importedCandidate }),
      ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
      ...(result.signal === undefined ? {} : { signal: result.signal }),
      timedOut: false,
      stdout: result.stdout,
      stderr: result.stderr,
      summary:
        result.error ??
        `Verifier command exited ${result.exitCode}, indicating the verifier command could not execute.`,
    };
  }
  if (result.exitCode === 0) {
    return {
      mode: input.mode,
      status: 'passed',
      harnessStatus: 'passed',
      verifierStatus: 'passed',
      ...executionParticipants(input.mode, 'passed'),
      ...(input.externalModelId === undefined ? {} : { externalModelId: input.externalModelId }),
      ...(input.importedCandidate === undefined
        ? {}
        : { importedCandidate: input.importedCandidate }),
      exitCode: result.exitCode,
      timedOut: false,
      stdout: result.stdout,
      stderr: result.stderr,
      summary:
        input.mode === 'external-import'
          ? 'External candidate satisfied the verifier.'
          : 'Deterministic stub output satisfied the verifier.',
    };
  }
  return {
    mode: input.mode,
    status: 'failed',
    harnessStatus: 'passed',
    verifierStatus: 'failed',
    ...executionParticipants(input.mode, 'failed'),
    failureCode: input.mode === 'external-import' ? 'verification-failure' : 'agent-failure',
    ...(input.externalModelId === undefined ? {} : { externalModelId: input.externalModelId }),
    ...(input.importedCandidate === undefined
      ? {}
      : { importedCandidate: input.importedCandidate }),
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    ...(result.signal === undefined ? {} : { signal: result.signal }),
    timedOut: false,
    stdout: result.stdout,
    stderr: result.stderr,
    summary:
      input.mode === 'external-import'
        ? `External candidate failed the verifier with exit ${result.exitCode ?? `signal ${result.signal ?? 'unknown'}`}.`
        : `Deterministic stub output failed the verifier with exit ${result.exitCode ?? `signal ${result.signal ?? 'unknown'}`}.`,
  };
}

async function emitStubOutputAndExecuteVerifier(input: {
  readonly context: RunnerContext;
  readonly candidatePath: string;
  readonly agentOutputPath: string;
  readonly caseKind: AgentCaseKind;
}): Promise<AgentExecution> {
  const candidateAbsolutePath = resolveInsideRoot(
    input.context.root,
    input.candidatePath,
    'Stub output',
  );
  await assertNoSymlinkWithinRoot(input.context.root, candidateAbsolutePath);
  const agentOutput = await readFile(candidateAbsolutePath, 'utf8');
  await writeTextNoFollowCreatingDirectories(
    input.context.root,
    resolveInsideRoot(input.context.root, input.agentOutputPath, 'Agent output'),
    agentOutput,
  );
  return await executeVerifierForAgentOutput({
    context: input.context,
    candidatePath: input.agentOutputPath,
    caseKind: input.caseKind,
    mode: 'agent-run',
  });
}

async function importExternalCandidateAndExecuteVerifier(input: {
  readonly context: RunnerContext;
  readonly externalCandidatePath: string;
  readonly agentOutputPath: string;
  readonly caseKind: AgentCaseKind;
  readonly externalModelId: string;
}): Promise<AgentExecution> {
  const sourcePath = canonicalArtifactPath(
    input.context.root,
    input.externalCandidatePath,
    'External candidate',
  );
  const absoluteCandidatePath = resolveInsideRoot(
    input.context.root,
    sourcePath,
    'External candidate',
  );
  await assertNoSymlinkWithinRoot(input.context.root, absoluteCandidatePath, 'read');
  if ((await pathKind(absoluteCandidatePath)) !== 'file') {
    throw new CliError(
      `External candidate not found: ${input.externalCandidatePath}`,
      ExitCode.notFound,
    );
  }
  const candidate = await readFile(absoluteCandidatePath, 'utf8');
  const sha256 = createHash('sha256').update(candidate).digest('hex');
  await writeTextNoFollowCreatingDirectories(
    input.context.root,
    resolveInsideRoot(input.context.root, input.agentOutputPath, 'Agent output'),
    candidate,
  );
  return await executeVerifierForAgentOutput({
    context: input.context,
    candidatePath: input.agentOutputPath,
    caseKind: input.caseKind,
    mode: 'external-import',
    externalModelId: input.externalModelId,
    importedCandidate: {
      sourcePath,
      sha256: `sha256:${sha256}`,
    },
  });
}

function harnessRefusalExecution(
  summary: string,
  mode: AgentExecutionMode = 'agent-run',
): AgentExecution {
  return {
    mode,
    status: 'error',
    harnessStatus: 'failed',
    verifierStatus: 'skipped',
    ...(mode === 'agent-run'
      ? { agentStatus: 'skipped' as const, modelStatus: 'skipped' as const }
      : {}),
    failureCode: 'sandbox-violation',
    timedOut: false,
    stdout: '',
    stderr: '',
    summary,
  };
}

function hasAgentOutput(execution: AgentExecution): boolean {
  return execution.harnessStatus !== 'failed' && execution.verifierStatus !== 'skipped';
}

function runResultForAgentCase(input: {
  readonly context: RunnerContext;
  readonly runId: string;
  readonly caseKind: AgentCaseKind;
  readonly agentOutputPath: string;
  readonly tracePath: string;
  readonly verifierResultPath: string;
  readonly execution: AgentExecution;
}): JsonObject {
  return {
    schema_version: schemaVersion,
    run_id: input.runId,
    kind: input.execution.mode === 'external-import' ? 'external-import' : 'eval',
    suite_id: input.context.task.suiteId,
    task_id: input.context.task.taskId,
    task_version: input.context.task.taskVersion,
    dataset_hash: input.context.task.datasetHash,
    split: input.context.task.split,
    model_profile: modelProfileRefForExecution(input.context, input.execution),
    harness_version: input.context.cliVersion,
    status: input.execution.status,
    ...(input.execution.failureCode === undefined
      ? {}
      : { failure_code: input.execution.failureCode }),
    trace: input.tracePath,
    verifier_result: input.verifierResultPath,
    execution: {
      mode: input.execution.mode,
      harness_status: input.execution.harnessStatus,
      verifier_status: input.execution.verifierStatus,
      ...(input.execution.agentStatus === undefined
        ? {}
        : { agent_status: input.execution.agentStatus }),
      ...(input.execution.modelStatus === undefined
        ? {}
        : { model_status: input.execution.modelStatus }),
    },
    usage: usageForExecution(input.context.modelProfile, input.execution),
    artifacts: [
      {
        path: input.context.task.taskPath,
        media_type: mediaTypeForPath(input.context.task.taskPath),
        description:
          input.execution.mode === 'external-import'
            ? 'Eval task verified against an externally imported candidate.'
            : 'Eval task executed by deterministic stub runner.',
      },
      {
        path: input.context.runnerPath,
        media_type: mediaTypeForPath(input.context.runnerPath),
        description:
          input.execution.mode === 'external-import'
            ? 'Runner declaration referenced as import context; it did not execute this candidate.'
            : 'Agent runner declaration.',
      },
      ...(input.execution.importedCandidate === undefined
        ? []
        : [
            {
              path: input.execution.importedCandidate.sourcePath,
              media_type: mediaTypeForPath(input.execution.importedCandidate.sourcePath),
              description: `Original external candidate (${input.execution.importedCandidate.sha256}).`,
            },
          ]),
      ...(hasAgentOutput(input.execution)
        ? [
            {
              path: input.agentOutputPath,
              media_type: 'text/plain',
              description:
                input.execution.mode === 'external-import'
                  ? 'Imported candidate copied into the harness agent-output area.'
                  : `${input.caseKind} deterministic stub output.`,
            },
          ]
        : []),
    ],
  };
}

function traceForAgentCase(input: {
  readonly context: RunnerContext;
  readonly runId: string;
  readonly caseKind: AgentCaseKind;
  readonly agentOutputPath: string;
  readonly verifierResultPath: string;
  readonly runResultOutputPath: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly execution: AgentExecution;
}): JsonObject {
  const usage = usageForExecution(input.context.modelProfile, input.execution);
  return {
    schema_version: schemaVersion,
    session_id: input.context.sessionId,
    run_id: input.runId,
    harness_version: input.context.cliVersion,
    inputs: {
      task: input.context.task.taskPath,
      runner: input.context.runnerPath,
    },
    environment_snapshot: {
      environment: input.context.task.environment,
      sandbox: requiredString(input.context.runner, 'sandbox'),
      approval_policy: requiredString(input.context.runner, 'approval_policy'),
      model_profile: modelProfileRefForExecution(input.context, input.execution),
      runner: input.context.runnerPath,
    },
    started_at: input.startedAt.toISOString(),
    completed_at: input.completedAt.toISOString(),
    duration_ms: Math.max(0, input.completedAt.getTime() - input.startedAt.getTime()),
    exit_code: input.execution.status === 'passed' ? 0 : 1,
    determinism_level: input.execution.mode === 'external-import' ? 'external-import' : 'recorded',
    credential_reference: credentialReferenceForExecution(input.execution, input.context.runner),
    budgets: requiredObject(input.context.runner, 'budgets'),
    usage,
    actions: traceActionsForAgentCase({ ...input, usage }),
    logs: [],
    artifact_links: [
      {
        path: input.runResultOutputPath,
        media_type: 'application/jsonl',
        description: 'Run-result ledger containing this run result.',
      },
      ...(hasAgentOutput(input.execution)
        ? [
            {
              path: input.agentOutputPath,
              media_type: 'text/plain',
              description:
                input.execution.mode === 'external-import'
                  ? 'Imported candidate copied into the harness agent-output area.'
                  : 'Deterministic stub output.',
            },
          ]
        : []),
      ...(input.execution.importedCandidate === undefined
        ? []
        : [
            {
              path: input.execution.importedCandidate.sourcePath,
              media_type: mediaTypeForPath(input.execution.importedCandidate.sourcePath),
              description: `Original external candidate (${input.execution.importedCandidate.sha256}).`,
            },
          ]),
      {
        path: input.verifierResultPath,
        media_type: 'application/json',
        description: 'Verifier result for this run.',
      },
    ],
  };
}

function traceActionsForAgentCase(input: {
  readonly context: RunnerContext;
  readonly runId: string;
  readonly caseKind: AgentCaseKind;
  readonly agentOutputPath: string;
  readonly verifierResultPath: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly execution: AgentExecution;
  readonly usage: JsonObject;
}): JsonObject[] {
  if (input.execution.harnessStatus === 'failed') {
    return [
      {
        id: `${input.runId}-harness-refusal`,
        type: 'system',
        timestamp: input.completedAt.toISOString(),
        summary: input.execution.summary,
        artifacts: [
          {
            path: input.verifierResultPath,
            media_type: 'application/json',
            description: 'Skipped verifier result for this refused run.',
          },
        ],
      },
    ];
  }
  if (input.execution.mode === 'external-import') {
    return [
      {
        id: `${input.runId}-external-import`,
        type: 'system',
        timestamp: input.startedAt.toISOString(),
        summary: `Imported external candidate for verifier execution; no model call was made by harness.${input.execution.importedCandidate === undefined ? '' : ` source_sha256=${input.execution.importedCandidate.sha256}`}`,
        artifacts:
          input.execution.importedCandidate === undefined
            ? [
                {
                  path: input.agentOutputPath,
                  media_type: 'text/plain',
                  description: 'Imported candidate copied into the harness agent-output area.',
                },
              ]
            : [
                {
                  path: input.execution.importedCandidate.sourcePath,
                  media_type: mediaTypeForPath(input.execution.importedCandidate.sourcePath),
                  description: `Original external candidate (${input.execution.importedCandidate.sha256}).`,
                },
                {
                  path: input.agentOutputPath,
                  media_type: 'text/plain',
                  description: 'Imported candidate copied into the harness agent-output area.',
                },
              ],
      },
      {
        id: `${input.runId}-verifier`,
        type: 'verifier',
        timestamp: input.completedAt.toISOString(),
        summary: input.execution.summary,
        artifacts: [
          {
            path: input.verifierResultPath,
            media_type: 'application/json',
            description: 'Verifier result for this run.',
          },
        ],
      },
    ];
  }
  return [
    {
      id: `${input.runId}-stub-model`,
      type: 'model',
      timestamp: input.startedAt.toISOString(),
      summary: `Deterministic stub emitted ${input.caseKind} recorded output.`,
      model_call: {
        model_id: requiredString(input.context.modelProfile, 'model_id'),
        request_id: `${input.runId}-stub-request`,
        usage: input.usage,
        latency_ms: 0,
      },
      artifacts: [
        {
          path: input.agentOutputPath,
          media_type: 'text/plain',
          description: 'Recorded stub output.',
        },
      ],
    },
    {
      id: `${input.runId}-verifier`,
      type: 'verifier',
      timestamp: input.completedAt.toISOString(),
      summary: input.execution.summary,
      artifacts: [
        {
          path: input.verifierResultPath,
          media_type: 'application/json',
          description: 'Verifier result for this run.',
        },
      ],
    },
  ];
}

function verifierResultForAgentCase(input: {
  readonly context: RunnerContext;
  readonly runId: string;
  readonly caseKind: AgentCaseKind;
  readonly candidatePath: string;
  readonly execution: AgentExecution;
}): JsonObject {
  return {
    schema_version: schemaVersion,
    verifier_id: input.context.task.taskId,
    run_id: input.runId,
    case: input.caseKind,
    expected_status: input.caseKind === 'oracle' ? 'passed' : 'failed',
    candidate: input.candidatePath,
    status: input.execution.verifierStatus,
    harness_status: input.execution.harnessStatus,
    summary: input.execution.summary,
    timed_out: input.execution.timedOut,
    ...(input.execution.exitCode === undefined ? {} : { exit_code: input.execution.exitCode }),
    ...(input.execution.signal === undefined ? {} : { signal: input.execution.signal }),
  };
}

function scoreboardForRuns(input: {
  readonly runId: string;
  readonly sessionId: string;
  readonly cliVersion: string;
  readonly status: AgentRunStatus;
  readonly runs: readonly AgentRunArtifacts[];
  readonly runResultOutputPath: string;
}): JsonObject {
  const splits = ['optimization', 'holdout'] as const;
  return {
    schema_version: schemaVersion,
    scoreboard_id: `scoreboard-${input.runId}`,
    run_id: input.runId,
    session_id: input.sessionId,
    harness_version: input.cliVersion,
    generated_at: new Date().toISOString(),
    status: input.status,
    splits: splits.map((split) =>
      summarizeRuns(
        input.runs.filter((run) => getString(run.runResult, 'split') === split),
        split,
      ),
    ),
    totals: summarizeRuns(input.runs),
    run_results: [
      {
        path: input.runResultOutputPath,
        media_type: 'application/jsonl',
        description: 'Run-result ledger summarized by this scoreboard.',
      },
    ],
  };
}

function summarizeRuns(runs: readonly AgentRunArtifacts[], split?: string): JsonObject {
  const summary: JsonObject = {
    ...(split === undefined ? {} : { split }),
    total: runs.length,
    passed: runs.filter((run) => run.status === 'passed').length,
    failed: runs.filter((run) => run.status === 'failed').length,
    error: runs.filter((run) => run.status === 'error').length,
    failure_buckets: emptyFailureBuckets(),
  };
  const buckets = requiredObject(summary, 'failure_buckets');
  for (const run of runs) {
    const failureCode = getString(run.runResult, 'failure_code');
    const bucket =
      failureCode === undefined ? undefined : scoreboardBucketForFailureCode(failureCode);
    if (bucket !== undefined) {
      buckets[bucket] = (typeof buckets[bucket] === 'number' ? buckets[bucket] : 0) + 1;
    }
  }
  return summary;
}

function scoreboardBucketForFailureCode(code: string): ScoreboardFailureBucket | undefined {
  switch (code) {
    case 'agent-failure':
    case 'model-failure':
    case 'harness-error':
    case 'verifier-error':
    case 'verification-failure':
    case 'budget-exceeded':
    case 'credential-missing':
      return code;
    case 'sandbox-violation':
      return 'harness-error';
    case 'timeout':
      return 'verifier-error';
    default:
      return undefined;
  }
}

function emptyFailureBuckets(): JsonObject {
  const buckets: JsonObject = {};
  for (const code of supportedFailureBuckets) {
    buckets[code] = 0;
  }
  return buckets;
}

function statusForRuns(runs: readonly AgentRunArtifacts[]): AgentRunStatus {
  if (runs.some((run) => run.status === 'error')) {
    return 'error';
  }
  return runs.every((run) => run.expectationMet) ? 'passed' : 'failed';
}

async function writeJsonArtifact(
  root: string,
  path: string,
  value: JsonObject | string,
): Promise<void> {
  const absolutePath = resolveInsideRoot(root, path, 'Artifact output');
  await assertNoSymlinkWithinRoot(root, absolutePath);
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeTextNoFollowCreatingDirectories(root, absolutePath, text);
}

async function writeRunResultLedger(
  root: string,
  outputPath: string,
  runResults: readonly JsonObject[],
): Promise<void> {
  const absoluteOutputPath = resolveInsideRoot(root, outputPath, 'Run result output');
  await assertNoSymlinkWithinRoot(root, absoluteOutputPath);
  const incomingRunIds = new Set(
    runResults
      .map((runResult) => getString(runResult, 'run_id'))
      .filter((runId): runId is string => runId !== undefined),
  );
  const existingRunResults =
    (await pathKind(absoluteOutputPath)) === 'file'
      ? parseRunResultLedger(await readFile(absoluteOutputPath, 'utf8'), outputPath)
      : [];
  validateRunResultReplacement(existingRunResults, runResults);
  const retainedRunResults = existingRunResults.filter((runResult) => {
    const runId = getString(runResult, 'run_id');
    return runId === undefined || !incomingRunIds.has(runId);
  });
  const jsonl = [...retainedRunResults, ...runResults]
    .map((runResult) => JSON.stringify(runResult))
    .join('\n');
  await writeTextNoFollowCreatingDirectories(
    root,
    absoluteOutputPath,
    jsonl.length === 0 ? '' : `${jsonl}\n`,
  );
}

async function validateRunResultLedgerReplacement(
  root: string,
  outputPath: string,
  runResults: readonly JsonObject[],
): Promise<void> {
  const absoluteOutputPath = resolveInsideRoot(root, outputPath, 'Run result output');
  await assertNoSymlinkWithinRoot(root, absoluteOutputPath);
  const existingRunResults =
    (await pathKind(absoluteOutputPath)) === 'file'
      ? parseRunResultLedger(await readFile(absoluteOutputPath, 'utf8'), outputPath)
      : [];
  validateRunResultReplacement(existingRunResults, runResults);
}

function validateRunResultReplacement(
  existingRunResults: readonly JsonObject[],
  runResults: readonly JsonObject[],
): void {
  for (const incoming of runResults) {
    const incomingRunId = getString(incoming, 'run_id');
    if (incomingRunId === undefined) {
      continue;
    }
    const incomingIdentity = runResultLedgerIdentity(incoming);
    const conflicting = existingRunResults.find((existing) => {
      return (
        getString(existing, 'run_id') === incomingRunId &&
        runResultLedgerIdentity(existing) !== incomingIdentity
      );
    });
    if (conflicting !== undefined) {
      throw new CliError(
        `Refusing to replace run-result ${incomingRunId} with a different evidence kind (${runResultLedgerIdentity(conflicting)} -> ${incomingIdentity}). Use a different --run-id.`,
        ExitCode.validationError,
      );
    }
  }
}

function parseRunResultLedger(text: string, outputPath: string): JsonObject[] {
  const results: JsonObject[] = [];
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const [index, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(
        `Run result ledger ${outputPath} line ${index + 1} is not valid JSON: ${message}`,
        ExitCode.validationError,
      );
    }
    if (!isObject(parsed)) {
      throw new CliError(
        `Run result ledger ${outputPath} line ${index + 1} must be a JSON object.`,
        ExitCode.validationError,
      );
    }
    results.push(parsed);
  }
  return results;
}

function runResultLedgerIdentity(runResult: JsonObject): string {
  const execution = getObject(runResult, 'execution') ?? {};
  return `${getString(runResult, 'kind') ?? '<missing>'}/${getString(execution, 'mode') ?? '<missing>'}`;
}

function runResultIdentityForPreflight(
  runId: string,
  kind: 'eval' | 'external-import',
  mode: AgentExecutionMode,
): JsonObject {
  return {
    run_id: runId,
    kind,
    execution: {
      mode,
    },
  };
}

function renderEvalRunMarkdown(result: JsonObject, scoreboard: JsonObject): string {
  const totals = requiredObject(scoreboard, 'totals');
  return [
    '# Harness eval run',
    '',
    `- run_id: ${getString(result, 'run_id') ?? 'unknown'}`,
    `- status: ${getString(result, 'status') ?? 'unknown'}`,
    `- scoreboard: ${getString(result, 'scoreboard') ?? 'unknown'}`,
    `- total runs: ${getNumber(totals, 'total') ?? 0}`,
    `- passed: ${getNumber(totals, 'passed') ?? 0}`,
    `- failed: ${getNumber(totals, 'failed') ?? 0}`,
    `- error: ${getNumber(totals, 'error') ?? 0}`,
    '',
  ].join('\n');
}

function canonicalRunnerPath(
  root: string,
  harness: JsonObject,
  runnerPath: string | undefined,
): string {
  if (runnerPath !== undefined) {
    return canonicalArtifactPath(root, runnerPath, 'Agent runner');
  }
  const runners = requiredObject(harness, 'agent_runners');
  const defaultRunner = getString(runners, 'default');
  if (defaultRunner === undefined) {
    throw new CliError(
      'harness run requires agent_runners.default or --runner.',
      ExitCode.validationError,
    );
  }
  return canonicalArtifactPath(root, defaultRunner, 'Agent runner');
}

async function canonicalTaskPathForRunner(
  root: string,
  runner: JsonObject,
  taskPath: string | undefined,
): Promise<string> {
  const runnerTask = canonicalArtifactPath(
    root,
    requiredString(runner, 'task_input'),
    'Runner task input',
  );
  if (taskPath === undefined) {
    return runnerTask;
  }
  const explicitTask = canonicalArtifactPath(root, taskPath, 'Eval task');
  if (explicitTask !== runnerTask) {
    throw new CliError(
      `harness run task ${explicitTask} does not match runner.task_input ${runnerTask}.`,
      ExitCode.validationError,
    );
  }
  return explicitTask;
}

function validateRunnerTaskBinding(root: string, runner: JsonObject, taskPath: string): void {
  const verifierBinding = requiredObject(runner, 'verifier_binding');
  const bindingTask = canonicalArtifactPath(
    root,
    requiredString(verifierBinding, 'eval_task'),
    'Verifier binding task',
  );
  if (bindingTask !== taskPath) {
    throw new CliError(
      `runner.verifier_binding.eval_task ${bindingTask} does not match task ${taskPath}.`,
      ExitCode.validationError,
    );
  }
  const verifierRef = requiredString(verifierBinding, 'verifier');
  const verifierPath = canonicalArtifactPath(root, stripFragment(verifierRef), 'Verifier binding');
  if (verifierPath !== taskPath || !verifierRef.endsWith('#/verifier')) {
    throw new CliError(
      `runner.verifier_binding.verifier must point at ${taskPath}#/verifier.`,
      ExitCode.validationError,
    );
  }
}

function validateDeterministicRunner(runner: JsonObject): void {
  const credential = requiredObject(runner, 'credential_reference');
  if (requiredString(credential, 'source') !== 'stub') {
    throw new CliError(
      'deterministic runner requires credential_reference.source: stub.',
      ExitCode.validationError,
    );
  }
  const budgets = requiredObject(runner, 'budgets');
  if (
    getNumber(budgets, 'max_cost_usd') === undefined ||
    getNumber(budgets, 'max_requests') === undefined
  ) {
    throw new CliError(
      'deterministic runner requires explicit cost and request budgets.',
      ExitCode.validationError,
    );
  }
}

function validateStubModelProfile(modelProfile: JsonObject): void {
  if (requiredString(modelProfile, 'provider') !== 'harness-fixture') {
    throw new CliError(
      'deterministic runner only supports harness-fixture model profiles.',
      ExitCode.validationError,
    );
  }
}

async function validateTaskDatasetHash(root: string, task: EvalTaskData): Promise<void> {
  const computed = await computeEvalTaskDatasetHash(root, task.document);
  if (computed !== task.datasetHash) {
    throw new CliError(
      `dataset_hash mismatch: declared ${task.datasetHash}, computed ${computed}`,
      ExitCode.validationError,
    );
  }
}

async function loadSchemaDocument(input: {
  readonly root: string;
  readonly path: string;
  readonly label: string;
  readonly schemaName: string;
  readonly schemas: SchemaRegistry;
}): Promise<JsonObject> {
  const absolutePath = resolveInsideRoot(input.root, input.path, input.label);
  if ((await pathKind(absolutePath)) !== 'file') {
    throw new CliError(`${input.label} not found: ${input.path}`, ExitCode.notFound);
  }
  const document = await loadDocument(absolutePath);
  const issues = input.schemas.validate(input.schemaName, document).map(formatValidationIssue);
  if (issues.length > 0 || !isObject(document)) {
    throw new CliError(
      `${input.label} validation failed for ${input.path}: ${issues.length > 0 ? issues.join('; ') : 'document must be an object'}`,
      ExitCode.validationError,
    );
  }
  return document;
}

function taskData(taskPath: string, document: JsonObject): EvalTaskData {
  return {
    taskPath,
    document,
    suiteId: requiredString(document, 'suite_id'),
    taskId: requiredString(document, 'task_id'),
    taskVersion: requiredString(document, 'task_version'),
    datasetHash: requiredString(document, 'dataset_hash'),
    split: requiredString(document, 'split') === 'holdout' ? 'holdout' : 'optimization',
    instruction: requiredString(document, 'instruction'),
    environment: requiredString(document, 'environment'),
    timeoutSeconds: requiredNumber(document, 'timeout_seconds'),
    verifier: requiredObject(document, 'verifier'),
    ...optionalArtifact(document, 'oracle'),
    ...optionalArtifact(document, 'baseline'),
  };
}

function agentCasesForTask(task: EvalTaskData): readonly AgentCaseKind[] {
  return task.baseline === undefined ? ['oracle'] : ['oracle', 'broken-twin'];
}

function candidatePathForCase(root: string, task: EvalTaskData, caseKind: AgentCaseKind): string {
  if (caseKind === 'oracle') {
    if (task.oracle === undefined) {
      throw new CliError(
        `Eval task ${task.taskPath} does not declare an oracle artifact.`,
        ExitCode.validationError,
      );
    }
    return canonicalArtifactPath(root, task.oracle.artifact, 'Oracle artifact');
  }
  if (task.baseline === undefined || task.baseline.kind !== 'expected-failure') {
    throw new CliError(
      `Eval task ${task.taskPath} does not declare an expected-failure baseline artifact.`,
      ExitCode.validationError,
    );
  }
  return canonicalArtifactPath(root, task.baseline.artifact, 'Baseline artifact');
}

function validateVerifierTrust(context: RunnerContext, candidatePath: string): string | undefined {
  const kind = requiredString(context.task.verifier, 'kind');
  if (kind !== 'command') {
    return `deterministic runner only executes command verifiers, not ${kind} verifiers.`;
  }
  const trust = requiredObject(context.task.verifier, 'trust_requirements');
  if (requiredString(trust, 'trust_level') !== 'sandboxed') {
    return 'deterministic runner requires sandboxed verifier trust.';
  }
  if (requiredString(trust, 'sandbox_required') !== 'process') {
    return 'deterministic runner can only satisfy process sandbox declarations.';
  }
  if (
    getBoolean(trust, 'network_access') !== false ||
    getBoolean(trust, 'secret_access') !== false ||
    getBoolean(trust, 'host_file_access') !== false
  ) {
    return 'deterministic runner refuses verifiers with network, secret, or host-file access.';
  }
  const allowedInputs = normalizedDeclaredPaths(
    context.root,
    getArray(trust, 'allowed_inputs') ?? [],
  );
  if (!declaresPath(allowedInputs, candidatePath)) {
    return `Verifier allowed_inputs does not include agent output: ${candidatePath}`;
  }
  const allowedOutputs = normalizedDeclaredPaths(
    context.root,
    getArray(trust, 'allowed_outputs') ?? [],
  );
  if (!declaresPath(allowedOutputs, context.runResultOutputPath)) {
    return `Verifier allowed_outputs does not include run-result output: ${context.runResultOutputPath}`;
  }
  if (!declaresPath(allowedOutputs, context.verifierOutputDir)) {
    return `Verifier allowed_outputs does not include verifier-result output dir: ${context.verifierOutputDir}`;
  }
  return undefined;
}

function runIdForCase(baseRunId: string, task: EvalTaskData, caseKind: AgentCaseKind): string {
  const digest = createHash('sha256')
    .update([task.taskPath, task.taskVersion, task.datasetHash, task.split, caseKind].join('\n'))
    .digest('hex')
    .slice(0, 12);
  return `${baseRunId}-${caseKind}-${digest}`;
}

function statusCodeForRun(status: AgentRunStatus): ExitCode {
  return status === 'passed' ? ExitCode.ok : ExitCode.validationError;
}

export function exitCodeForAgentRun(status: AgentRunStatus): ExitCode {
  return statusCodeForRun(status);
}

function sessionIdForRun(explicitSessionId: string | undefined, continuity: JsonObject): string {
  if (explicitSessionId !== undefined) {
    return explicitSessionId;
  }
  const envName = getString(continuity, 'session_id_env');
  if (envName !== undefined) {
    const fromEnvironment = process.env[envName];
    if (fromEnvironment !== undefined && fromEnvironment.length > 0) {
      return fromEnvironment;
    }
  }
  return `session-${randomUUID()}`;
}

function canonicalArtifactPath(root: string, value: string, label: string): string {
  return relativePathFromRoot(root, resolveInsideRoot(root, value, label), label);
}

function canonicalOutputPath(root: string, value: string, label: string): string {
  return relativePathFromRoot(root, resolveInsideRoot(root, value, label), label);
}

function stripFragment(reference: string): string {
  const fragmentIndex = reference.indexOf('#');
  return fragmentIndex === -1 ? reference : reference.slice(0, fragmentIndex);
}

function requiredString(object: JsonObject, key: string): string {
  const value = getString(object, key);
  if (value === undefined) {
    throw new Error(`Expected string field after schema validation: ${key}`);
  }
  return value;
}

function requiredObject(object: JsonObject, key: string): JsonObject {
  const value = getObject(object, key);
  if (value === undefined) {
    throw new Error(`Expected object field after schema validation: ${key}`);
  }
  return value;
}

function requiredNumber(object: JsonObject, key: string): number {
  const value = getNumber(object, key);
  if (value === undefined) {
    throw new Error(`Expected number field after schema validation: ${key}`);
  }
  return value;
}

function getNumber(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBoolean(object: JsonObject, key: string): boolean | undefined {
  const value = object[key];
  return typeof value === 'boolean' ? value : undefined;
}

function optionalArtifact(
  object: JsonObject,
  key: 'oracle' | 'baseline',
): { readonly oracle?: EvalTaskArtifact; readonly baseline?: EvalTaskArtifact } {
  const artifact = getObject(object, key);
  if (artifact === undefined) {
    return {};
  }
  const value = {
    kind: requiredString(artifact, 'kind'),
    artifact: requiredString(artifact, 'artifact'),
  };
  return key === 'oracle' ? { oracle: value } : { baseline: value };
}

function normalizedDeclaredPaths(root: string, values: readonly JsonValue[]): readonly string[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .filter((value) => !isExternalReference(value))
    .map((value) =>
      relativePathFromRoot(root, resolveInsideRoot(root, value, 'Declared path'), 'Declared path'),
    )
    .sort();
}

function declaresPath(declaredPaths: readonly string[], targetPath: string): boolean {
  return declaredPaths.some(
    (declaredPath) =>
      declaredPath === '.' ||
      targetPath === declaredPath ||
      targetPath.startsWith(`${declaredPath}/`),
  );
}

function isExternalReference(reference: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference) || reference.startsWith('#');
}

function stringMap(object: JsonObject | undefined): Record<string, string> {
  if (object === undefined) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

function modelProfileRefForExecution(context: RunnerContext, execution: AgentExecution): string {
  return execution.mode === 'external-import'
    ? `harness://external-import/${encodeURIComponent(execution.externalModelId ?? 'external-candidate')}`
    : context.modelProfilePath;
}

function credentialReferenceForExecution(
  execution: AgentExecution,
  runner: JsonObject,
): JsonObject {
  if (execution.mode !== 'external-import') {
    return requiredObject(runner, 'credential_reference');
  }
  return {
    source: 'external',
    name: execution.externalModelId ?? 'external-candidate',
    purpose: 'Candidate generated outside harness and imported for verification.',
    scope: 'per-run',
  };
}

function usageForExecution(modelProfile: JsonObject, execution: AgentExecution): JsonObject {
  if (execution.mode === 'external-import') {
    return {
      billed_model_id: execution.externalModelId ?? 'external-candidate',
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      requests: 0,
      incurred_cost_usd: 0,
      source: 'external',
    };
  }
  return stubUsage(modelProfile, execution.modelStatus === 'passed' ? 1 : 0);
}

function stubUsage(modelProfile: JsonObject, requests = 1): JsonObject {
  return {
    billed_model_id: requiredString(modelProfile, 'model_id'),
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    requests,
    incurred_cost_usd: 0,
    source: 'stub',
  };
}

function mediaTypeForPath(path: string): string {
  if (path.endsWith('.json')) {
    return 'application/json';
  }
  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    return 'application/yaml';
  }
  if (path.endsWith('.md')) {
    return 'text/markdown';
  }
  return 'text/plain';
}
