import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import { validateHarnessConfiguration } from '../lib/harness.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import { resolveRootForInspectionCommand } from '../lib/paths.ts';
import { readPackageVersion } from '../lib/project.ts';
import { loadSchemaRegistry } from '../lib/schema-registry.ts';
import type { ICommandContext } from './init.ts';

const valueOptions = new Set(['root', 'file']);
const flagOptions = new Set<string>();

export async function runValidate(
  args: readonly string[],
  context: ICommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'validate accepts at most one harness file positional argument.',
      ExitCode.usageError,
    );
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const harnessPath = optionValue(options, 'file') ?? options.positionals[0] ?? 'harness.yaml';
  const schemas = await loadSchemaRegistry(context.packageRoot);
  const cliVersion = await readPackageVersion(context.packageRoot);
  const result = await validateHarnessConfiguration({ root, harnessPath, cliVersion, schemas });

  if (result.schemaIssues.length > 0) {
    context.stdout(`harness validate failed: ${result.harnessPath}`);
    for (const issue of result.schemaIssues) {
      context.stdout(`  schema: ${issue}`);
    }
    return ExitCode.validationError;
  }

  if (result.compatibilityIssues.length > 0) {
    context.stdout(`harness validate incompatible: ${result.harnessPath}`);
    for (const issue of result.compatibilityIssues) {
      context.stdout(`  engines: ${issue}`);
    }
    return ExitCode.incompatibleEngines;
  }

  if (result.referenceIssues.length > 0) {
    context.stdout(`harness validate failed: ${result.harnessPath}`);
    for (const issue of result.referenceIssues) {
      context.stdout(`  reference: ${issue}`);
    }
    return ExitCode.validationError;
  }

  const checkedCount = result.checkedReferences.length;
  context.stdout(`harness validate ok: ${result.harnessPath}`);
  context.stdout(`  schemas: ${schemas.schemaNames.size} loaded at ${schemas.schemaVersion}`);
  context.stdout(`  references: ${checkedCount} checked`);
  return ExitCode.ok;
}
