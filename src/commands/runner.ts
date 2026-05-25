import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import { resolveRootForInspectionCommand } from '../lib/paths.ts';
import { readPackageVersion } from '../lib/project.ts';
import { runRunnerReadiness, serializeRunnerReadinessJson } from '../lib/runner-readiness.ts';
import { formatValidationIssue, loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { CommandContext } from './init.ts';

const valueOptions = new Set(['root', 'file', 'runner', 'format', 'run-id']);
const flagOptions = new Set<string>();

export async function runRunnerCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const [subcommand, ...subcommandArgs] = args;
  switch (subcommand) {
    case 'readiness':
      return await runReadiness(subcommandArgs, context);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      context.stdout(runnerHelpText());
      return ExitCode.ok;
    default:
      throw new CliError(`Unknown runner subcommand: ${subcommand}`, ExitCode.usageError);
  }
}

async function runReadiness(args: readonly string[], context: CommandContext): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 0) {
    throw new CliError(
      'runner readiness does not accept positional arguments.',
      ExitCode.usageError,
    );
  }
  const format = optionValue(options, 'format') ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') {
    throw new CliError('runner readiness --format must be markdown or json.', ExitCode.usageError);
  }
  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const runnerPath = optionValue(options, 'runner');
  const runId = optionValue(options, 'run-id');
  const readiness = await runRunnerReadiness({
    root,
    harnessPath: optionValue(options, 'file') ?? 'harness.yaml',
    cliVersion,
    schemas,
    ...(runnerPath === undefined ? {} : { runnerPath }),
    ...(runId === undefined ? {} : { runId }),
  });
  const issues = schemas.validate('runner-readiness', readiness.result).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(
      `Runner readiness produced invalid output: ${issues.join('; ')}`,
      ExitCode.internalError,
    );
  }
  context.stdout(
    format === 'json'
      ? serializeRunnerReadinessJson(readiness.result).trimEnd()
      : readiness.markdown.trimEnd(),
  );
  return readiness.status === 'passed' ? ExitCode.ok : ExitCode.validationError;
}

function runnerHelpText(): string {
  return `harness runner <subcommand>

Subcommands:
  readiness   Check live-runner readiness without executing a model.`;
}
