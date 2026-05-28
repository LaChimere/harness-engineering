import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import {
  assertNoSymlinkWithinRoot,
  loadDocument,
  pathKind,
  writeTextNoFollowNewFileCreatingDirectories,
} from '../lib/files.ts';
import { assertHealthOutputPathInsideDir, runHealth, serializeHealthJson } from '../lib/health.ts';
import { getObject, getString, isObject } from '../lib/json.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import {
  relativePathFromRoot,
  resolveInsideRoot,
  resolveRootForInspectionCommand,
} from '../lib/paths.ts';
import { readPackageVersion } from '../lib/project.ts';
import { formatValidationIssue, loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { ICommandContext } from './init.ts';

const valueOptions = new Set(['root', 'file', 'format', 'output', 'run-id']);
const flagOptions = new Set(['accept-unsandboxed-execution']);

export async function runHealthCommand(
  args: readonly string[],
  context: ICommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'health accepts at most one harness file positional argument.',
      ExitCode.usageError,
    );
  }
  const format = optionValue(options, 'format') ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') {
    throw new CliError('health --format must be markdown or json.', ExitCode.usageError);
  }
  const runId = optionValue(options, 'run-id');
  if (runId !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(runId)) {
    throw new CliError(
      'health --run-id may contain only lowercase letters, numbers, and hyphens.',
      ExitCode.usageError,
    );
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const harnessPath = optionValue(options, 'file') ?? options.positionals[0] ?? 'harness.yaml';
  const absoluteHarnessPath = resolveInsideRoot(root, harnessPath, 'Harness file');
  await assertNoSymlinkWithinRoot(root, absoluteHarnessPath, 'read');
  if ((await pathKind(absoluteHarnessPath)) !== 'file') {
    throw new CliError(`Harness file not found: ${harnessPath}`, ExitCode.notFound);
  }
  const canonicalHarnessPath = relativePathFromRoot(root, absoluteHarnessPath, 'Harness file');
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const outputPath = optionValue(options, 'output');
  if (outputPath !== undefined) {
    const outputDir = await healthOutputDirForPreflight(absoluteHarnessPath);
    assertHealthOutputPathInsideDir(root, outputDir, outputPath);
    const resolvedOutputPath = resolveInsideRoot(root, outputPath, 'Health output');
    await assertNoSymlinkWithinRoot(root, resolvedOutputPath);
    if ((await pathKind(resolvedOutputPath)) !== undefined) {
      throw new CliError(
        `Health output already exists: ${outputPath}. Use a unique path under health.output_dir.`,
        ExitCode.usageError,
      );
    }
  }
  const health = await runHealth({
    root,
    harnessPath: canonicalHarnessPath,
    cliVersion,
    schemas,
    ...(outputPath === undefined ? {} : { outputPath }),
    allowDeclarativeExecution: options.flags.has('accept-unsandboxed-execution'),
    ...(runId === undefined ? {} : { runId }),
  });
  const issues = schemas.validate('health-result', health.result).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(
      `Health produced invalid health-result output: ${issues.join('; ')}`,
      ExitCode.internalError,
    );
  }
  const output = format === 'json' ? serializeHealthJson(health.result) : health.markdown;
  if (outputPath === undefined) {
    context.stdout(output.trimEnd());
  } else {
    const resolvedOutputPath = resolveInsideRoot(root, outputPath, 'Health output');
    await writeTextNoFollowNewFileCreatingDirectories(root, resolvedOutputPath, output).catch(
      (error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'EEXIST'
        ) {
          throw new CliError(
            `Health output already exists: ${outputPath}. Use a unique path under health.output_dir.`,
            ExitCode.usageError,
          );
        }
        throw error;
      },
    );
    context.stdout(`harness health ${health.status}: wrote ${outputPath}`);
  }
  return exitCodeForHealthStatus(health.exitClass);
}

async function healthOutputDirForPreflight(absoluteHarnessPath: string): Promise<string> {
  const document = await loadDocument(absoluteHarnessPath);
  if (!isObject(document)) {
    throw new CliError(
      'health --output requires a valid harness object.',
      ExitCode.validationError,
    );
  }
  const health = getObject(document, 'health');
  const outputDir = health === undefined ? undefined : getString(health, 'output_dir');
  if (outputDir === undefined) {
    throw new CliError('health --output requires health.output_dir.', ExitCode.validationError);
  }
  return outputDir;
}

function exitCodeForHealthStatus(status: 'passed' | 'failed' | 'refused'): ExitCode {
  switch (status) {
    case 'passed':
      return ExitCode.ok;
    case 'failed':
      return ExitCode.healthFailure;
    case 'refused':
      return ExitCode.validationError;
  }
}
