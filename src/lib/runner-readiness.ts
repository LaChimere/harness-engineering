import { createHash } from 'node:crypto';

import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';
import { assertNoSymlinkWithinRoot, loadDocument, pathKind } from './files.ts';
import { validateHarnessConfiguration } from './harness.ts';
import { getArray, getObject, getString, isObject, type JsonObject } from './json.ts';
import { resolveInsideRoot } from './paths.ts';
import { formatValidationIssue, type ISchemaRegistry } from './schema-registry.ts';

type ReadinessStatus = 'passed' | 'failed';

interface IReadinessCheck {
  readonly id: string;
  readonly status: ReadinessStatus;
  readonly summary: string;
  readonly failureCode?: string;
  readonly evidence: readonly JsonObject[];
}

export interface IRunnerReadinessInput {
  readonly root: string;
  readonly harnessPath: string;
  readonly cliVersion: string;
  readonly schemas: ISchemaRegistry;
  readonly runnerPath?: string;
  readonly runId?: string;
}

export interface IRunnerReadinessRun {
  readonly result: JsonObject;
  readonly markdown: string;
  readonly status: ReadinessStatus;
}

const schemaVersion = '0.1.0';
const supportedLiveCredentialSource = 'env';
const environmentVariableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function runRunnerReadiness(
  input: IRunnerReadinessInput,
): Promise<IRunnerReadinessRun> {
  const validation = await validateHarnessConfiguration(input);
  const issues = [
    ...validation.schemaIssues.map((issue) => `schema: ${issue}`),
    ...validation.compatibilityIssues.map((issue) => `engines: ${issue}`),
    ...validation.referenceIssues.map((issue) => `reference: ${issue}`),
  ];
  if (issues.length > 0 || validation.document === undefined) {
    throw new CliError(
      `runner readiness requires a valid harness: ${issues.join('; ')}`,
      ExitCode.validationError,
    );
  }

  const runnerPath = input.runnerPath ?? defaultRunnerPath(validation.document);
  const runner = await loadRunner(input.root, runnerPath, input.schemas);
  const checks = await readinessChecks(input.root, runnerPath, runner, input.schemas);
  const status: ReadinessStatus = checks.some((check) => check.status === 'failed')
    ? 'failed'
    : 'passed';
  const mode = credentialSource(runner) === 'stub' ? 'stub' : 'live';
  const result: JsonObject = {
    ['schema_version']: schemaVersion,
    ['run_id']: input.runId ?? defaultRunId(runnerPath, input.cliVersion, checks),
    ['harness_version']: input.cliVersion,
    runner: runnerPath,
    mode,
    status,
    ['live_ready']: mode === 'live' && status === 'passed',
    checks: checks.map(checkJson),
  };
  return {
    result,
    markdown: renderRunnerReadinessMarkdown(result),
    status,
  };
}

export function serializeRunnerReadinessJson(result: JsonObject): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

async function loadRunner(
  root: string,
  runnerPath: string,
  schemas: ISchemaRegistry,
): Promise<JsonObject> {
  const absolutePath = resolveInsideRoot(root, runnerPath, 'Agent runner');
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    throw new CliError(`Agent runner not found: ${runnerPath}`, ExitCode.notFound);
  }
  const document = await loadDocument(absolutePath);
  if (!isObject(document)) {
    throw new CliError(
      `Agent runner must be a JSON object: ${runnerPath}`,
      ExitCode.validationError,
    );
  }
  const issues = schemas.validate('agent-runner', document).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(`Agent runner is invalid: ${issues.join('; ')}`, ExitCode.validationError);
  }
  return document;
}

async function readinessChecks(
  root: string,
  runnerPath: string,
  runner: JsonObject,
  schemas: ISchemaRegistry,
): Promise<readonly IReadinessCheck[]> {
  const source = credentialSource(runner);
  const mode = source === 'stub' ? 'stub' : 'live';
  return [
    {
      id: 'runner-schema',
      status: 'passed',
      summary: 'Runner schema validation passed.',
      evidence: [artifact(runnerPath, 'application/yaml', 'Agent runner artifact.')],
    },
    credentialCheck(runner),
    budgetCheck(runner),
    await policyCheck(root, runner, schemas),
    await sandboxCheck(root, runner, mode, schemas),
    await traceOutputCheck(root, runner),
    traceRedactionCheck(runner, mode),
    await modelProfileCheck(root, runner, mode, schemas),
    {
      id: 'execution-boundary',
      status: 'passed',
      summary:
        mode === 'live'
          ? 'Readiness checks are non-executing; no model call was made.'
          : 'Deterministic stub runner remains CI-safe and does not require live credentials.',
      evidence: [],
    },
  ];
}

async function policyCheck(
  root: string,
  runner: JsonObject,
  schemas: ISchemaRegistry,
): Promise<IReadinessCheck> {
  const approvalPolicyPath = requiredString(runner, 'approval_policy');
  await loadPolicyObject(root, approvalPolicyPath, 'approval policy', schemas, 'approval-policy');
  return {
    id: 'approval-policy',
    status: 'passed',
    summary: 'Runner approval policy reference is present and schema-valid.',
    evidence: [artifact(approvalPolicyPath, 'application/yaml', 'Approval policy.')],
  };
}

function credentialCheck(runner: JsonObject): IReadinessCheck {
  const credential = getObject(runner, 'credential_reference') ?? {};
  const source = getString(credential, 'source');
  if (source === 'stub') {
    return {
      id: 'credential-reference',
      status: 'passed',
      summary: 'Stub credential reference is configured for CI-safe deterministic execution.',
      evidence: [],
    };
  }
  if (source !== supportedLiveCredentialSource) {
    return {
      id: 'credential-reference',
      status: 'failed',
      failureCode: source === undefined ? 'credential-missing' : 'credential-unsupported',
      summary: `Live runner readiness supports credential_reference.source=${supportedLiveCredentialSource}, got ${source ?? '<missing>'}.`,
      evidence: [],
    };
  }
  const credentialName = getString(credential, 'name');
  if (credentialName === undefined || !environmentVariableNamePattern.test(credentialName)) {
    return {
      id: 'credential-reference',
      status: 'failed',
      failureCode: 'credential-unsupported',
      summary: `Live runner readiness requires credential_reference.name to be a valid environment variable name, got ${credentialName ?? '<missing>'}.`,
      evidence: [],
    };
  }
  return {
    id: 'credential-reference',
    status: 'passed',
    summary: `Live runner declares supported environment credential reference ${credentialName}.`,
    evidence: [],
  };
}

function budgetCheck(runner: JsonObject): IReadinessCheck {
  const budgets = getObject(runner, 'budgets') ?? {};
  const hasTokenBudget =
    numberValue(budgets, 'max_input_tokens') !== undefined ||
    numberValue(budgets, 'max_output_tokens') !== undefined ||
    numberValue(budgets, 'max_total_tokens') !== undefined;
  if (
    numberValue(budgets, 'max_cost_usd') === undefined ||
    numberValue(budgets, 'max_requests') === undefined ||
    getString(budgets, 'enforcement') !== 'hard' ||
    hasTokenBudget === false
  ) {
    return {
      id: 'budgets',
      status: 'failed',
      failureCode: 'budget-missing',
      summary: 'Runner must declare hard cost, request, and token budgets before live readiness.',
      evidence: [],
    };
  }
  return {
    id: 'budgets',
    status: 'passed',
    summary: 'Runner declares hard cost, request, and token budgets.',
    evidence: [],
  };
}

async function sandboxCheck(
  root: string,
  runner: JsonObject,
  mode: 'stub' | 'live',
  schemas: ISchemaRegistry,
): Promise<IReadinessCheck> {
  const sandboxPath = requiredString(runner, 'sandbox');
  const sandbox = await loadPolicyObject(
    root,
    sandboxPath,
    'sandbox policy',
    schemas,
    'sandbox-policy',
  );
  const tier = getString(sandbox, 'tier');
  if (mode === 'live' && tier !== 'container' && tier !== 'vm') {
    return {
      id: 'sandbox',
      status: 'failed',
      failureCode: 'sandbox-violation',
      summary: `Live runner readiness requires container or vm sandbox policy, got ${tier ?? '<missing>'}.`,
      evidence: [artifact(sandboxPath, 'application/yaml', 'Sandbox policy.')],
    };
  }
  if (mode === 'live') {
    const mechanism = getString(getObject(sandbox, 'enforcement') ?? {}, 'mechanism');
    const networkMode = getString(getObject(sandbox, 'network') ?? {}, 'mode');
    const secrets = getObject(sandbox, 'secrets') ?? {};
    const credentialName = getString(getObject(runner, 'credential_reference') ?? {}, 'name');
    const allowedEnvVars = stringArray(secrets, 'allowed_env_vars');
    const allowedSecretRefs = stringArray(secrets, 'allowed_secret_refs');
    const redactionEnvVars = stringArray(
      getObject(runner, 'trace_redaction') ?? {},
      'credential_env_vars',
    );
    if (
      mechanism === undefined ||
      mechanism === 'none' ||
      (networkMode !== 'none' && networkMode !== 'restricted') ||
      credentialName === undefined ||
      !isSingleItemArray(allowedEnvVars, credentialName) ||
      !isSingleItemArray(redactionEnvVars, credentialName) ||
      allowedSecretRefs.length > 0
    ) {
      return {
        id: 'sandbox',
        status: 'failed',
        failureCode: 'sandbox-violation',
        summary:
          'Live runner readiness requires concrete sandbox enforcement, none/restricted network mode, and an exact env-only credential scope shared by sandbox and trace redaction.',
        evidence: [artifact(sandboxPath, 'application/yaml', 'Sandbox policy.')],
      };
    }
  }
  return {
    id: 'sandbox',
    status: 'passed',
    summary:
      mode === 'live'
        ? `Live runner declares ${tier} sandbox policy with exact env-only credential scope.`
        : `Stub runner declares ${tier ?? 'unknown'} sandbox policy for recorded execution.`,
    evidence: [artifact(sandboxPath, 'application/yaml', 'Sandbox policy.')],
  };
}

async function traceOutputCheck(root: string, runner: JsonObject): Promise<IReadinessCheck> {
  const traceOutput = getString(runner, 'trace_output');
  if (traceOutput === undefined || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(traceOutput)) {
    return {
      id: 'trace-output',
      status: 'failed',
      failureCode: 'trace-output-invalid',
      summary: 'Runner must declare a repo-local trace_output path before live readiness.',
      evidence: [],
    };
  }
  try {
    resolveInsideRoot(root, traceOutput, 'trace_output');
  } catch (error) {
    if (error instanceof CliError) {
      return {
        id: 'trace-output',
        status: 'failed',
        failureCode: 'trace-output-invalid',
        summary: error.message,
        evidence: [],
      };
    }
    throw error;
  }
  return {
    id: 'trace-output',
    status: 'passed',
    summary: `Runner declares trace output path ${traceOutput}.`,
    evidence: [artifact(traceOutput, 'application/json', 'Trace output path.')],
  };
}

async function modelProfileCheck(
  root: string,
  runner: JsonObject,
  mode: 'stub' | 'live',
  schemas: ISchemaRegistry,
): Promise<IReadinessCheck> {
  const modelProfilePath = requiredString(runner, 'model_profile');
  const profile = await loadPolicyObject(
    root,
    modelProfilePath,
    'model profile',
    schemas,
    'model-profile',
  );
  const kind = getString(profile, 'kind');
  const provider = getString(profile, 'provider');
  if (mode === 'live' && kind !== 'live') {
    return {
      id: 'model-profile',
      status: 'failed',
      failureCode: 'model-profile-stub',
      summary: `Live runner readiness requires model profile kind live, got ${kind ?? '<missing>'}.`,
      evidence: [artifact(modelProfilePath, 'application/yaml', 'Model profile.')],
    };
  }
  return {
    id: 'model-profile',
    status: 'passed',
    summary:
      mode === 'live'
        ? `Runner declares live model profile provider ${provider ?? '<missing>'}.`
        : 'Stub runner uses deterministic fixture model profile.',
    evidence: [artifact(modelProfilePath, 'application/yaml', 'Model profile.')],
  };
}

function traceRedactionCheck(runner: JsonObject, mode: 'stub' | 'live'): IReadinessCheck {
  if (mode === 'stub') {
    return {
      id: 'trace-redaction',
      status: 'passed',
      summary: 'Stub runner does not capture live credentials or prompt/tool-result material.',
      evidence: [],
    };
  }
  const redaction = getObject(runner, 'trace_redaction');
  if (redaction === undefined) {
    return {
      id: 'trace-redaction',
      status: 'failed',
      failureCode: 'trace-redaction-missing',
      summary: 'Live runner readiness requires trace_redaction policy.',
      evidence: [],
    };
  }
  const recordedFields = stringArray(redaction, 'recorded_fields');
  const credential = getObject(runner, 'credential_reference') ?? {};
  const credentialName = getString(credential, 'name');
  const credentialEnvVars = stringArray(redaction, 'credential_env_vars');
  if (
    recordedFields.length === 0 ||
    booleanValue(redaction, 'refuse_credential_env_references') !== true ||
    credentialName === undefined ||
    !isSingleItemArray(credentialEnvVars, credentialName)
  ) {
    return {
      id: 'trace-redaction',
      status: 'failed',
      failureCode: 'trace-redaction-missing',
      summary:
        'Trace redaction must use a supported field allowlist, refuse credential env references, and name the credential env var.',
      evidence: [],
    };
  }
  return {
    id: 'trace-redaction',
    status: 'passed',
    summary:
      'Trace redaction policy declares a supported field allowlist and credential env-var refusal.',
    evidence: [],
  };
}

function checkJson(check: IReadinessCheck): JsonObject {
  return {
    id: check.id,
    status: check.status,
    ...(check.failureCode === undefined ? {} : { ['failure_code']: check.failureCode }),
    summary: check.summary,
    evidence: [...check.evidence],
  };
}

function renderRunnerReadinessMarkdown(result: JsonObject): string {
  const checks = (getArray(result, 'checks') ?? []).filter(isObject);
  const lines = ['# Harness runner readiness', ''];
  lines.push(`- runner: ${getString(result, 'runner') ?? 'unknown'}`);
  lines.push(`- mode: ${getString(result, 'mode') ?? 'unknown'}`);
  lines.push(`- status: ${getString(result, 'status') ?? 'unknown'}`);
  lines.push(`- live ready: ${booleanValue(result, 'live_ready') === true ? 'yes' : 'no'}`);
  lines.push('', '| Check | Status | Summary |', '|---|---|---|');
  for (const check of checks) {
    lines.push(
      `| ${getString(check, 'id') ?? 'unknown'} | ${getString(check, 'status') ?? 'unknown'} | ${getString(check, 'summary') ?? ''} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function defaultRunnerPath(harness: JsonObject): string {
  const runners = getObject(harness, 'agent_runners') ?? {};
  const defaultRunner = getString(runners, 'default');
  if (defaultRunner !== undefined) {
    return defaultRunner;
  }
  const firstRunner = Object.values(runners).find(
    (value): value is string => typeof value === 'string',
  );
  if (firstRunner === undefined) {
    throw new CliError(
      'harness agent_runners.default is required for runner readiness.',
      ExitCode.validationError,
    );
  }
  return firstRunner;
}

async function loadPolicyObject(
  root: string,
  path: string,
  label: string,
  schemas: ISchemaRegistry,
  schemaName: string,
): Promise<JsonObject> {
  const absolutePath = resolveInsideRoot(root, path, label);
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    throw new CliError(`${label} not found: ${path}`, ExitCode.notFound);
  }
  const document = await loadDocument(absolutePath);
  if (!isObject(document)) {
    throw new CliError(`${label} must contain an object: ${path}`, ExitCode.validationError);
  }
  const issues = schemas.validate(schemaName, document).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(`${label} is invalid: ${issues.join('; ')}`, ExitCode.validationError);
  }
  return document;
}

function credentialSource(runner: JsonObject): string | undefined {
  return getString(getObject(runner, 'credential_reference') ?? {}, 'source');
}

function stringArray(object: JsonObject, key: string): string[] {
  return (getArray(object, key) ?? []).filter(
    (value): value is string => typeof value === 'string',
  );
}

function isSingleItemArray(values: readonly string[], expected: string): boolean {
  return values.length === 1 && values[0] === expected;
}

function numberValue(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === 'number' ? value : undefined;
}

function booleanValue(object: JsonObject, key: string): boolean | undefined {
  const value = object[key];
  return typeof value === 'boolean' ? value : undefined;
}

function requiredString(object: JsonObject, key: string): string {
  const value = getString(object, key);
  if (value === undefined) {
    throw new Error(`${key} is missing after schema validation.`);
  }
  return value;
}

function artifact(path: string, mediaType: string, description: string): JsonObject {
  return { path, ['media_type']: mediaType, description };
}

function defaultRunId(
  runnerPath: string,
  cliVersion: string,
  checks: readonly IReadinessCheck[],
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ runnerPath, cliVersion, checks }))
    .digest('hex')
    .slice(0, 12);
  return `runner-readiness-${digest}`;
}
