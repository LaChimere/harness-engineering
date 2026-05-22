import {
  exitCodeForAgentRun,
  renderRunMarkdown,
  runAgentTask,
  writeAgentRunArtifacts,
} from '../lib/agent-runner.ts';
import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import { resolveRootForInspectionCommand } from '../lib/paths.ts';
import { readPackageVersion } from '../lib/project.ts';
import { formatValidationIssue, loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { CommandContext } from './init.ts';

const valueOptions = new Set(['root', 'file', 'runner', 'format', 'run-id', 'session-id', 'case']);
const flagOptions = new Set<string>();

export async function runAgentRunCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'run accepts at most one eval task positional argument.',
      ExitCode.usageError,
    );
  }
  const format = optionValue(options, 'format') ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') {
    throw new CliError('run --format must be markdown or json.', ExitCode.usageError);
  }
  const runId = optionValue(options, 'run-id');
  if (runId !== undefined && !isSafeArtifactId(runId)) {
    throw new CliError(
      'run --run-id may contain only letters, numbers, dots, underscores, and hyphens.',
      ExitCode.usageError,
    );
  }
  const caseKind = optionValue(options, 'case') ?? 'oracle';
  if (caseKind !== 'oracle' && caseKind !== 'broken-twin') {
    throw new CliError('run --case must be oracle or broken-twin.', ExitCode.usageError);
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const runnerPath = optionValue(options, 'runner');
  const sessionId = optionValue(options, 'session-id');
  if (sessionId !== undefined && sessionId.trim().length === 0) {
    throw new CliError('run --session-id must not be empty.', ExitCode.usageError);
  }
  const run = await runAgentTask({
    root,
    harnessPath: optionValue(options, 'file') ?? 'harness.yaml',
    cliVersion,
    schemas,
    ...(runnerPath === undefined ? {} : { runnerPath }),
    ...(options.positionals[0] === undefined ? {} : { taskPath: options.positionals[0] }),
    ...(runId === undefined ? {} : { runId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    caseKind,
  });

  validateGeneratedRunArtifacts(schemas, run);
  await writeAgentRunArtifacts(root, [run]);
  context.stdout(
    format === 'json' ? JSON.stringify(run.summary, null, 2) : renderRunMarkdown(run).trimEnd(),
  );
  return exitCodeForAgentRun(run.status);
}

function validateGeneratedRunArtifacts(
  schemas: Awaited<ReturnType<typeof loadSchemaRegistry>>,
  run: Awaited<ReturnType<typeof runAgentTask>>,
): void {
  const runResultIssues = schemas.validate('run-result', run.runResult).map(formatValidationIssue);
  const traceIssues = schemas.validate('trace', run.trace).map(formatValidationIssue);
  const verifierResultIssues = schemas
    .validate('verifier-result', run.verifierResult)
    .map(formatValidationIssue);
  const issues = [...runResultIssues, ...traceIssues, ...verifierResultIssues];
  if (issues.length > 0) {
    throw new CliError(
      `harness run produced invalid artifacts: ${issues.join('; ')}`,
      ExitCode.internalError,
    );
  }
}

function isSafeArtifactId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}
