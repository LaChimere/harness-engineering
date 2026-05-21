import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import { loadDocument, pathKind } from '../lib/files.ts';
import { collectHarnessReferences } from '../lib/harness.ts';
import { getArray, getObject, getString, isObject } from '../lib/json.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import { resolveInsideRoot, resolveRootForInspectionCommand } from '../lib/paths.ts';
import type { CommandContext } from './init.ts';

const valueOptions = new Set([
  'root',
  'file',
  'verification',
  'run-result',
  'trace',
  'doctor-result',
]);
const flagOptions = new Set<string>();

export async function runReport(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'report accepts at most one harness file positional argument.',
      ExitCode.usageError,
    );
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const harnessPath = optionValue(options, 'file') ?? options.positionals[0] ?? 'harness.yaml';
  const absoluteHarnessPath = resolveInsideRoot(root, harnessPath, 'Harness file');
  if ((await pathKind(absoluteHarnessPath)) !== 'file') {
    throw new CliError(`Harness file not found: ${harnessPath}`, ExitCode.notFound);
  }

  const citedPaths = new Set<string>([harnessPath]);
  const harness = await loadDocument(absoluteHarnessPath);
  context.stdout('Harness report');
  context.stdout(`- harness: ${harnessPath}`);
  if (isObject(harness)) {
    const harnessBlock = getObject(harness, 'harness');
    const name = harnessBlock === undefined ? undefined : getString(harnessBlock, 'name');
    if (name !== undefined) {
      context.stdout(`- name: ${name}`);
    }
    const references = [
      ...new Set(collectHarnessReferences(harness).map((reference) => reference.path)),
    ];
    if (references.length > 0) {
      context.stdout('- artifacts:');
      for (const reference of references) {
        citedPaths.add(reference);
        context.stdout(`  - ${reference}`);
      }
    }
  }

  await summarizeOptionalArtifact(
    root,
    options,
    'verification',
    'verification',
    citedPaths,
    context,
  );
  await summarizeOptionalArtifact(root, options, 'run-result', 'run result', citedPaths, context);
  await summarizeOptionalArtifact(root, options, 'trace', 'trace', citedPaths, context);
  await summarizeOptionalArtifact(
    root,
    options,
    'doctor-result',
    'doctor result',
    citedPaths,
    context,
  );

  context.stdout('- cited paths:');
  for (const path of [...citedPaths].sort()) {
    context.stdout(`  - ${path}`);
  }
  return ExitCode.ok;
}

async function summarizeOptionalArtifact(
  root: string,
  options: ReturnType<typeof parseOptions>,
  optionName: string,
  label: string,
  citedPaths: Set<string>,
  context: CommandContext,
): Promise<void> {
  const artifactPath = optionValue(options, optionName);
  if (artifactPath === undefined) {
    return;
  }
  const absolutePath = resolveInsideRoot(root, artifactPath, `${label} artifact`);
  if ((await pathKind(absolutePath)) !== 'file') {
    throw new CliError(`${label} artifact not found: ${artifactPath}`, ExitCode.notFound);
  }
  const artifact = await loadDocument(absolutePath);
  citedPaths.add(artifactPath);
  context.stdout(`- ${label}: ${artifactPath}`);
  if (isObject(artifact)) {
    const status = getString(artifact, 'status');
    if (status !== undefined) {
      context.stdout(`  status: ${status}`);
    }
    const acceptanceChecks = getArray(artifact, 'acceptance_checks');
    if (acceptanceChecks !== undefined) {
      context.stdout(`  acceptance checks: ${acceptanceChecks.length}`);
    }
  }
}
