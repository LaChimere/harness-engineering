import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import {
  assertNoSymlinkWithinRoot,
  loadDocument,
  pathKind,
  writeTextNoFollowNewFileCreatingDirectories,
} from '../lib/files.ts';
import {
  runGcAudit,
  serializeGcJson,
  validateGcEvidenceReferences,
  validateGcEvidenceSemantics,
} from '../lib/gc.ts';
import { isObject } from '../lib/json.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import {
  relativePathFromRoot,
  resolveInsideRoot,
  resolveRootForInspectionCommand,
} from '../lib/paths.ts';
import { readPackageVersion } from '../lib/project.ts';
import { formatValidationIssue, loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { CommandContext } from './init.ts';

const valueOptions = new Set([
  'root',
  'file',
  'format',
  'output',
  'audit-id',
  'generated-at',
  'previous-audit',
  'repair-actions-dir',
  'capability-ledger',
  'verification',
  'run-results',
  'scoreboard',
  'trace',
  'judge-result',
]);
const flagOptions = new Set<string>();
const validateFlagOptions = new Set(['skip-reference-checks']);

export async function runGcCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const [subcommand, ...subcommandArgs] = args;
  switch (subcommand) {
    case 'audit':
      return await runGcAuditCommand(subcommandArgs, context);
    case 'validate':
      return await runGcValidateCommand(subcommandArgs, context);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      context.stdout(gcHelpText());
      return ExitCode.ok;
    default:
      throw new CliError(`Unknown gc subcommand: ${subcommand}`, ExitCode.usageError);
  }
}

async function runGcAuditCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 0) {
    throw new CliError('gc audit does not accept positional arguments.', ExitCode.usageError);
  }
  const format = optionValue(options, 'format') ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') {
    throw new CliError('gc audit --format must be markdown or json.', ExitCode.usageError);
  }
  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const auditId = optionValue(options, 'audit-id');
  const generatedAt = optionValue(options, 'generated-at');
  const previousAuditRef = optionValue(options, 'previous-audit');
  const repairActionsDir = optionValue(options, 'repair-actions-dir');
  const capabilityLedgerPath = optionValue(options, 'capability-ledger');
  const verificationPath = optionValue(options, 'verification');
  const runResultsPath = optionValue(options, 'run-results');
  const scoreboardPath = optionValue(options, 'scoreboard');
  const tracePath = optionValue(options, 'trace');
  const judgeResultPath = optionValue(options, 'judge-result');
  const harnessPath = relativePathFromRoot(
    root,
    resolveInsideRoot(root, optionValue(options, 'file') ?? 'harness.yaml', 'Harness file'),
    'Harness file',
  );
  if (previousAuditRef !== undefined) {
    await validatePreviousAuditRef(root, previousAuditRef);
  }
  const audit = await runGcAudit({
    root,
    harnessPath,
    cliVersion,
    schemas,
    ...(auditId === undefined ? {} : { auditId }),
    ...(generatedAt === undefined ? {} : { generatedAt }),
    ...(previousAuditRef === undefined ? {} : { previousAuditRef }),
    ...(repairActionsDir === undefined ? {} : { repairActionsDir }),
    ...(capabilityLedgerPath === undefined ? {} : { capabilityLedgerPath }),
    ...(verificationPath === undefined ? {} : { verificationPath }),
    ...(runResultsPath === undefined ? {} : { runResultsPath }),
    ...(scoreboardPath === undefined ? {} : { scoreboardPath }),
    ...(tracePath === undefined ? {} : { tracePath }),
    ...(judgeResultPath === undefined ? {} : { judgeResultPath }),
  });

  const issues = [
    ...schemas.validate('gc-evidence', audit.evidence).map(formatValidationIssue),
    ...validateGcEvidenceSemantics(audit.evidence),
    ...(await validateGcEvidenceReferences(audit.evidence, root)),
  ];
  if (issues.length > 0) {
    throw new CliError(
      `GC audit produced invalid evidence: ${issues.join('; ')}`,
      ExitCode.internalError,
    );
  }

  const output = format === 'json' ? serializeGcJson(audit.evidence) : audit.markdown;
  const outputPath = optionValue(options, 'output');
  if (outputPath === undefined) {
    context.stdout(output.trimEnd());
  } else {
    const resolvedOutputPath = resolveInsideRoot(root, outputPath, 'GC output');
    await assertNoSymlinkWithinRoot(root, resolvedOutputPath);
    await writeTextNoFollowNewFileCreatingDirectories(root, resolvedOutputPath, output).catch(
      (error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'EEXIST'
        ) {
          throw new CliError(
            `GC output already exists: ${outputPath}. Use a unique path such as .harness/outputs/gc/<audit-id>.json.`,
            ExitCode.usageError,
          );
        }
        throw error;
      },
    );
    context.stdout(`harness gc audit ${audit.status}: wrote ${outputPath}`);
  }
  return ExitCode.ok;
}

async function validatePreviousAuditRef(root: string, previousAuditRef: string): Promise<void> {
  if (isReferenceOnlyPath(previousAuditRef)) {
    return;
  }
  const absolutePreviousAuditPath = resolveInsideRoot(root, previousAuditRef, 'GC previous audit');
  await assertNoSymlinkWithinRoot(root, absolutePreviousAuditPath, 'read');
  if ((await pathKind(absolutePreviousAuditPath)) !== 'file') {
    throw new CliError(`GC previous audit not found: ${previousAuditRef}`, ExitCode.notFound);
  }
}

async function runGcValidateCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, validateFlagOptions);
  if (options.positionals.length > 1) {
    throw new CliError('gc validate accepts at most one evidence artifact.', ExitCode.usageError);
  }
  const format = optionValue(options, 'format') ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') {
    throw new CliError('gc validate --format must be markdown or json.', ExitCode.usageError);
  }
  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const artifactPath =
    options.positionals[0] ?? optionValue(options, 'file') ?? 'examples/gc/evidence.json';
  const absoluteArtifactPath = resolveInsideRoot(root, artifactPath, 'GC evidence');
  await assertNoSymlinkWithinRoot(root, absoluteArtifactPath, 'read');
  if ((await pathKind(absoluteArtifactPath)) !== 'file') {
    throw new CliError(`GC evidence not found: ${artifactPath}`, ExitCode.notFound);
  }
  const document = await loadDocument(absoluteArtifactPath);
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const skipReferenceChecks = options.flags.has('skip-reference-checks');
  const issues = [
    ...schemas.validate('gc-evidence', document).map(formatValidationIssue),
    ...(isObject(document)
      ? [
          ...validateGcEvidenceSemantics(document),
          ...(skipReferenceChecks ? [] : await validateGcEvidenceReferences(document, root)),
        ]
      : ['GC evidence must be an object']),
  ];
  const status = issues.length === 0 ? 'passed' : 'failed';
  if (format === 'json') {
    context.stdout(
      JSON.stringify(
        {
          schema_version: '0.1.0',
          status,
          artifact: artifactPath,
          issues,
        },
        null,
        2,
      ),
    );
  } else {
    context.stdout(renderGcValidationMarkdown(artifactPath, status, issues).trimEnd());
  }
  return issues.length === 0 ? ExitCode.ok : ExitCode.validationError;
}

function renderGcValidationMarkdown(
  artifactPath: string,
  status: 'passed' | 'failed',
  issues: readonly string[],
): string {
  const lines = [
    '# Harness GC evidence validation',
    '',
    `- artifact: ${artifactPath}`,
    `- status: ${status}`,
  ];
  if (issues.length > 0) {
    lines.push('', '## Issues', '');
    for (const issue of issues) {
      lines.push(`- ${issue}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function isReferenceOnlyPath(path: string): boolean {
  return path.startsWith('#') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path);
}

function gcHelpText(): string {
  return `harness gc <subcommand>

Subcommands:
  audit      Produce deterministic GC evidence for the selected harness.
  validate   Validate a GC evidence artifact.

Audit evidence inputs:
  --verification <path>   Include self-verification evidence.
  --run-results <path>    Include run-result JSON, JSON array, or JSONL evidence.
  --scoreboard <path>     Include scoreboard evidence.
  --trace <path>          Include trace evidence.
  --judge-result <path>   Include LLM judge-result evidence.

Validate options:
  --skip-reference-checks   Validate archived evidence shape without resolving local refs.`;
}
