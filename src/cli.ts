import { runAdapterCommand } from './commands/adapter.ts';
import { runAssessCommand } from './commands/assess.ts';
import { runDoctorCommand } from './commands/doctor.ts';
import { runEvalCommand } from './commands/eval.ts';
import { runGcCommand } from './commands/gc.ts';
import { runHealthCommand } from './commands/health.ts';
import { runInit } from './commands/init.ts';
import { runLoopCommand } from './commands/loop.ts';
import { runMigrate } from './commands/migrate.ts';
import { runProfileCommand } from './commands/profile.ts';
import { runReport } from './commands/report.ts';
import { runAgentRunCommand } from './commands/run.ts';
import { runRunnerCommand } from './commands/runner.ts';
import { runTraceCommand } from './commands/trace.ts';
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
      case 'loop':
        return await runLoopCommand(commandArgs, commandContext);
      case 'adapter':
        return await runAdapterCommand(commandArgs, commandContext);
      case 'assess':
        return await runAssessCommand(commandArgs, commandContext);
      case 'validate':
        return await runValidate(commandArgs, commandContext);
      case 'migrate':
        return await runMigrate(commandArgs, commandContext);
      case 'doctor':
        return await runDoctorCommand(commandArgs, commandContext);
      case 'health':
        return await runHealthCommand(commandArgs, commandContext);
      case 'gc':
        return await runGcCommand(commandArgs, commandContext);
      case 'profile':
        return await runProfileCommand(commandArgs, commandContext);
      case 'eval':
        return await runEvalCommand(commandArgs, commandContext);
      case 'run':
        return await runAgentRunCommand(commandArgs, commandContext);
      case 'runner':
        return await runRunnerCommand(commandArgs, commandContext);
      case 'trace':
        return await runTraceCommand(commandArgs, commandContext);
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
  loop       Validate native execution-loop startup and completion gates.
  adapter    Validate limited-adapter scope against the capability matrix.
  assess     Read existing artifacts and emit agent-facing maturity/routing guidance.
  validate   Validate harness.yaml shape, engines, and composed references.
  migrate    Emit dry-run/no-op migration evidence.
  doctor     Run deterministic structural harness checks.
  health     Run declared local project health checks.
  gc         Audit or validate deterministic GC evidence.
  profile    Validate or run recurring maintenance profiles.
  run        Run deterministic stub agent tasks.
  runner     Check runner readiness without live model execution.
  eval       Run eval validation or deterministic behavioral evals.
  trace      Validate or import normalized traces.
  verify     Validate explicit self-verification evidence.
  report     Summarize harness artifacts and cite source paths.
  version    Print CLI version.

Exit codes:
${exitCodeDescriptions.map((item) => `  ${item.code} ${item.name} - ${item.meaning}`).join('\n')}`;
}
