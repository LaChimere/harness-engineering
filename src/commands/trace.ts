import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import {
  assertNoSymlinkWithinRoot,
  loadDocument,
  pathKind,
  writeTextNoFollowCreatingDirectories,
} from '../lib/files.ts';
import { validateHarnessConfiguration } from '../lib/harness.ts';
import { getArray, getObject, getString, isObject, type JsonObject } from '../lib/json.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import {
  relativePathFromRoot,
  resolveInsideRoot,
  resolveRootForInspectionCommand,
} from '../lib/paths.ts';
import { readPackageVersion } from '../lib/project.ts';
import { formatValidationIssue, loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { CommandContext } from './init.ts';

const valueOptions = new Set(['root', 'file', 'format', 'input', 'output']);
const flagOptions = new Set<string>();

export async function runTraceCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const [subcommand, ...subcommandArgs] = args;
  switch (subcommand) {
    case 'validate':
      return await runTraceValidate(subcommandArgs, context);
    case 'import':
      return await runTraceImport(subcommandArgs, context);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      context.stdout(traceHelpText());
      return ExitCode.ok;
    default:
      throw new CliError(`Unknown trace subcommand: ${subcommand}`, ExitCode.usageError);
  }
}

async function runTraceValidate(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'trace validate accepts at most one trace positional argument.',
      ExitCode.usageError,
    );
  }
  const format = optionValue(options, 'format') ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') {
    throw new CliError('trace validate --format must be markdown or json.', ExitCode.usageError);
  }
  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const tracePaths =
    options.positionals[0] === undefined
      ? await traceExamplesFromHarness(
          root,
          optionValue(options, 'file') ?? 'harness.yaml',
          context,
        )
      : [await canonicalTracePath(root, options.positionals[0])];
  const results = [];
  for (const tracePath of tracePaths) {
    const document = await loadDocument(resolveInsideRoot(root, tracePath, 'Trace artifact'));
    const issues = schemas.validate('trace', document).map(formatValidationIssue);
    results.push({ path: tracePath, status: issues.length === 0 ? 'passed' : 'failed', issues });
  }
  const status = results.every((result) => result.status === 'passed') ? 'passed' : 'failed';
  const output: JsonObject = {
    schema_version: '0.1.0',
    status,
    traces: results,
  };
  context.stdout(
    format === 'json' ? JSON.stringify(output, null, 2) : renderTraceValidationMarkdown(output),
  );
  return status === 'passed' ? ExitCode.ok : ExitCode.validationError;
}

async function runTraceImport(args: readonly string[], context: CommandContext): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 0) {
    throw new CliError('trace import only accepts --input and --output.', ExitCode.usageError);
  }
  const input = optionValue(options, 'input');
  const output = optionValue(options, 'output');
  if (input === undefined || output === undefined) {
    throw new CliError('trace import requires --input and --output.', ExitCode.usageError);
  }
  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const inputPath = await canonicalTracePath(root, input);
  const absoluteInput = resolveInsideRoot(root, inputPath, 'Trace import input');
  await assertNoSymlinkWithinRoot(root, absoluteInput);
  const document = await loadDocument(absoluteInput);
  const issues = schemas.validate('trace', document).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(
      `Trace import input failed validation: ${issues.join('; ')}`,
      ExitCode.validationError,
    );
  }
  const absoluteOutput = resolveInsideRoot(root, output, 'Trace import output');
  await assertNoSymlinkWithinRoot(root, absoluteOutput);
  await writeTextNoFollowCreatingDirectories(
    root,
    absoluteOutput,
    `${JSON.stringify(document, null, 2)}\n`,
  );
  context.stdout(
    `harness trace import passed: wrote ${relativePathFromRoot(root, absoluteOutput, 'Trace import output')}`,
  );
  return ExitCode.ok;
}

async function traceExamplesFromHarness(
  root: string,
  harnessPath: string,
  context: CommandContext,
): Promise<readonly string[]> {
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const canonicalHarnessPath = relativePathFromRoot(
    root,
    resolveInsideRoot(root, harnessPath, 'Harness file'),
    'Harness file',
  );
  const validation = await validateHarnessConfiguration({
    root,
    harnessPath: canonicalHarnessPath,
    cliVersion,
    schemas,
  });
  const issues = [
    ...validation.schemaIssues.map((issue) => `schema: ${issue}`),
    ...validation.compatibilityIssues.map((issue) => `engines: ${issue}`),
    ...validation.referenceIssues.map((issue) => `reference: ${issue}`),
  ];
  if (issues.length > 0 || validation.document === undefined) {
    throw new CliError(
      `Trace discovery failed for ${canonicalHarnessPath}: ${issues.join('; ')}`,
      ExitCode.validationError,
    );
  }
  const traces = getObject(validation.document, 'traces');
  const examples = traces === undefined ? undefined : getArray(traces, 'examples');
  if (examples === undefined) {
    return [];
  }
  const canonicalExamples = examples
    .filter((example): example is string => typeof example === 'string')
    .map((example) => canonicalTracePath(root, example));
  return await Promise.all(canonicalExamples);
}

async function canonicalTracePath(root: string, tracePath: string): Promise<string> {
  const absoluteTracePath = resolveInsideRoot(root, tracePath, 'Trace artifact');
  await assertNoSymlinkWithinRoot(root, absoluteTracePath);
  const kind = await pathKind(absoluteTracePath);
  if (kind === undefined) {
    throw new CliError(`Trace artifact not found: ${tracePath}`, ExitCode.notFound);
  }
  if (kind !== 'file') {
    throw new CliError(`Trace artifact must be a file: ${tracePath}`, ExitCode.usageError);
  }
  return relativePathFromRoot(root, absoluteTracePath, 'Trace artifact');
}

function renderTraceValidationMarkdown(result: JsonObject): string {
  const lines = ['# Harness trace validation', ''];
  lines.push(`- status: ${getString(result, 'status') ?? 'unknown'}`);
  lines.push('');
  lines.push('| Trace | Status | Issues |');
  lines.push('|---|---|---:|');
  const traces = getArray(result, 'traces') ?? [];
  for (const trace of traces) {
    if (!isObject(trace)) {
      continue;
    }
    const issues = getArray(trace, 'issues') ?? [];
    lines.push(
      `| ${getString(trace, 'path') ?? 'unknown'} | ${getString(trace, 'status') ?? 'unknown'} | ${issues.length} |`,
    );
  }
  return lines.join('\n');
}

function traceHelpText(): string {
  return `harness trace <subcommand>

Subcommands:
  validate   Validate normalized trace artifacts.
  import     Copy an already-normalized trace after schema validation.`;
}
