import { randomUUID } from 'node:crypto';

import { CliError } from '../lib/errors.ts';
import {
  discoverEvalTaskPathsFromHarness,
  runEvalValidation,
  type VerifierResultArtifact,
} from '../lib/eval.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import {
  appendTextNoFollowCreatingDirectories,
  assertNoSymlinkWithinRoot,
  pathKind,
  writeTextNoFollowCreatingDirectories,
} from '../lib/files.ts';
import type { JsonObject } from '../lib/json.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import {
  relativePathFromRoot,
  resolveInsideRoot,
  resolveRootForInspectionCommand,
} from '../lib/paths.ts';
import { readPackageVersion } from '../lib/project.ts';
import { formatValidationIssue, loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { CommandContext } from './init.ts';

const validateValueOptions = new Set(['root', 'file', 'task', 'format', 'output', 'run-id']);
const validateFlagOptions = new Set<string>();

export async function runEvalCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const [subcommand, ...subcommandArgs] = args;
  switch (subcommand) {
    case 'validate':
      return await runEvalValidate(subcommandArgs, context);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      context.stdout(evalHelpText());
      return ExitCode.ok;
    default:
      throw new CliError(`Unknown eval subcommand: ${subcommand}`, ExitCode.usageError);
  }
}

async function runEvalValidate(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, validateValueOptions, validateFlagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'eval validate accepts at most one eval task positional argument.',
      ExitCode.usageError,
    );
  }
  if (options.positionals.length === 1 && optionValue(options, 'task') !== undefined) {
    throw new CliError(
      'eval validate accepts either a positional task or --task, not both.',
      ExitCode.usageError,
    );
  }

  const format = optionValue(options, 'format') ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') {
    throw new CliError('eval validate --format must be markdown or json.', ExitCode.usageError);
  }
  const runId = optionValue(options, 'run-id');
  if (runId !== undefined && runId.trim().length === 0) {
    throw new CliError('eval validate --run-id must not be empty.', ExitCode.usageError);
  }
  if (runId !== undefined && !isSafeRunId(runId)) {
    throw new CliError(
      'eval validate --run-id may contain only letters, numbers, dots, underscores, and hyphens.',
      ExitCode.usageError,
    );
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const explicitTask = optionValue(options, 'task') ?? options.positionals[0];
  const taskPaths =
    explicitTask === undefined
      ? await discoverTaskPathsFromHarness({ root, context, schemas, cliVersion, options })
      : [await canonicalTaskPath(root, explicitTask)];

  const outputOption = optionValue(options, 'output');
  const outputPath =
    outputOption === undefined
      ? undefined
      : relativePathFromRoot(
          root,
          resolveInsideRoot(root, outputOption, 'Eval output'),
          'Eval output',
        );
  const verifierOutputDir = outputPath === undefined ? undefined : '.harness/verifier-results';
  const effectiveRunId = runId ?? (outputPath === undefined ? undefined : `eval-${randomUUID()}`);
  if (outputPath !== undefined) {
    await assertNoSymlinkWithinRoot(root, resolveInsideRoot(root, outputPath, 'Eval output'));
  }
  if (verifierOutputDir !== undefined) {
    await assertNoSymlinkWithinRoot(
      root,
      resolveInsideRoot(root, verifierOutputDir, 'Verifier output'),
    );
  }

  const validation = await runEvalValidation({
    root,
    taskPaths,
    cliVersion,
    schemas,
    ...(effectiveRunId === undefined ? {} : { runId: effectiveRunId }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(verifierOutputDir === undefined ? {} : { verifierOutputDir }),
  });
  const invalidRunResultIssues = validation.runResults.flatMap((runResult) =>
    schemas.validate('run-result', runResult).map(formatValidationIssue),
  );
  if (invalidRunResultIssues.length > 0) {
    throw new CliError(
      `Eval validate produced invalid run-result output: ${invalidRunResultIssues.join('; ')}`,
      ExitCode.internalError,
    );
  }

  if (outputPath === undefined) {
    const output =
      format === 'json' ? `${JSON.stringify(validation.result, null, 2)}\n` : validation.markdown;
    context.stdout(output.trimEnd());
  } else {
    await writeEvalArtifacts(root, outputPath, validation.runResults, validation.verifierResults);
    context.stdout(`harness eval validate ${validation.status}: wrote ${outputPath}`);
  }

  return validation.status === 'passed' ? ExitCode.ok : ExitCode.validationError;
}

async function canonicalTaskPath(root: string, taskPath: string): Promise<string> {
  const absoluteTaskPath = resolveInsideRoot(root, taskPath, 'Eval task');
  if ((await pathKind(absoluteTaskPath)) !== 'file') {
    throw new CliError(`Eval task not found: ${taskPath}`, ExitCode.notFound);
  }
  return relativePathFromRoot(root, absoluteTaskPath, 'Eval task');
}

async function discoverTaskPathsFromHarness(input: {
  readonly root: string;
  readonly context: CommandContext;
  readonly schemas: Awaited<ReturnType<typeof loadSchemaRegistry>>;
  readonly cliVersion: string;
  readonly options: ReturnType<typeof parseOptions>;
}): Promise<readonly string[]> {
  const harnessPath = optionValue(input.options, 'file') ?? 'harness.yaml';
  const canonicalHarnessPath = relativePathFromRoot(
    input.root,
    resolveInsideRoot(input.root, harnessPath, 'Harness file'),
    'Harness file',
  );
  const discovery = await discoverEvalTaskPathsFromHarness({
    root: input.root,
    harnessPath: canonicalHarnessPath,
    cliVersion: input.cliVersion,
    schemas: input.schemas,
  });
  if (discovery.issues.length > 0) {
    throw new CliError(
      `Eval task discovery failed for ${canonicalHarnessPath}: ${discovery.issues.join('; ')}`,
      ExitCode.validationError,
    );
  }
  return discovery.taskPaths;
}

async function writeEvalArtifacts(
  root: string,
  outputPath: string,
  runResults: readonly JsonObject[],
  verifierResults: readonly VerifierResultArtifact[],
): Promise<void> {
  const absoluteOutputPath = resolveInsideRoot(root, outputPath, 'Eval output');
  await assertNoSymlinkWithinRoot(root, absoluteOutputPath);
  for (const verifierResult of verifierResults) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(verifierResult.path)) {
      continue;
    }
    const absoluteVerifierPath = resolveInsideRoot(root, verifierResult.path, 'Verifier result');
    await assertNoSymlinkWithinRoot(root, absoluteVerifierPath);
    await writeTextNoFollowCreatingDirectories(
      root,
      absoluteVerifierPath,
      `${JSON.stringify(verifierResult.result, null, 2)}\n`,
    );
  }
  const jsonl = runResults.map((runResult) => JSON.stringify(runResult)).join('\n');
  if (jsonl.length > 0) {
    await appendTextNoFollowCreatingDirectories(root, absoluteOutputPath, `${jsonl}\n`);
  }
}

function evalHelpText(): string {
  return `harness eval <subcommand>

Subcommands:
  validate   Run deterministic verifier-only eval validation.`;
}

function isSafeRunId(runId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId);
}
