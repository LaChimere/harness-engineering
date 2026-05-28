import { CliError } from '../lib/errors.ts';
import {
  type ExecutionLoopPhase,
  isExecutionLoopPhase,
  validateExecutionLoopContract,
} from '../lib/execution-loop.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import { assertNoSymlinkWithinRoot, loadDocument, pathKind } from '../lib/files.ts';
import { validateHarnessConfiguration } from '../lib/harness.ts';
import { getObject, getString, isObject, type JsonObject, type JsonValue } from '../lib/json.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import {
  relativePathFromRoot,
  resolveInsideRoot,
  resolveRootForInspectionCommand,
} from '../lib/paths.ts';
import { readPackageVersion } from '../lib/project.ts';
import {
  formatValidationIssue,
  type ISchemaRegistry,
  loadSchemaRegistry,
} from '../lib/schema-registry.ts';
import type { ICommandContext } from './init.ts';

const validateValueOptions = new Set(['root', 'file', 'continuity', 'verification', 'phase']);
const validateFlagOptions = new Set<string>();

interface ISchemaIssue {
  readonly prefix: string;
  readonly message: string;
}

interface IPolicyContext {
  readonly approvalPolicyId: string;
  readonly sandboxPolicyId: string;
  readonly sandboxTier: string;
}

export async function runLoopCommand(
  args: readonly string[],
  context: ICommandContext,
): Promise<ExitCode> {
  const [subcommand, ...subcommandArgs] = args;
  if (
    subcommand === undefined ||
    subcommand === 'help' ||
    subcommand === '--help' ||
    subcommand === '-h'
  ) {
    context.stdout(loopHelpText());
    return ExitCode.ok;
  }
  if (subcommand !== 'validate') {
    throw new CliError(`Unknown loop subcommand: ${subcommand}`, ExitCode.usageError);
  }
  return runLoopValidate(subcommandArgs, context);
}

async function runLoopValidate(
  args: readonly string[],
  context: ICommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, validateValueOptions, validateFlagOptions);
  if (options.positionals.length > 0) {
    throw new CliError('loop validate does not accept positional arguments.', ExitCode.usageError);
  }

  const phase = executionLoopPhase(optionValue(options, 'phase') ?? 'complete');
  const continuityPath = optionValue(options, 'continuity');
  if (continuityPath === undefined) {
    throw new CliError('loop validate requires --continuity <path>.', ExitCode.usageError);
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const harnessPath = optionValue(options, 'file') ?? 'harness.yaml';
  const verificationPath = optionValue(options, 'verification');
  if (phase === 'complete' && verificationPath === undefined) {
    throw new CliError(
      'loop validate --phase complete requires --verification <path>.',
      ExitCode.usageError,
    );
  }

  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const harness = await validateHarnessConfiguration({ root, harnessPath, cliVersion, schemas });
  const harnessExitCode = renderHarnessIssues(harness, context);
  if (harnessExitCode !== undefined) {
    return harnessExitCode;
  }
  if (harness.document === undefined) {
    throw new CliError('Harness validation did not return a document.', ExitCode.internalError);
  }

  const policyContext = await readPolicyContext(root, harness.document, schemas, context);
  if (policyContext === undefined) {
    return ExitCode.validationError;
  }

  const continuityArtifact = await loadRequiredArtifact(
    root,
    continuityPath,
    'Continuity state',
    schemas,
    'continuity-state',
  );
  const startupVerificationRef = startupVerificationRefFrom(continuityArtifact.document);
  const startupVerificationArtifact =
    startupVerificationRef === undefined
      ? undefined
      : await loadReferencedArtifact(
          root,
          startupVerificationRef,
          'Startup self-verification',
          schemas,
          'self-verification',
        );
  const completionVerificationArtifact =
    verificationPath === undefined
      ? undefined
      : await loadRequiredArtifact(
          root,
          verificationPath,
          'Completion self-verification',
          schemas,
          'self-verification',
        );

  const schemaIssues = [
    ...continuityArtifact.issues,
    ...(startupVerificationArtifact?.issues ?? []),
    ...(completionVerificationArtifact?.issues ?? []),
  ];
  if (schemaIssues.length > 0) {
    context.stdout(`harness loop validate failed: ${continuityPath}`);
    for (const issue of schemaIssues) {
      context.stdout(`  ${issue.prefix}: ${issue.message}`);
    }
    return ExitCode.validationError;
  }

  assertObject(continuityArtifact.document, 'Continuity state');
  const startupVerification = startupVerificationArtifact?.document;
  if (startupVerification !== undefined) {
    assertObject(startupVerification, 'Startup self-verification');
  }
  const completionVerification = completionVerificationArtifact?.document;
  if (completionVerification !== undefined) {
    assertObject(completionVerification, 'Completion self-verification');
  }

  const result = validateExecutionLoopContract({
    phase,
    harness: harness.document,
    continuity: continuityArtifact.document,
    ...(startupVerification === undefined ? {} : { startupVerification }),
    ...(completionVerification === undefined ? {} : { completionVerification }),
    ...(completionVerificationArtifact?.relativePath === undefined
      ? {}
      : { completionVerificationPath: completionVerificationArtifact.relativePath }),
  });
  if (result.errors.length > 0) {
    context.stdout(`harness loop validate failed: ${continuityPath}`);
    for (const error of result.errors) {
      context.stdout(`  semantic: ${error}`);
    }
    return ExitCode.validationError;
  }

  context.stdout(`harness loop validate ok: ${continuityPath}`);
  context.stdout(`  phase: ${phase}`);
  context.stdout(`  harness: ${harness.harnessPath}`);
  context.stdout(`  approval policy: ${policyContext.approvalPolicyId}`);
  context.stdout(
    `  sandbox policy: ${policyContext.sandboxPolicyId} (${policyContext.sandboxTier})`,
  );
  if (result.summary.startupVerificationRef !== undefined) {
    context.stdout(`  startup verification: ${result.summary.startupVerificationRef}`);
  }
  if (result.summary.completionVerificationPath !== undefined) {
    context.stdout(`  completion verification: ${result.summary.completionVerificationPath}`);
  }
  context.stdout(`  gates: startup=passed${phase === 'complete' ? ', completion=passed' : ''}`);
  return ExitCode.ok;
}

function executionLoopPhase(value: string): ExecutionLoopPhase {
  if (isExecutionLoopPhase(value)) {
    return value;
  }
  throw new CliError('loop validate --phase must be start or complete.', ExitCode.usageError);
}

function renderHarnessIssues(
  result: Awaited<ReturnType<typeof validateHarnessConfiguration>>,
  context: ICommandContext,
): ExitCode | undefined {
  if (result.schemaIssues.length > 0) {
    context.stdout(`harness loop validate failed: ${result.harnessPath}`);
    for (const issue of result.schemaIssues) {
      context.stdout(`  harness schema: ${issue}`);
    }
    return ExitCode.validationError;
  }
  if (result.compatibilityIssues.length > 0) {
    context.stdout(`harness loop validate incompatible: ${result.harnessPath}`);
    for (const issue of result.compatibilityIssues) {
      context.stdout(`  engines: ${issue}`);
    }
    return ExitCode.incompatibleEngines;
  }
  if (result.referenceIssues.length > 0) {
    context.stdout(`harness loop validate failed: ${result.harnessPath}`);
    for (const issue of result.referenceIssues) {
      context.stdout(`  reference: ${issue}`);
    }
    return ExitCode.validationError;
  }
  return undefined;
}

async function readPolicyContext(
  root: string,
  harness: JsonObject,
  schemas: ISchemaRegistry,
  context: ICommandContext,
): Promise<IPolicyContext | undefined> {
  const approvalPath = getString(harness, 'approval_policy');
  const sandboxPath = getString(harness, 'sandbox');
  const issues: ISchemaIssue[] = [];
  if (approvalPath === undefined) {
    issues.push({ prefix: 'approval policy', message: 'harness is missing approval_policy' });
  }
  if (sandboxPath === undefined) {
    issues.push({ prefix: 'sandbox policy', message: 'harness is missing sandbox' });
  }

  const approval =
    approvalPath === undefined
      ? undefined
      : await loadReferencedArtifact(
          root,
          approvalPath,
          'Approval policy',
          schemas,
          'approval-policy',
        );
  const sandbox =
    sandboxPath === undefined
      ? undefined
      : await loadReferencedArtifact(
          root,
          sandboxPath,
          'Sandbox policy',
          schemas,
          'sandbox-policy',
        );
  issues.push(...(approval?.issues ?? []), ...(sandbox?.issues ?? []));
  if (issues.length > 0) {
    context.stdout('harness loop validate failed: policy context');
    for (const issue of issues) {
      context.stdout(`  ${issue.prefix}: ${issue.message}`);
    }
    return undefined;
  }
  const approvalDocument = approval?.document;
  const sandboxDocument = sandbox?.document;
  if (approvalDocument === undefined || sandboxDocument === undefined) {
    throw new CliError('Policy context was not loaded.', ExitCode.internalError);
  }
  assertObject(approvalDocument, 'Approval policy');
  assertObject(sandboxDocument, 'Sandbox policy');
  return {
    approvalPolicyId: getString(approvalDocument, 'policy_id') ?? '<unknown>',
    sandboxPolicyId: getString(sandboxDocument, 'policy_id') ?? '<unknown>',
    sandboxTier: getString(sandboxDocument, 'tier') ?? '<unknown>',
  };
}

async function loadRequiredArtifact(
  root: string,
  path: string,
  description: string,
  schemas: ISchemaRegistry,
  schemaName: string,
): Promise<{
  readonly document: JsonValue;
  readonly issues: readonly ISchemaIssue[];
  readonly relativePath: string;
}> {
  const absolutePath = await readableArtifactPath(root, path, description);
  const document = await loadDocument(absolutePath);
  const issues = schemas.validate(schemaName, document).map((issue) => ({
    prefix: `${description.toLowerCase()} schema`,
    message: formatValidationIssue(issue),
  }));
  return {
    document,
    issues,
    relativePath: relativePathFromRoot(root, absolutePath, description),
  };
}

async function loadReferencedArtifact(
  root: string,
  path: string,
  description: string,
  schemas: ISchemaRegistry,
  schemaName: string,
): Promise<{ readonly document?: JsonValue; readonly issues: readonly ISchemaIssue[] }> {
  const localPath = stripFragment(path);
  let absolutePath: string;
  try {
    absolutePath = await readableArtifactPath(root, localPath, description);
  } catch (error) {
    if (error instanceof CliError) {
      return {
        issues: [
          {
            prefix: description.toLowerCase(),
            message: error.message,
          },
        ],
      };
    }
    throw error;
  }
  const document = await loadDocument(absolutePath);
  const issues = schemas.validate(schemaName, document).map((issue) => ({
    prefix: `${description.toLowerCase()} schema`,
    message: formatValidationIssue(issue),
  }));
  return { document, issues };
}

async function readableArtifactPath(
  root: string,
  path: string,
  description: string,
): Promise<string> {
  const absolutePath = resolveInsideRoot(root, path, description);
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    throw new CliError(`${description} not found: ${path}`, ExitCode.notFound);
  }
  return absolutePath;
}

function startupVerificationRefFrom(document: JsonValue): string | undefined {
  if (!isObject(document)) {
    return undefined;
  }
  const startup = getObject(document, 'startup_verification');
  return startup === undefined ? undefined : getString(startup, 'self_verification_ref');
}

function assertObject(value: JsonValue, description: string): asserts value is JsonObject {
  if (!isObject(value)) {
    throw new CliError(
      `${description} must be an object after schema validation.`,
      ExitCode.internalError,
    );
  }
}

function stripFragment(path: string): string {
  const [localPath] = path.split('#', 1);
  return localPath ?? '';
}

function loopHelpText(): string {
  return `harness loop <subcommand>

Subcommands:
  validate   Validate native execution-loop startup and completion gates.`;
}
