import { createHash } from 'node:crypto';

import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';
import { assertNoSymlinkWithinRoot, loadDocument, pathKind } from './files.ts';
import { validateHarnessConfiguration } from './harness.ts';
import {
  getArray,
  getObject,
  getString,
  isObject,
  type JsonObject,
  type JsonValue,
} from './json.ts';
import { relativePathFromRoot, resolveInsideRoot } from './paths.ts';
import { runShellCommand } from './process.ts';
import { formatValidationIssue, type ISchemaRegistry } from './schema-registry.ts';

type HealthStatus = 'passed' | 'failed' | 'error';
type HealthCheckStatus = 'passed' | 'failed' | 'error' | 'skipped';
export type HealthExitClass = 'passed' | 'failed' | 'refused';

interface IHealthCheckDeclaration {
  readonly id: string;
  readonly command: JsonObject;
  readonly trustRequirements: JsonObject;
  readonly artifacts: readonly JsonObject[];
}

interface IHealthCheckRun {
  readonly id: string;
  readonly command: JsonObject;
  readonly timeoutSeconds: number;
  readonly status: HealthCheckStatus;
  readonly failureCode?: string;
  readonly durationMs: number;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly summary: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly evidence: readonly JsonObject[];
  readonly artifacts: readonly JsonObject[];
  readonly trustRequirements: JsonObject;
}

export interface IHealthRunInput {
  readonly root: string;
  readonly harnessPath: string;
  readonly cliVersion: string;
  readonly schemas: ISchemaRegistry;
  readonly runId?: string;
  readonly generatedAt?: string;
  readonly allowDeclarativeExecution?: boolean;
  readonly outputPath?: string;
}

export interface IHealthRun {
  readonly result: JsonObject;
  readonly markdown: string;
  readonly status: HealthStatus;
  readonly exitClass: HealthExitClass;
}

const schemaVersion = '0.2.0';
const defaultTimeoutSeconds = 60;

export async function runHealth(input: IHealthRunInput): Promise<IHealthRun> {
  const validation = await validateHarnessConfiguration(input);
  const validationIssues = [
    ...validation.schemaIssues.map((issue) => `schema: ${issue}`),
    ...validation.compatibilityIssues.map((issue) => `engines: ${issue}`),
    ...validation.referenceIssues.map((issue) => `reference: ${issue}`),
  ];
  if (validationIssues.length > 0 || validation.document === undefined) {
    throw new CliError(
      `health requires a valid harness before executing local checks: ${validationIssues.join('; ')}`,
      ExitCode.validationError,
    );
  }

  const harness = validation.document;
  const health = getObject(harness, 'health');
  if (health === undefined) {
    throw new CliError('harness health requires a health.checks block.', ExitCode.validationError);
  }
  if (input.allowDeclarativeExecution !== true) {
    throw new CliError(
      'harness health uses unsandboxed declarative process execution; pass --accept-unsandboxed-execution after reviewing the configured commands.',
      ExitCode.usageError,
    );
  }
  const outputDir = requiredString(health, 'output_dir', 'health.output_dir');
  if (input.outputPath !== undefined) {
    assertHealthOutputPathInsideDir(input.root, outputDir, input.outputPath);
  }

  const approvalPolicyPath = requiredString(harness, 'approval_policy', 'approval_policy');
  const sandboxPolicyPath = requiredString(harness, 'sandbox', 'sandbox');
  await loadValidatedPolicy(input, approvalPolicyPath, 'approval policy', 'approval-policy');
  const sandboxPolicy = await loadValidatedPolicy(
    input,
    sandboxPolicyPath,
    'sandbox policy',
    'sandbox-policy',
  );
  const declarations = healthCheckDeclarations(health);
  const checks: IHealthCheckRun[] = [];
  for (const declaration of declarations) {
    checks.push(await runHealthCheck(input.root, outputDir, sandboxPolicy, declaration));
  }
  const status = healthStatusForChecks(checks);
  const issues = healthIssues(checks);
  const result: JsonObject = {
    ['schema_version']: schemaVersion,
    ['run_id']: input.runId ?? defaultRunId(input.harnessPath, input.cliVersion, checks),
    ['harness_version']: input.cliVersion,
    ['generated_at']: input.generatedAt ?? new Date().toISOString(),
    status,
    ...(issues.length === 0 ? {} : { issues }),
    ['sandbox_enforcement']: 'declarative',
    ['runtime_enforced']: false,
    source: {
      harness: input.harnessPath,
      ['approval_policy']: approvalPolicyPath,
      ['sandbox_policy']: sandboxPolicyPath,
    },
    checks: checks.map(healthCheckJson),
  };
  return {
    result,
    markdown: renderHealthMarkdown(result),
    status,
    exitClass: healthExitClassForChecks(checks),
  };
}

export function serializeHealthJson(result: JsonObject): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function assertHealthOutputPathInsideDir(
  root: string,
  outputDir: string,
  outputPath: string,
): void {
  const canonicalOutputDir = relativePathFromRoot(
    root,
    resolveInsideRoot(root, outputDir, 'health.output_dir'),
    'health.output_dir',
  );
  const canonicalOutputPath = relativePathFromRoot(
    root,
    resolveInsideRoot(root, outputPath, 'health output'),
    'health output',
  );
  if (
    canonicalOutputPath !== canonicalOutputDir &&
    !canonicalOutputPath.startsWith(`${canonicalOutputDir}/`)
  ) {
    throw new CliError(
      `health --output must be inside health.output_dir ${outputDir}: ${outputPath}`,
      ExitCode.usageError,
    );
  }
}

function healthCheckDeclarations(health: JsonObject): readonly IHealthCheckDeclaration[] {
  return (getArray(health, 'checks') ?? []).filter(isObject).map((check) => ({
    id: requiredString(check, 'id', 'health check id'),
    command: requiredObject(check, 'command', 'health check command'),
    trustRequirements: requiredObject(
      check,
      'trust_requirements',
      'health check trust_requirements',
    ),
    artifacts: (getArray(check, 'artifacts') ?? []).filter(isObject),
  }));
}

async function runHealthCheck(
  root: string,
  outputDir: string,
  sandboxPolicy: JsonObject,
  declaration: IHealthCheckDeclaration,
): Promise<IHealthCheckRun> {
  const timeoutSeconds =
    numberValue(declaration.command, 'timeout_seconds') ?? defaultTimeoutSeconds;
  const trustIssue = validateHealthCheckTrust(root, outputDir, sandboxPolicy, declaration);
  const artifacts = declaredArtifacts(declaration.artifacts);
  const artifactIssue =
    trustIssue === undefined ? await validateHealthArtifacts(root, artifacts) : undefined;
  if (trustIssue !== undefined || artifactIssue !== undefined) {
    const issue = trustIssue ?? artifactIssue;
    return {
      id: declaration.id,
      command: declaration.command,
      timeoutSeconds,
      status: 'skipped',
      failureCode: issue?.failureCode ?? 'trust-requirements-unsafe',
      durationMs: 0,
      summary: issue?.message ?? 'Health check was refused.',
      stdoutTruncated: false,
      stderrTruncated: false,
      evidence: issue?.evidence ?? [],
      artifacts,
      trustRequirements: declaration.trustRequirements,
    };
  }

  const commandText = requiredString(declaration.command, 'command', 'health check command');
  const workingDirectory = getString(declaration.command, 'working_directory');
  const cwd =
    workingDirectory === undefined
      ? root
      : resolveInsideRoot(root, workingDirectory, 'Health check working directory');
  await assertNoSymlinkWithinRoot(root, cwd, 'execute');
  if ((await pathKind(cwd)) !== 'directory') {
    return {
      id: declaration.id,
      command: declaration.command,
      timeoutSeconds,
      status: 'skipped',
      failureCode: 'missing-artifact',
      durationMs: 0,
      summary: `Health check working directory not found: ${workingDirectory}`,
      stdoutTruncated: false,
      stderrTruncated: false,
      evidence: [],
      artifacts,
      trustRequirements: declaration.trustRequirements,
    };
  }

  const startedAt = Date.now();
  const result = await runShellCommand({
    command: commandText,
    cwd,
    timeoutSeconds,
    processLabel: `Health check ${declaration.id}`,
    environment: stringMap(getObject(declaration.command, 'environment')),
  });
  const durationMs = Date.now() - startedAt;
  if (result.timedOut) {
    return {
      id: declaration.id,
      command: declaration.command,
      timeoutSeconds,
      status: 'error',
      failureCode: 'timeout',
      durationMs,
      ...(result.signal === undefined ? {} : { signal: result.signal }),
      summary: `Health check timed out after ${timeoutSeconds} second(s).`,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      evidence: [],
      artifacts,
      trustRequirements: declaration.trustRequirements,
    };
  }
  if (result.error !== undefined) {
    return {
      id: declaration.id,
      command: declaration.command,
      timeoutSeconds,
      status: 'error',
      failureCode: 'command-error',
      durationMs,
      ...(result.signal === undefined ? {} : { signal: result.signal }),
      summary: result.error,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      evidence: [],
      artifacts,
      trustRequirements: declaration.trustRequirements,
    };
  }
  if (result.exitCode === 0) {
    return {
      id: declaration.id,
      command: declaration.command,
      timeoutSeconds,
      status: 'passed',
      durationMs,
      exitCode: 0,
      summary: 'Health check command exited 0.',
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      evidence: [],
      artifacts,
      trustRequirements: declaration.trustRequirements,
    };
  }
  return {
    id: declaration.id,
    command: declaration.command,
    timeoutSeconds,
    status: 'failed',
    failureCode: 'command-failed',
    durationMs,
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    ...(result.signal === undefined ? {} : { signal: result.signal }),
    summary: `Health check command exited ${result.exitCode ?? `with signal ${result.signal ?? 'unknown'}`}.`,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    evidence: [],
    artifacts,
    trustRequirements: declaration.trustRequirements,
  };
}

function validateHealthCheckTrust(
  root: string,
  outputDir: string,
  sandboxPolicy: JsonObject,
  declaration: IHealthCheckDeclaration,
):
  | {
      readonly failureCode: string;
      readonly message: string;
      readonly evidence: readonly JsonObject[];
    }
  | undefined {
  const trust = declaration.trustRequirements;
  const trustLevel = requiredString(trust, 'trust_level', 'health trust_level');
  if (trustLevel !== 'sandboxed') {
    return {
      failureCode: 'trust-requirements-unsafe',
      message: `health checks require sandboxed trust, got ${trustLevel}.`,
      evidence: [],
    };
  }
  const sandboxRequired = requiredString(trust, 'sandbox_required', 'health sandbox_required');
  if (sandboxRequired !== 'process') {
    return {
      failureCode: 'trust-requirements-unsafe',
      message: `health checks can only satisfy process sandbox declarations, got ${sandboxRequired}.`,
      evidence: [],
    };
  }
  if (booleanValue(trust, 'network_access') !== false) {
    return {
      failureCode: 'trust-requirements-unsafe',
      message:
        'health checks refuse network access because declarative process execution cannot enforce network policy.',
      evidence: [],
    };
  }
  if (booleanValue(trust, 'secret_access') !== false) {
    return {
      failureCode: 'trust-requirements-unsafe',
      message:
        'health checks refuse secret access because declarative process execution cannot enforce secret isolation.',
      evidence: [],
    };
  }
  const processPolicy = getObject(sandboxPolicy, 'process') ?? {};
  if (booleanValue(processPolicy, 'allow_spawn') !== true) {
    return {
      failureCode: 'policy-mismatch-process',
      message: 'health checks require process spawning but sandbox policy denies process spawning.',
      evidence: [],
    };
  }
  if (booleanValue(trust, 'host_file_access') !== false) {
    return {
      failureCode: 'trust-requirements-unsafe',
      message: 'health checks currently refuse host-file access.',
      evidence: [],
    };
  }
  const allowedOutputs = normalizedDeclaredPaths(root, getArray(trust, 'allowed_outputs') ?? []);
  if (!declaresPath(allowedOutputs, outputDir)) {
    return {
      failureCode: 'trust-requirements-unsafe',
      message: `Health check allowed_outputs does not include health output dir: ${outputDir}`,
      evidence: [],
    };
  }
  const allowedInputs = normalizedDeclaredPaths(root, getArray(trust, 'allowed_inputs') ?? []);
  for (const artifactRef of declaration.artifacts) {
    const artifactPath = getString(artifactRef, 'path');
    if (
      artifactPath !== undefined &&
      !isReferenceOnlyPath(artifactPath) &&
      !declaresPath(allowedInputs, artifactPath)
    ) {
      return {
        failureCode: 'trust-requirements-unsafe',
        message: `Health check allowed_inputs does not include declared artifact: ${artifactPath}`,
        evidence: [],
      };
    }
  }
  return undefined;
}

async function validateHealthArtifacts(
  root: string,
  artifacts: readonly JsonObject[],
): Promise<
  | {
      readonly failureCode: string;
      readonly message: string;
      readonly evidence: readonly JsonObject[];
    }
  | undefined
> {
  for (const artifactRef of artifacts) {
    const artifactPath = getString(artifactRef, 'path');
    if (artifactPath === undefined || isReferenceOnlyPath(artifactPath)) {
      continue;
    }
    const absolutePath = resolveInsideRoot(
      root,
      artifactPath.split('#', 1)[0] ?? artifactPath,
      'Health artifact',
    );
    await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
    if ((await pathKind(absolutePath)) === undefined) {
      return {
        failureCode: 'missing-artifact',
        message: `Health check artifact not found: ${artifactPath}`,
        evidence: [artifactRef],
      };
    }
  }
  return undefined;
}

function isReferenceOnlyPath(path: string): boolean {
  return path.startsWith('#') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path);
}

async function loadValidatedPolicy(
  input: IHealthRunInput,
  path: string,
  label: string,
  schemaName: string,
): Promise<JsonObject> {
  const absolutePath = resolveInsideRoot(input.root, path, label);
  await assertNoSymlinkWithinRoot(input.root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    throw new CliError(`${label} not found: ${path}`, ExitCode.notFound);
  }
  const document = await loadDocument(absolutePath);
  if (!isObject(document)) {
    throw new CliError(`${label} must contain a JSON object.`, ExitCode.validationError);
  }
  const issues = input.schemas.validate(schemaName, document).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(`${label} is invalid: ${issues.join('; ')}`, ExitCode.validationError);
  }
  return document;
}

function healthStatusForChecks(checks: readonly IHealthCheckRun[]): HealthStatus {
  if (checks.some((check) => check.status === 'error' || check.status === 'skipped')) {
    return 'error';
  }
  if (checks.some((check) => check.status === 'failed')) {
    return 'failed';
  }
  return 'passed';
}

function healthExitClassForChecks(checks: readonly IHealthCheckRun[]): HealthExitClass {
  if (checks.some((check) => check.status === 'failed')) {
    return 'failed';
  }
  if (
    checks.some(
      (check) =>
        check.status === 'error' &&
        (check.failureCode === 'timeout' || check.failureCode === 'command-error'),
    )
  ) {
    return 'failed';
  }
  if (checks.some((check) => check.status === 'error' || check.status === 'skipped')) {
    return 'refused';
  }
  return 'passed';
}

function healthCheckJson(check: IHealthCheckRun): JsonObject {
  return {
    id: check.id,
    command: check.command,
    ['timeout_seconds']: check.timeoutSeconds,
    status: check.status,
    ['sandbox_enforcement']: 'declarative',
    ['runtime_enforced']: false,
    ...(check.failureCode === undefined ? {} : { ['failure_code']: check.failureCode }),
    ['duration_ms']: check.durationMs,
    ...(check.exitCode === undefined ? {} : { ['exit_code']: check.exitCode }),
    ...(check.signal === undefined ? {} : { signal: check.signal }),
    summary: check.summary,
    ...(check.stdout === undefined ? {} : { stdout: check.stdout }),
    ['stdout_truncated']: check.stdoutTruncated,
    ...(check.stderr === undefined ? {} : { stderr: check.stderr }),
    ['stderr_truncated']: check.stderrTruncated,
    evidence: [...check.evidence],
    artifacts: [...check.artifacts],
    ['trust_requirements']: check.trustRequirements,
  };
}

function healthIssues(checks: readonly IHealthCheckRun[]): JsonObject[] {
  return checks
    .filter((check) => check.status !== 'passed')
    .map((check) => ({
      code: check.failureCode ?? check.id,
      severity: check.status === 'skipped' ? 'warning' : 'error',
      message: check.summary,
      evidence: [...check.evidence],
    }));
}

function renderHealthMarkdown(result: JsonObject): string {
  const checks = (getArray(result, 'checks') ?? []).filter(isObject);
  const lines = ['# Harness health report', ''];
  lines.push(`- run: ${getString(result, 'run_id') ?? 'unknown'}`);
  lines.push(`- status: ${getString(result, 'status') ?? 'unknown'}`);
  lines.push(`- sandbox enforcement: ${getString(result, 'sandbox_enforcement') ?? 'unknown'}`);
  lines.push('');
  lines.push('| Check | Status | Failure | Duration | Output truncated | Summary |');
  lines.push('|---|---|---|---:|---|---|');
  for (const check of checks) {
    const truncated =
      booleanValue(check, 'stdout_truncated') === true ||
      booleanValue(check, 'stderr_truncated') === true
        ? 'yes'
        : 'no';
    lines.push(
      `| ${markdownText(getString(check, 'id') ?? 'unknown')} | ${markdownText(getString(check, 'status') ?? 'unknown')} | ${markdownText(getString(check, 'failure_code') ?? '-')} | ${numberValue(check, 'duration_ms') ?? 0} | ${truncated} | ${markdownText(getString(check, 'summary') ?? '')} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function defaultRunId(
  harnessPath: string,
  cliVersion: string,
  checks: readonly IHealthCheckRun[],
): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        harnessPath,
        cliVersion,
        checks: checks.map((check) => ({
          id: check.id,
          status: check.status,
          failureCode: check.failureCode,
        })),
      }),
    )
    .digest('hex')
    .slice(0, 12);
  return `health-${digest}`;
}

function declaredArtifacts(artifacts: readonly JsonObject[]): readonly JsonObject[] {
  return artifacts.map((artifactRef) => {
    const mediaType = getString(artifactRef, 'media_type');
    const description = getString(artifactRef, 'description');
    return {
      path: requiredString(artifactRef, 'path', 'health check artifact path'),
      ...(mediaType === undefined ? {} : { ['media_type']: mediaType }),
      ...(description === undefined ? {} : { description }),
    };
  });
}

function normalizedDeclaredPaths(root: string, values: readonly JsonValue[]): readonly string[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) =>
      relativePathFromRoot(root, resolveInsideRoot(root, value, 'Declared path'), 'Declared path'),
    );
}

function declaresPath(declaredPaths: readonly string[], targetPath: string): boolean {
  const normalizedTarget = normalizeArtifactPath(targetPath);
  return declaredPaths.map(normalizeArtifactPath).some((declaredPath) => {
    if (declaredPath === normalizedTarget) {
      return true;
    }
    return normalizedTarget.startsWith(`${declaredPath}/`);
  });
}

function normalizeArtifactPath(path: string): string {
  const withoutFragment = path.split('#', 1)[0] ?? path;
  const withForwardSlashes = withoutFragment.replaceAll('\\', '/');
  return withForwardSlashes.replace(/^(?:\.\/)+/, '').replace(/\/$/, '');
}

function stringMap(object: JsonObject | undefined): Readonly<Record<string, string>> {
  if (object === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(object).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function requiredObject(object: JsonObject, key: string, label: string): JsonObject {
  const value = getObject(object, key);
  if (value === undefined) {
    throw new Error(`${label} is missing after schema validation.`);
  }
  return value;
}

function requiredString(object: JsonObject, key: string, label: string): string {
  const value = getString(object, key);
  if (value === undefined) {
    throw new Error(`${label} is missing after schema validation.`);
  }
  return value;
}

function numberValue(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === 'number' ? value : undefined;
}

function booleanValue(object: JsonObject, key: string): boolean | undefined {
  const value = object[key];
  return typeof value === 'boolean' ? value : undefined;
}

function markdownText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
}
