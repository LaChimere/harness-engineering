import { runDoctorCommand } from './commands/doctor.ts';
import { runInit } from './commands/init.ts';
import { runMigrate } from './commands/migrate.ts';
import { runReport } from './commands/report.ts';
import { runValidate } from './commands/validate.ts';
import { runVerify } from './commands/verify.ts';
import { CliError } from './lib/errors.ts';
import {
  ExitCode,
  type ExitCode as ExitCodeValue,
  exitCodeDescriptions,
} from './lib/exit-codes.ts';
import { packageRootFromImportMeta, readPackageVersion } from './lib/project.ts';

export interface RunContext {
  readonly cwd: string;
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

export async function runCli(args: readonly string[], context: RunContext): Promise<ExitCodeValue> {
  try {
    const packageRoot = await packageRootFromImportMeta(import.meta.url);
    const commandContext = {
      cwd: context.cwd,
      packageRoot,
      stdout: context.stdout,
    };
    const [command, ...commandArgs] = args;
    if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
      context.stdout(helpText());
      return ExitCode.ok;
    }
    if (command === 'version' || command === '--version' || command === '-v') {
      context.stdout(await readPackageVersion(packageRoot));
      return ExitCode.ok;
    }

    switch (command) {
      case 'init':
        return await runInit(commandArgs, commandContext);
      case 'validate':
        return await runValidate(commandArgs, commandContext);
      case 'migrate':
        return await runMigrate(commandArgs, commandContext);
      case 'doctor':
        return await runDoctorCommand(commandArgs, commandContext);
      case 'verify':
        return await runVerify(commandArgs, commandContext);
      case 'report':
        return await runReport(commandArgs, commandContext);
      default:
        throw new CliError(`Unknown command: ${command}`, ExitCode.usageError);
    }
  } catch (error) {
    if (error instanceof CliError) {
      context.stderr(`harness: ${error.message}`);
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    context.stderr(`harness: unexpected error: ${message}`);
    return ExitCode.internalError;
  }
}

function helpText(): string {
  return `harness <command>

Commands:
  init       Create a schema-valid starter harness baseline.
  validate   Validate harness.yaml shape, engines, and composed references.
  migrate    Emit dry-run/no-op migration evidence.
  doctor     Run deterministic structural harness checks.
  verify     Validate explicit self-verification evidence.
  report     Summarize harness artifacts and cite source paths.
  version    Print CLI version.

Exit codes:
${exitCodeDescriptions.map((item) => `  ${item.code} ${item.name} - ${item.meaning}`).join('\n')}`;
}
