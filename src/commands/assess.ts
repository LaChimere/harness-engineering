import { buildAssessment, renderAssessmentMarkdown } from '../lib/assessment.ts';
import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import { resolveRootForInspectionCommand } from '../lib/paths.ts';
import { readPackageVersion } from '../lib/project.ts';
import { formatValidationIssue, loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { CommandContext } from './init.ts';

const valueOptions = new Set([
  'root',
  'file',
  'format',
  'doctor-result',
  'health-result',
  'run-results',
  'trace',
  'scoreboard',
  'report',
  'repair-action',
  'repair-actions-dir',
  'trusted-repair-action',
]);
const flagOptions = new Set<string>();

export async function runAssessCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 0) {
    throw new CliError('assess does not accept positional arguments.', ExitCode.usageError);
  }
  const format = optionValue(options, 'format') ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') {
    throw new CliError('assess --format must be markdown or json.', ExitCode.usageError);
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const doctorResultPath = optionValue(options, 'doctor-result');
  const healthResultPath = optionValue(options, 'health-result');
  const runResultsPath = optionValue(options, 'run-results');
  const tracePath = optionValue(options, 'trace');
  const scoreboardPath = optionValue(options, 'scoreboard');
  const reportPath = optionValue(options, 'report');
  const repairActionPath = optionValue(options, 'repair-action');
  const repairActionsDir = optionValue(options, 'repair-actions-dir');
  const trustedRepairActionId = optionValue(options, 'trusted-repair-action');
  if (trustedRepairActionId !== undefined && !isSafeRepairActionId(trustedRepairActionId)) {
    throw new CliError(
      'assess --trusted-repair-action must be a repair-action id such as approved-schema-fix.',
      ExitCode.usageError,
    );
  }
  const assessment = await buildAssessment({
    root,
    harnessPath: optionValue(options, 'file') ?? 'harness.yaml',
    cliVersion,
    schemas,
    ...(doctorResultPath === undefined ? {} : { doctorResultPath }),
    ...(healthResultPath === undefined ? {} : { healthResultPath }),
    ...(runResultsPath === undefined ? {} : { runResultsPath }),
    ...(tracePath === undefined ? {} : { tracePath }),
    ...(scoreboardPath === undefined ? {} : { scoreboardPath }),
    ...(reportPath === undefined ? {} : { reportPath }),
    ...(repairActionPath === undefined ? {} : { repairActionPath }),
    ...(repairActionsDir === undefined ? {} : { repairActionsDir }),
    ...(trustedRepairActionId === undefined ? {} : { trustedRepairActionId }),
  });

  const issues = schemas.validate('assessment', assessment).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(
      `Assessment produced invalid output: ${issues.join('; ')}`,
      ExitCode.internalError,
    );
  }

  context.stdout(
    format === 'json' ? JSON.stringify(assessment, null, 2) : renderAssessmentMarkdown(assessment),
  );
  return ExitCode.ok;
}

function isSafeRepairActionId(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}
