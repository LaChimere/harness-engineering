import { validateAdapterScopeAgainstMatrix } from '../lib/adapter-scope.ts';
import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import { assertNoSymlinkWithinRoot, loadDocument, pathKind } from '../lib/files.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import {
  relativePathFromRoot,
  resolveInsideRoot,
  resolveRootForInspectionCommand,
} from '../lib/paths.ts';
import { formatValidationIssue, loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { CommandContext } from './init.ts';

const defaultScopePath = 'examples/adapters/github-copilot-cli/adapter-scope.json';
const defaultMatrixPath = 'examples/plugin-capabilities/stage8-agent-cli-capability-matrix.json';
const validateValueOptions = new Set(['root', 'scope', 'matrix']);
const validateFlagOptions = new Set<string>();

export async function runAdapterCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const [subcommand, ...subcommandArgs] = args;
  if (
    subcommand === undefined ||
    subcommand === 'help' ||
    subcommand === '--help' ||
    subcommand === '-h'
  ) {
    context.stdout(adapterHelpText());
    return ExitCode.ok;
  }
  if (subcommand !== 'validate') {
    throw new CliError(`Unknown adapter subcommand: ${subcommand}`, ExitCode.usageError);
  }
  return runAdapterValidate(subcommandArgs, context);
}

async function runAdapterValidate(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, validateValueOptions, validateFlagOptions);
  if (options.positionals.length > 0) {
    throw new CliError(
      'adapter validate does not accept positional arguments.',
      ExitCode.usageError,
    );
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const scopePath = optionValue(options, 'scope') ?? defaultScopePath;
  const matrixPath = optionValue(options, 'matrix') ?? defaultMatrixPath;
  const absoluteScopePath = await readableArtifactPath(root, scopePath, 'Adapter scope');
  const absoluteMatrixPath = await readableArtifactPath(root, matrixPath, 'Capability matrix');
  const [scopeDocument, matrixDocument, schemas] = await Promise.all([
    loadDocument(absoluteScopePath),
    loadDocument(absoluteMatrixPath),
    loadSchemaRegistry(context.packageRoot),
  ]);

  const scopeIssues = schemas.validate('adapter-scope', scopeDocument);
  const matrixIssues = schemas.validate('plugin-capability-matrix', matrixDocument);
  if (scopeIssues.length > 0 || matrixIssues.length > 0) {
    context.stdout(
      `harness adapter validate failed: ${relativePathFromRoot(root, scopePath, 'Adapter scope')}`,
    );
    for (const issue of scopeIssues) {
      context.stdout(`  scope schema: ${formatValidationIssue(issue)}`);
    }
    for (const issue of matrixIssues) {
      context.stdout(`  matrix schema: ${formatValidationIssue(issue)}`);
    }
    return ExitCode.validationError;
  }

  const result = validateAdapterScopeAgainstMatrix(scopeDocument, matrixDocument);
  if (result.errors.length > 0) {
    context.stdout(
      `harness adapter validate failed: ${relativePathFromRoot(root, scopePath, 'Adapter scope')}`,
    );
    for (const error of result.errors) {
      context.stdout(`  semantic: ${error}`);
    }
    return ExitCode.validationError;
  }

  context.stdout(
    `harness adapter validate ok: ${relativePathFromRoot(root, scopePath, 'Adapter scope')}`,
  );
  context.stdout(`  matrix: ${relativePathFromRoot(root, matrixPath, 'Capability matrix')}`);
  if (result.summary !== undefined) {
    context.stdout(`  host: ${result.summary.selectedHostId}`);
    context.stdout(`  tier: ${result.summary.capabilityTier}`);
    context.stdout(
      `  capabilities: ${result.summary.implementedCount} implemented, ${result.summary.unavailableCount} unavailable`,
    );
    const writeModes = Object.entries(result.summary.writeModes)
      .map(([writeClass, mode]) => `${writeClass}=${mode}`)
      .join(', ');
    context.stdout(`  write classes: ${writeModes}`);
  }
  return ExitCode.ok;
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

function adapterHelpText(): string {
  return `harness adapter <subcommand>

Subcommands:
  validate   Validate an adapter scope against the capability matrix.`;
}
