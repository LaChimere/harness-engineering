import { runDoctor, serializeDoctorJson } from '../lib/doctor.ts';
import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import {
  assertNoSymlinkWithinRoot,
  pathKind,
  writeTextNoFollowCreatingDirectories,
} from '../lib/files.ts';
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
const flagOptions = new Set<string>();

export async function runDoctorCommand(
  args: readonly string[],
  context: ICommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'doctor accepts at most one harness file positional argument.',
      ExitCode.usageError,
    );
  }

  const format = optionValue(options, 'format') ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') {
    throw new CliError('doctor --format must be markdown or json.', ExitCode.usageError);
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const harnessPath = optionValue(options, 'file') ?? options.positionals[0] ?? 'harness.yaml';
  const absoluteHarnessPath = resolveInsideRoot(root, harnessPath, 'Harness file');
  if ((await pathKind(absoluteHarnessPath)) !== 'file') {
    throw new CliError(`Harness file not found: ${harnessPath}`, ExitCode.notFound);
  }
  const canonicalHarnessPath = relativePathFromRoot(root, absoluteHarnessPath, 'Harness file');

  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const runId = optionValue(options, 'run-id');
  if (runId !== undefined && runId.trim().length === 0) {
    throw new CliError('doctor --run-id must not be empty.', ExitCode.usageError);
  }
  const doctor = await runDoctor({
    root,
    harnessPath: canonicalHarnessPath,
    cliVersion,
    schemas,
    ...(runId === undefined ? {} : { runId }),
  });
  const output = format === 'json' ? serializeDoctorJson(doctor.result) : doctor.markdown;

  const resultIssues = schemas.validate('doctor-result', doctor.result);
  if (resultIssues.length > 0) {
    throw new CliError(
      `Doctor produced invalid doctor-result output: ${resultIssues.map(formatValidationIssue).join('; ')}`,
      ExitCode.internalError,
    );
  }

  const outputPath = optionValue(options, 'output');
  if (outputPath === undefined) {
    context.stdout(output.trimEnd());
  } else {
    const resolvedOutputPath = resolveInsideRoot(root, outputPath, 'Doctor output');
    await assertNoSymlinkWithinRoot(root, resolvedOutputPath);
    await writeTextNoFollowCreatingDirectories(root, resolvedOutputPath, output);
    context.stdout(`harness doctor ${doctor.status}: wrote ${outputPath}`);
  }

  return exitCodeForDoctorStatus(doctor.status);
}

function exitCodeForDoctorStatus(status: 'passed' | 'failed' | 'warning'): ExitCode {
  switch (status) {
    case 'passed':
      return ExitCode.ok;
    case 'failed':
    case 'warning':
      return ExitCode.validationError;
  }
}
