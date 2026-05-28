import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import { loadDocument, pathKind } from '../lib/files.ts';
import { getArray, getString, isObject } from '../lib/json.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import { resolveInsideRoot, resolveRootForInspectionCommand } from '../lib/paths.ts';
import { formatValidationIssue, loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { ICommandContext } from './init.ts';

const valueOptions = new Set(['root', 'spec']);
const flagOptions = new Set<string>();

export async function runVerify(
  args: readonly string[],
  context: ICommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'verify accepts at most one verification spec positional argument.',
      ExitCode.usageError,
    );
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const specPath = optionValue(options, 'spec') ?? options.positionals[0];
  if (specPath === undefined) {
    throw new CliError(
      'verify requires --spec <path> or a spec positional argument.',
      ExitCode.usageError,
    );
  }

  const absoluteSpecPath = resolveInsideRoot(root, specPath, 'Verification spec');
  if ((await pathKind(absoluteSpecPath)) !== 'file') {
    throw new CliError(`Verification spec not found: ${specPath}`, ExitCode.notFound);
  }

  const schemas = await loadSchemaRegistry(context.packageRoot);
  const spec = await loadDocument(absoluteSpecPath);
  const issues = schemas.validate('self-verification', spec);
  if (issues.length > 0) {
    context.stdout(`harness verify failed: ${specPath}`);
    for (const issue of issues) {
      context.stdout(`  schema: ${formatValidationIssue(issue)}`);
    }
    return ExitCode.validationError;
  }

  if (!isObject(spec)) {
    throw new CliError(
      'Verification spec must be an object after schema validation.',
      ExitCode.internalError,
    );
  }

  const checks = getArray(spec, 'acceptance_checks') ?? [];
  const counts = { passed: 0, failed: 0, blocked: 0 };
  for (const check of checks) {
    if (!isObject(check)) {
      continue;
    }
    const status = getString(check, 'status');
    if (status === 'passed') {
      counts.passed += 1;
    } else if (status === 'failed') {
      counts.failed += 1;
    } else if (status === 'blocked') {
      counts.blocked += 1;
    }
  }

  context.stdout(
    `harness verify ${counts.failed === 0 && counts.blocked === 0 ? 'ok' : 'failed'}: ${specPath}`,
  );
  context.stdout(
    `  acceptance checks: ${counts.passed} passed, ${counts.failed} failed, ${counts.blocked} blocked`,
  );
  context.stdout('  scope: consumed explicit self-verification evidence only');
  return counts.failed === 0 && counts.blocked === 0 ? ExitCode.ok : ExitCode.validationError;
}
