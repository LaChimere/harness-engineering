import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import {
  assertNoSymlinkWithinRoot,
  pathKind,
  writeTextNoFollowNewFileCreatingDirectories,
} from '../lib/files.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import { resolveInsideRoot, resolveRootForInspectionCommand } from '../lib/paths.ts';
import { loadRecurringProfile, runProfile, serializeProfileRunJson } from '../lib/profile.ts';
import { readPackageVersion } from '../lib/project.ts';
import { formatValidationIssue, loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { CommandContext } from './init.ts';

const validateValueOptions = new Set(['root', 'profile']);
const runValueOptions = new Set([
  'root',
  'file',
  'profile',
  'format',
  'output',
  'run-id',
  'gc-evidence',
  'health-result',
  'previous-run',
]);
const flagOptions = new Set<string>();

export async function runProfileCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const [subcommand, ...subcommandArgs] = args;
  switch (subcommand) {
    case 'validate':
      return await runProfileValidate(subcommandArgs, context);
    case 'run':
      return await runProfileRun(subcommandArgs, context);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      context.stdout(profileHelpText());
      return ExitCode.ok;
    default:
      throw new CliError(`Unknown profile subcommand: ${subcommand}`, ExitCode.usageError);
  }
}

async function runProfileValidate(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, validateValueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'profile validate accepts at most one profile positional argument.',
      ExitCode.usageError,
    );
  }
  const profilePath = optionValue(options, 'profile') ?? options.positionals[0];
  if (profilePath === undefined) {
    throw new CliError(
      'profile validate requires --profile <path> or a profile positional argument.',
      ExitCode.usageError,
    );
  }
  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const profile = await loadRecurringProfile({ root, profilePath, schemas });
  context.stdout(`harness profile validate ok: ${profile.path}`);
  return ExitCode.ok;
}

async function runProfileRun(args: readonly string[], context: CommandContext): Promise<ExitCode> {
  const options = parseOptions(args, runValueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'profile run accepts at most one profile positional argument.',
      ExitCode.usageError,
    );
  }
  const profilePath = optionValue(options, 'profile') ?? options.positionals[0];
  if (profilePath === undefined) {
    throw new CliError(
      'profile run requires --profile <path> or a profile positional argument.',
      ExitCode.usageError,
    );
  }
  const format = optionValue(options, 'format') ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') {
    throw new CliError('profile run --format must be markdown or json.', ExitCode.usageError);
  }
  const runId = optionValue(options, 'run-id');
  if (runId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
    throw new CliError(
      'profile run --run-id may contain only letters, numbers, dots, underscores, and hyphens.',
      ExitCode.usageError,
    );
  }
  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const harnessPath = optionValue(options, 'file') ?? 'harness.yaml';
  const gcEvidencePath = optionValue(options, 'gc-evidence');
  const healthResultPath = optionValue(options, 'health-result');
  const previousRunPath = optionValue(options, 'previous-run');
  const outputPath = optionValue(options, 'output');
  const profileRun = await runProfile({
    root,
    harnessPath,
    profilePath,
    cliVersion,
    schemas,
    ...(runId === undefined ? {} : { runId }),
    ...(gcEvidencePath === undefined ? {} : { gcEvidencePath }),
    ...(healthResultPath === undefined ? {} : { healthResultPath }),
    ...(previousRunPath === undefined ? {} : { previousRunPath }),
    ...(outputPath === undefined ? {} : { outputPath }),
  });
  const issues = schemas.validate('profile-run', profileRun.result).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(
      `Profile run produced invalid output: ${issues.join('; ')}`,
      ExitCode.internalError,
    );
  }
  const output =
    format === 'json' ? serializeProfileRunJson(profileRun.result) : profileRun.markdown;
  if (outputPath === undefined) {
    context.stdout(output.trimEnd());
  } else {
    const resolvedOutputPath = resolveInsideRoot(root, outputPath, 'Profile output');
    await assertNoSymlinkWithinRoot(root, resolvedOutputPath);
    if ((await pathKind(resolvedOutputPath)) !== undefined) {
      throw new CliError(`Profile output already exists: ${outputPath}`, ExitCode.usageError);
    }
    await writeTextNoFollowNewFileCreatingDirectories(root, resolvedOutputPath, output);
    context.stdout(`harness profile run ${profileRun.status}: wrote ${outputPath}`);
  }
  return profileRun.status === 'inconclusive' ? ExitCode.validationError : ExitCode.ok;
}

function profileHelpText(): string {
  return `harness profile <subcommand>

Subcommands:
  validate   Validate a recurring profile contract.
  run        Execute one deterministic profile run against supplied evidence.`;
}
