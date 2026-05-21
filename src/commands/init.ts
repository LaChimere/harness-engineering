import { join } from 'node:path';

import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import {
  assertNoSymlinkWithinRoot,
  copyFileNoFollowCreatingDirectories,
  ensureDirectory,
  ensureDirectoryInsideRoot,
  pathExists,
  writeTextNoFollowCreatingDirectories,
} from '../lib/files.ts';
import { hasFlag, optionValue, parseOptions } from '../lib/options.ts';
import { resolveRootForWriteCommand } from '../lib/paths.ts';

export interface CommandContext {
  readonly cwd: string;
  readonly packageRoot: string;
  readonly stdout: (message: string) => void;
}

const valueOptions = new Set(['root']);
const flagOptions = new Set(['force']);

const starterFiles = [
  'examples/harness.yaml',
  'examples/failure-taxonomy.yaml',
  'examples/environments/local.yaml',
  'examples/policies/approval-policy.yaml',
  'examples/policies/sandbox-policy.yaml',
  'examples/model-profiles/stub.yaml',
  'examples/agent-runners/stub.yaml',
  'examples/checks/doc-links.yaml',
  'examples/prompts/stub-task.md',
  'examples/traces/native-cli-trace.json',
  'examples/evals/harness-self-test/v1.0.0/task.yaml',
  'examples/evals/harness-self-test/v1.0.0/oracle.txt',
  'examples/evals/harness-self-test/v1.0.0/broken-twin.txt',
] as const;

const starterDirectories = [
  '.harness/traces',
  '.harness/continuity',
  '.harness/handoffs',
  '.harness/gc',
  '.harness/doctor',
  '.harness/verifier-results',
  '.harness/approvals',
] as const;

export async function runInit(args: readonly string[], context: CommandContext): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 0) {
    throw new CliError('init does not accept positional arguments.', ExitCode.usageError);
  }

  const root = resolveRootForWriteCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const force = hasFlag(options, 'force');
  const managedTargets = ['harness.yaml', ...starterFiles, '.harness/run-results.jsonl'];
  if (!force) {
    const collisions: string[] = [];
    for (const target of managedTargets) {
      if (await pathExists(join(root, target))) {
        collisions.push(target);
      }
    }
    if (collisions.length > 0) {
      throw new CliError(
        `Refusing to overwrite existing harness starter files: ${collisions.join(', ')}. Use --force to replace them.`,
        ExitCode.usageError,
      );
    }
  }

  const created: string[] = [];
  await ensureDirectory(root);
  await copyFileNoFollowCreatingDirectories(
    root,
    join(context.packageRoot, 'examples/harness.yaml'),
    join(root, 'harness.yaml'),
  );
  created.push('harness.yaml');

  for (const starterFile of starterFiles) {
    const target = join(root, starterFile);
    await copyFileNoFollowCreatingDirectories(root, join(context.packageRoot, starterFile), target);
    created.push(starterFile);
  }

  for (const directory of starterDirectories) {
    const target = join(root, directory);
    await ensureDirectoryInsideRoot(root, target);
    created.push(`${directory}/`);
  }

  await writeTextNoFollowCreatingDirectories(root, join(root, '.harness/run-results.jsonl'), '');
  created.push('.harness/run-results.jsonl');

  await writeIfMissing(root, 'README.md', '# Harness-enabled project\n');
  await writeIfMissing(
    root,
    'AGENTS.md',
    '# Agent instructions\n\nUse `harness.yaml` as the harness source of truth.\n',
  );

  context.stdout(`harness init ok: created ${created.length} starter artifacts`);
  for (const path of created) {
    context.stdout(`  ${path}`);
  }
  return ExitCode.ok;
}

async function writeIfMissing(root: string, path: string, text: string): Promise<void> {
  const target = join(root, path);
  if (await pathExists(target)) {
    return;
  }
  await assertNoSymlinkWithinRoot(root, target);
  await writeTextNoFollowCreatingDirectories(root, target, text);
}
