import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadDocument, pathKind } from './files.ts';
import { validateHarnessConfiguration } from './harness.ts';
import type { JsonObject, JsonValue } from './json.ts';
import { getArray, getObject, getString, isObject } from './json.ts';
import { relativePathFromRoot, resolveInsideRoot } from './paths.ts';
import { runShellCommand } from './process.ts';
import { formatValidationIssue, type SchemaRegistry } from './schema-registry.ts';

type EvalValidationStatus = 'passed' | 'failed' | 'error';
type EvalCaseKind = 'oracle' | 'broken-twin';
type EvalCaseExpectedStatus = 'passed' | 'failed';
type RunResultStatus = 'passed' | 'failed' | 'error';
type VerifierStatus = 'passed' | 'failed' | 'error' | 'skipped';
type HarnessStatus = 'passed' | 'failed' | 'error';
type FailureCode =
  | 'verification-failure'
  | 'verifier-error'
  | 'harness-error'
  | 'timeout'
  | 'sandbox-violation';

export interface EvalTaskDiscoveryInput {
  readonly root: string;
  readonly harnessPath: string;
  readonly cliVersion: string;
  readonly schemas: SchemaRegistry;
}

export interface EvalTaskDiscoveryResult {
  readonly taskPaths: readonly string[];
  readonly issues: readonly string[];
}

export interface EvalValidationInput {
  readonly root: string;
  readonly taskPaths: readonly string[];
  readonly cliVersion: string;
  readonly schemas: SchemaRegistry;
  readonly runId?: string;
  readonly outputPath?: string;
  readonly verifierOutputDir?: string;
}

export interface EvalValidationRun {
  readonly status: EvalValidationStatus;
  readonly result: JsonObject;
  readonly markdown: string;
  readonly runResults: readonly JsonObject[];
  readonly verifierResults: readonly VerifierResultArtifact[];
}

export interface VerifierResultArtifact {
  readonly path: string;
  readonly result: JsonObject;
}

interface EvalTaskData {
  readonly taskPath: string;
  readonly document: JsonObject;
  readonly suiteId: string;
  readonly taskId: string;
  readonly taskVersion: string;
  readonly datasetHash: string;
  readonly split: string;
  readonly confidence: string;
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

interface EvalCase {
  readonly kind: EvalCaseKind;
  readonly expectedStatus: EvalCaseExpectedStatus;
  readonly candidatePath: string;
}

interface EvaluatedCase {
  readonly summary: JsonObject;
  readonly runResult: JsonObject;
  readonly verifierResult: VerifierResultArtifact;
  readonly expectationMet: boolean;
  readonly runStatus: RunResultStatus;
}

interface VerifierExecutionResult {
  readonly status: RunResultStatus;
  readonly verifierStatus: VerifierStatus;
  readonly harnessStatus: HarnessStatus;
  readonly failureCode?: FailureCode;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly summary: string;
}

const schemaVersion = '0.1.0';
const verifierOnlyModelProfile = 'harness://verifier-only/no-model';
const verifierOnlyTrace = 'harness://verifier-only/no-agent-trace';

export async function discoverEvalTaskPathsFromHarness(
  input: EvalTaskDiscoveryInput,
): Promise<EvalTaskDiscoveryResult> {
  const validation = await validateHarnessConfiguration(input);
  const issues = [
    ...validation.schemaIssues.map((issue) => `schema: ${issue}`),
    ...validation.compatibilityIssues.map((issue) => `engines: ${issue}`),
    ...validation.referenceIssues.map((issue) => `reference: ${issue}`),
  ];
  if (issues.length > 0 || validation.document === undefined) {
    return { taskPaths: [], issues };
  }

  const taskPaths: string[] = [];
  const evals = getObject(validation.document, 'evals');
  const suites = evals === undefined ? undefined : getArray(evals, 'suites');
  if (suites === undefined) {
    return { taskPaths, issues: ['harness evals.suites is missing.'] };
  }

  for (const suite of suites) {
    if (!isObject(suite)) {
      continue;
    }
    const tasksRef = getString(suite, 'tasks');
    if (tasksRef === undefined) {
      continue;
    }
    const absoluteTasksPath = resolveInsideRoot(input.root, tasksRef, 'Eval task suite');
    const kind = await pathKind(absoluteTasksPath);
    if (kind === undefined) {
      issues.push(`eval task suite not found: ${tasksRef}`);
      continue;
    }
    if (kind === 'file') {
      taskPaths.push(relativePathFromRoot(input.root, absoluteTasksPath, 'Eval task'));
      continue;
    }

    const entries = await readdir(absoluteTasksPath, { withFileTypes: true });
    const suiteTaskPaths = entries
      .filter((entry) => entry.isFile() && /\.(?:json|ya?ml)$/.test(entry.name))
      .map((entry) =>
        relativePathFromRoot(input.root, join(absoluteTasksPath, entry.name), 'Eval task'),
      )
      .sort();
    if (suiteTaskPaths.length === 0) {
      issues.push(`eval task suite has no YAML or JSON task files: ${tasksRef}`);
      continue;
    }
    taskPaths.push(...suiteTaskPaths);
  }

  return { taskPaths: [...new Set(taskPaths)].sort(), issues };
}

export async function runEvalValidation(input: EvalValidationInput): Promise<EvalValidationRun> {
  const taskSummaries: JsonObject[] = [];
  const runResults: JsonObject[] = [];
  const verifierResults: VerifierResultArtifact[] = [];

  for (const taskPath of input.taskPaths) {
    const taskRun = await evaluateTask(input, taskPath);
    taskSummaries.push(taskRun.summary);
    runResults.push(...taskRun.runResults);
    verifierResults.push(...taskRun.verifierResults);
  }

  const status = statusForTaskSummaries(taskSummaries);
  const result: JsonObject = {
    schema_version: schemaVersion,
    run_id: validationRunId(input.runId, input.taskPaths),
    status,
    tasks: taskSummaries,
    run_results: runResults,
    verifier_results: verifierResults.map((artifact) => ({
      path: artifact.path,
      result: artifact.result,
    })),
  };

  return {
    status,
    result,
    markdown: renderEvalValidationMarkdown(result),
    runResults,
    verifierResults,
  };
}

export async function computeEvalTaskDatasetHash(root: string, task: JsonObject): Promise<string> {
  const references = datasetReferences(task);
  const hashedReferences: JsonObject[] = [];
  for (const reference of references) {
    const absolutePath = resolveInsideRoot(root, reference.path, `${reference.role} artifact`);
    const kind = await pathKind(absolutePath);
    if (kind !== 'file') {
      throw new Error(
        `${reference.role} artifact must be a file for dataset hashing: ${reference.path}`,
      );
    }
    const digest = createHash('sha256')
      .update(await readFile(absolutePath))
      .digest('hex');
    hashedReferences.push({
      role: reference.role,
      path: relativePathFromRoot(root, absolutePath, `${reference.role} artifact`),
      sha256: digest,
    });
  }

  const payload: JsonObject = {
    references: hashedReferences.sort(compareRoleAndPath),
  };
  return `sha256:${createHash('sha256').update(stableJson(payload)).digest('hex')}`;
}

async function evaluateTask(
  input: EvalValidationInput,
  taskPath: string,
): Promise<{
  readonly summary: JsonObject;
  readonly runResults: readonly JsonObject[];
  readonly verifierResults: readonly VerifierResultArtifact[];
}> {
  const absoluteTaskPath = resolveInsideRoot(input.root, taskPath, 'Eval task');
  const document = await loadDocument(absoluteTaskPath);
  const schemaIssues = input.schemas.validate('eval-task', document).map(formatValidationIssue);
  if (schemaIssues.length > 0 || !isObject(document)) {
    return {
      summary: taskSummary({
        taskPath,
        status: 'failed',
        issues: schemaIssues.length > 0 ? schemaIssues : ['Eval task must be a JSON object.'],
      }),
      runResults: [],
      verifierResults: [],
    };
  }

  const task = taskData(taskPath, document);
  const unsupportedBaselineIssue = unsupportedBaselineKindIssue(task);
  if (unsupportedBaselineIssue !== undefined) {
    return {
      summary: taskSummary({
        taskPath,
        task,
        status: 'failed',
        issues: [unsupportedBaselineIssue],
      }),
      runResults: [],
      verifierResults: [],
    };
  }

  const computedDatasetHash = await tryComputeDatasetHash(input.root, document);
  if (computedDatasetHash.ok === false) {
    return {
      summary: taskSummary({
        taskPath,
        task,
        status: 'failed',
        issues: [computedDatasetHash.issue],
      }),
      runResults: [],
      verifierResults: [],
    };
  }

  if (computedDatasetHash.value !== task.datasetHash) {
    return {
      summary: taskSummary({
        taskPath,
        task,
        status: 'failed',
        issues: [
          `dataset_hash mismatch: declared ${task.datasetHash}, computed ${computedDatasetHash.value}`,
        ],
      }),
      runResults: [],
      verifierResults: [],
    };
  }

  const cases = evalCases(input.root, task);
  if (cases.length === 0) {
    return {
      summary: taskSummary({
        taskPath,
        task,
        status: 'failed',
        issues: ['Eval task has no oracle or baseline candidate to validate.'],
      }),
      runResults: [],
      verifierResults: [],
    };
  }

  const evaluatedCases: EvaluatedCase[] = [];
  for (const evalCase of cases) {
    evaluatedCases.push(await evaluateCase(input, task, evalCase));
  }

  const status = statusForEvaluatedCases(evaluatedCases);
  return {
    summary: taskSummary({
      taskPath,
      task,
      status,
      cases: evaluatedCases.map((evaluatedCase) => evaluatedCase.summary),
    }),
    runResults: evaluatedCases.map((evaluatedCase) => evaluatedCase.runResult),
    verifierResults: evaluatedCases.map((evaluatedCase) => evaluatedCase.verifierResult),
  };
}

async function tryComputeDatasetHash(
  root: string,
  document: JsonObject,
): Promise<
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly issue: string }
> {
  try {
    return {
      ok: true,
      value: await computeEvalTaskDatasetHash(root, document),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issue: `dataset_hash could not be computed: ${message}`,
    };
  }
}

async function evaluateCase(
  input: EvalValidationInput,
  task: EvalTaskData,
  evalCase: EvalCase,
): Promise<EvaluatedCase> {
  const runId = runIdForCase(input.runId, task, evalCase);
  const verifierResultPath =
    input.verifierOutputDir === undefined
      ? `harness://verifier-only/verifier-results/${runId}.json`
      : `${input.verifierOutputDir}/${runId}.json`;
  const execution = await executeVerifier(input, task, evalCase);
  const runResult = runResultForCase({
    input,
    task,
    evalCase,
    runId,
    verifierResultPath,
    execution,
  });
  const verifierResult = verifierResultForCase({
    task,
    evalCase,
    runId,
    verifierResultPath,
    execution,
  });
  const expectationMet =
    evalCase.expectedStatus === 'passed'
      ? execution.status === 'passed'
      : execution.status === 'failed' && execution.failureCode === 'verification-failure';
  return {
    summary: {
      case: evalCase.kind,
      expected_status: evalCase.expectedStatus,
      actual_status: execution.status,
      expectation_met: expectationMet,
      run_id: runId,
      verifier_result: verifierResultPath,
    },
    runResult,
    verifierResult,
    expectationMet,
    runStatus: execution.status,
  };
}

async function executeVerifier(
  input: EvalValidationInput,
  task: EvalTaskData,
  evalCase: EvalCase,
): Promise<VerifierExecutionResult> {
  const trustIssue = validateVerifierExecutionTrust(input, task, evalCase);
  if (trustIssue !== undefined) {
    return {
      status: 'error',
      verifierStatus: 'skipped',
      harnessStatus: 'failed',
      failureCode: 'sandbox-violation',
      timedOut: false,
      durationMs: 0,
      stdout: '',
      stderr: '',
      summary: trustIssue,
    };
  }

  const command = requiredObject(task.verifier, 'command');
  const commandText = requiredString(command, 'command');
  const commandTimeout = getNumber(command, 'timeout_seconds') ?? task.timeoutSeconds;
  const workingDirectory = getString(command, 'working_directory');
  const cwd =
    workingDirectory === undefined
      ? input.root
      : resolveInsideRoot(input.root, workingDirectory, 'Verifier working directory');
  const timeoutSeconds = Math.min(commandTimeout, task.timeoutSeconds);
  const startedAt = Date.now();
  const result = await runShellCommand({
    command: commandText,
    cwd,
    timeoutSeconds,
    processLabel: 'Verifier process',
    environment: {
      ...stringMap(getObject(command, 'environment')),
      HARNESS_EVAL_CASE: evalCase.kind,
      HARNESS_EVAL_EXPECTED_STATUS: evalCase.expectedStatus,
      HARNESS_EVAL_CANDIDATE: evalCase.candidatePath,
      HARNESS_EVAL_TASK: task.taskPath,
      HARNESS_EVAL_SUITE_ID: task.suiteId,
      HARNESS_EVAL_TASK_ID: task.taskId,
      HARNESS_EVAL_TASK_VERSION: task.taskVersion,
      HARNESS_EVAL_DATASET_HASH: task.datasetHash,
      HARNESS_EVAL_SPLIT: task.split,
    },
  });
  const durationMs = Date.now() - startedAt;

  if (result.timedOut) {
    return {
      status: 'error',
      verifierStatus: 'error',
      harnessStatus: 'passed',
      failureCode: 'timeout',
      ...(result.signal === undefined ? {} : { signal: result.signal }),
      timedOut: true,
      durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: `Verifier timed out after ${timeoutSeconds} second(s).`,
    };
  }

  if (result.error !== undefined) {
    return {
      status: 'error',
      verifierStatus: 'error',
      harnessStatus: 'passed',
      failureCode: 'verifier-error',
      ...(result.signal === undefined ? {} : { signal: result.signal }),
      timedOut: false,
      durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: result.error,
    };
  }

  if (result.exitCode === 0) {
    return {
      status: 'passed',
      verifierStatus: 'passed',
      harnessStatus: 'passed',
      exitCode: result.exitCode,
      timedOut: false,
      durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: 'Verifier command exited 0.',
    };
  }

  if (result.exitCode === 126 || result.exitCode === 127) {
    return {
      status: 'error',
      verifierStatus: 'error',
      harnessStatus: 'passed',
      failureCode: 'verifier-error',
      exitCode: result.exitCode,
      ...(result.signal === undefined ? {} : { signal: result.signal }),
      timedOut: false,
      durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: `Verifier command exited ${result.exitCode}, indicating the verifier command could not execute.`,
    };
  }

  return {
    status: 'failed',
    verifierStatus: 'failed',
    harnessStatus: 'passed',
    failureCode: 'verification-failure',
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    ...(result.signal === undefined ? {} : { signal: result.signal }),
    timedOut: false,
    durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: `Verifier command exited ${result.exitCode ?? `with signal ${result.signal ?? 'unknown'}`}.`,
  };
}

function validateVerifierExecutionTrust(
  input: EvalValidationInput,
  task: EvalTaskData,
  evalCase: EvalCase,
): string | undefined {
  const kind = requiredString(task.verifier, 'kind');
  if (kind !== 'command') {
    return `eval validate only executes command verifiers, not ${kind} verifiers.`;
  }
  const trust = requiredObject(task.verifier, 'trust_requirements');
  const trustLevel = requiredString(trust, 'trust_level');
  if (trustLevel !== 'sandboxed') {
    return `eval validate requires sandboxed verifier trust, got ${trustLevel}.`;
  }
  const sandboxRequired = requiredString(trust, 'sandbox_required');
  if (sandboxRequired !== 'process') {
    return `eval validate can only satisfy process sandbox declarations, got ${sandboxRequired}.`;
  }
  if (
    getBoolean(trust, 'network_access') !== false ||
    getBoolean(trust, 'secret_access') !== false ||
    getBoolean(trust, 'host_file_access') !== false
  ) {
    return 'eval validate refuses verifiers with network, secret, or host-file access.';
  }

  const allowedInputs = normalizedDeclaredPaths(
    input.root,
    getArray(trust, 'allowed_inputs') ?? [],
  );
  if (!declaresPath(allowedInputs, evalCase.candidatePath)) {
    return `Verifier allowed_inputs does not include candidate artifact: ${evalCase.candidatePath}`;
  }
  const allowedOutputs = normalizedDeclaredPaths(
    input.root,
    getArray(trust, 'allowed_outputs') ?? [],
  );
  // Eval validation declaration-gates verifier outputs; it does not enforce child-process writes.
  if (input.outputPath !== undefined && !declaresPath(allowedOutputs, input.outputPath)) {
    return `Verifier allowed_outputs does not include run-result output: ${input.outputPath}`;
  }
  if (
    input.verifierOutputDir !== undefined &&
    !declaresPath(allowedOutputs, input.verifierOutputDir)
  ) {
    return `Verifier allowed_outputs does not include verifier-result output dir: ${input.verifierOutputDir}`;
  }

  return undefined;
}

function runResultForCase(input: {
  readonly input: EvalValidationInput;
  readonly task: EvalTaskData;
  readonly evalCase: EvalCase;
  readonly runId: string;
  readonly verifierResultPath: string;
  readonly execution: VerifierExecutionResult;
}): JsonObject {
  return {
    schema_version: schemaVersion,
    run_id: input.runId,
    kind: 'eval',
    suite_id: input.task.suiteId,
    task_id: input.task.taskId,
    task_version: input.task.taskVersion,
    dataset_hash: input.task.datasetHash,
    split: input.task.split,
    model_profile: verifierOnlyModelProfile,
    harness_version: input.input.cliVersion,
    status: input.execution.status,
    ...(input.execution.failureCode === undefined
      ? {}
      : { failure_code: input.execution.failureCode }),
    trace: verifierOnlyTrace,
    verifier_result: input.verifierResultPath,
    execution: {
      mode: 'verifier-only',
      harness_status: input.execution.harnessStatus,
      verifier_status: input.execution.verifierStatus,
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
    artifacts: [
      {
        path: input.task.taskPath,
        media_type: mediaTypeForPath(input.task.taskPath),
        description: 'Eval task under validation.',
      },
      {
        path: input.evalCase.candidatePath,
        media_type: mediaTypeForPath(input.evalCase.candidatePath),
        description: `${input.evalCase.kind} candidate artifact.`,
      },
      {
        path: input.task.environment,
        media_type: mediaTypeForPath(input.task.environment),
        description: 'Eval task environment declaration.',
      },
    ],
  };
}

function verifierResultForCase(input: {
  readonly task: EvalTaskData;
  readonly evalCase: EvalCase;
  readonly runId: string;
  readonly verifierResultPath: string;
  readonly execution: VerifierExecutionResult;
}): VerifierResultArtifact {
  return {
    path: input.verifierResultPath,
    result: {
      schema_version: schemaVersion,
      verifier_id: input.task.taskId,
      run_id: input.runId,
      case: input.evalCase.kind,
      expected_status: input.evalCase.expectedStatus,
      candidate: input.evalCase.candidatePath,
      status: input.execution.verifierStatus,
      harness_status: input.execution.harnessStatus,
      summary: input.execution.summary,
      timed_out: input.execution.timedOut,
      ...(input.execution.exitCode === undefined ? {} : { exit_code: input.execution.exitCode }),
      ...(input.execution.signal === undefined ? {} : { signal: input.execution.signal }),
    },
  };
}

function taskData(taskPath: string, document: JsonObject): EvalTaskData {
  return {
    taskPath,
    document,
    suiteId: requiredString(document, 'suite_id'),
    taskId: requiredString(document, 'task_id'),
    taskVersion: requiredString(document, 'task_version'),
    datasetHash: requiredString(document, 'dataset_hash'),
    split: requiredString(document, 'split'),
    confidence: requiredString(document, 'confidence'),
    instruction: requiredString(document, 'instruction'),
    environment: requiredString(document, 'environment'),
    timeoutSeconds: requiredNumber(document, 'timeout_seconds'),
    verifier: requiredObject(document, 'verifier'),
    ...optionalArtifact(document, 'oracle'),
    ...optionalArtifact(document, 'baseline'),
  };
}

function evalCases(root: string, task: EvalTaskData): readonly EvalCase[] {
  const cases: EvalCase[] = [];
  if (task.oracle !== undefined) {
    cases.push({
      kind: 'oracle',
      expectedStatus: 'passed',
      candidatePath: canonicalArtifactPath(root, task.oracle.artifact, 'Oracle artifact'),
    });
  }
  if (task.baseline !== undefined) {
    cases.push({
      kind: 'broken-twin',
      expectedStatus: 'failed',
      candidatePath: canonicalArtifactPath(root, task.baseline.artifact, 'Baseline artifact'),
    });
  }
  return cases;
}

function unsupportedBaselineKindIssue(task: EvalTaskData): string | undefined {
  if (task.baseline === undefined || task.baseline.kind === 'expected-failure') {
    return undefined;
  }
  return `eval validate only supports baseline.kind expected-failure, got ${task.baseline.kind}.`;
}

function taskSummary(input: {
  readonly taskPath: string;
  readonly status: EvalValidationStatus;
  readonly task?: EvalTaskData;
  readonly cases?: readonly JsonObject[];
  readonly issues?: readonly string[];
}): JsonObject {
  return {
    task: input.taskPath,
    status: input.status,
    ...(input.task === undefined
      ? {}
      : {
          suite_id: input.task.suiteId,
          task_id: input.task.taskId,
          task_version: input.task.taskVersion,
          dataset_hash: input.task.datasetHash,
          split: input.task.split,
        }),
    cases: [...(input.cases ?? [])],
    issues: [...(input.issues ?? [])],
  };
}

function statusForEvaluatedCases(cases: readonly EvaluatedCase[]): EvalValidationStatus {
  if (cases.some((evalCase) => evalCase.runStatus === 'error')) {
    return 'error';
  }
  return cases.every((evalCase) => evalCase.expectationMet) ? 'passed' : 'failed';
}

function statusForTaskSummaries(summaries: readonly JsonObject[]): EvalValidationStatus {
  if (summaries.some((summary) => getString(summary, 'status') === 'error')) {
    return 'error';
  }
  return summaries.every((summary) => getString(summary, 'status') === 'passed')
    ? 'passed'
    : 'failed';
}

function validationRunId(runId: string | undefined, taskPaths: readonly string[]): string {
  if (runId !== undefined) {
    return runId;
  }
  const digest = createHash('sha256').update(taskPaths.join('\n')).digest('hex').slice(0, 12);
  return `eval-validate-${digest}`;
}

function runIdForCase(runId: string | undefined, task: EvalTaskData, evalCase: EvalCase): string {
  const digest = createHash('sha256')
    .update(
      [
        task.taskPath,
        task.taskVersion,
        task.datasetHash,
        task.split,
        evalCase.kind,
        evalCase.candidatePath,
      ].join('\n'),
    )
    .digest('hex')
    .slice(0, 12);
  if (runId !== undefined) {
    return `${runId}-${evalCase.kind}-${digest}`;
  }
  return `eval-${task.taskId}-${evalCase.kind}-${digest}`;
}

function renderEvalValidationMarkdown(result: JsonObject): string {
  const lines = ['# Harness eval validation', ''];
  lines.push(`- run_id: ${getString(result, 'run_id') ?? 'unknown'}`);
  lines.push(`- status: ${getString(result, 'status') ?? 'unknown'}`);
  lines.push('');
  lines.push('| Task | Split | Status | Cases | Issues |');
  lines.push('|---|---|---|---:|---:|');
  const tasks = getArray(result, 'tasks') ?? [];
  for (const task of tasks) {
    if (!isObject(task)) {
      continue;
    }
    const cases = getArray(task, 'cases') ?? [];
    const issues = getArray(task, 'issues') ?? [];
    lines.push(
      `| ${escapeMarkdownCell(getString(task, 'task') ?? 'unknown')} | ${escapeMarkdownCell(getString(task, 'split') ?? '')} | ${escapeMarkdownCell(getString(task, 'status') ?? 'unknown')} | ${cases.length} | ${issues.length} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function datasetReferences(
  task: JsonObject,
): readonly { readonly role: string; readonly path: string }[] {
  const references: Array<{ role: string; path: string }> = [
    { role: 'environment', path: requiredString(task, 'environment') },
  ];
  const oracle = getObject(task, 'oracle');
  if (oracle !== undefined) {
    references.push({ role: 'oracle', path: requiredString(oracle, 'artifact') });
  }
  const baseline = getObject(task, 'baseline');
  if (baseline !== undefined) {
    references.push({ role: 'baseline', path: requiredString(baseline, 'artifact') });
  }
  const artifacts = getArray(task, 'artifacts') ?? [];
  for (const artifact of artifacts) {
    if (isObject(artifact)) {
      references.push({ role: 'artifact', path: requiredString(artifact, 'path') });
    }
  }
  return references.sort((left, right) =>
    `${left.role}:${left.path}`.localeCompare(`${right.role}:${right.path}`),
  );
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

function normalizedDeclaredPaths(root: string, values: readonly JsonValue[]): readonly string[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .filter((value) => !isExternalReference(value))
    .map((value) =>
      relativePathFromRoot(root, resolveInsideRoot(root, value, 'Declared path'), 'Declared path'),
    )
    .sort();
}

function canonicalArtifactPath(root: string, value: string, label: string): string {
  return relativePathFromRoot(root, resolveInsideRoot(root, value, label), label);
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

function compareRoleAndPath(left: JsonObject, right: JsonObject): number {
  const leftKey = `${getString(left, 'role') ?? ''}:${getString(left, 'path') ?? ''}`;
  const rightKey = `${getString(right, 'role') ?? ''}:${getString(right, 'path') ?? ''}`;
  return leftKey.localeCompare(rightKey);
}

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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

function escapeMarkdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br>');
}
