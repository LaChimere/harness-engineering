import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import {
  assertNoSymlinkWithinRoot,
  dumpYaml,
  loadDocument,
  pathKind,
  writeTextNoFollowCreatingDirectories,
} from '../lib/files.ts';
import { getString, isObject, type JsonObject } from '../lib/json.ts';
import { hasFlag, optionValue, parseOptions } from '../lib/options.ts';
import { resolveInsideRoot, resolveRootForInspectionCommand } from '../lib/paths.ts';
import { readPackageVersion } from '../lib/project.ts';
import type { CommandContext } from './init.ts';

const valueOptions = new Set(['root', 'file', 'from', 'to', 'output']);
const flagOptions = new Set(['dry-run', 'apply']);

export async function runMigrate(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'migrate accepts at most one harness file positional argument.',
      ExitCode.usageError,
    );
  }
  if (hasFlag(options, 'apply')) {
    throw new CliError(
      'migrate currently only supports dry-run/no-op evidence. Omit --apply.',
      ExitCode.usageError,
    );
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const harnessPath = optionValue(options, 'file') ?? options.positionals[0] ?? 'harness.yaml';
  const absoluteHarnessPath = resolveInsideRoot(root, harnessPath, 'Harness file');
  if ((await pathKind(absoluteHarnessPath)) !== 'file') {
    throw new CliError(`Harness file not found: ${harnessPath}`, ExitCode.notFound);
  }

  const harness = await loadDocument(absoluteHarnessPath);
  const schemaVersion = isObject(harness) ? getString(harness, 'schema_version') : undefined;
  const cliVersion = await readPackageVersion(context.packageRoot);
  const fromVersion = optionValue(options, 'from') ?? schemaVersion ?? 'unknown';
  const toVersion = optionValue(options, 'to') ?? schemaVersion ?? 'unknown';
  const evidence: JsonObject = {
    schema_version: '0.1.0',
    kind: 'migration-evidence',
    stability: 'provisional',
    harness: harnessPath,
    cli_version: cliVersion,
    from_schema_version: fromVersion,
    to_schema_version: toVersion,
    dry_run: true,
    would_change: false,
    changes: [],
    artifacts: [
      {
        path: harnessPath,
        media_type: 'application/yaml',
        description: 'Harness configuration inspected for no-op migration.',
      },
    ],
  };
  const output = dumpYaml(evidence);
  const outputPath = optionValue(options, 'output');
  if (outputPath === undefined) {
    context.stdout(output.trimEnd());
  } else {
    const resolvedOutputPath = resolveInsideRoot(root, outputPath, 'Migration output');
    await assertNoSymlinkWithinRoot(root, resolvedOutputPath);
    await writeTextNoFollowCreatingDirectories(root, resolvedOutputPath, output);
    context.stdout(`harness migrate ok: wrote ${outputPath}`);
  }
  return ExitCode.ok;
}
