import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CliError } from '../lib/errors.ts';
import { computeEvalTaskDatasetHash } from '../lib/eval.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import {
  assertNoSymlinkWithinRoot,
  ensureDirectory,
  ensureDirectoryInsideRoot,
  loadDocument,
  pathExists,
  writeTextNoFollowCreatingDirectories,
} from '../lib/files.ts';
import { isObject } from '../lib/json.ts';
import { hasFlag, optionValue, parseOptions } from '../lib/options.ts';
import { resolveRootForWriteCommand } from '../lib/paths.ts';

export interface ICommandContext {
  readonly cwd: string;
  readonly packageRoot: string;
  readonly stdout: (message: string) => void;
}

const valueOptions = new Set(['root']);
const flagOptions = new Set(['force']);

const starterFiles: ReadonlyArray<{ readonly source: string; readonly target: string }> = [
  { source: 'examples/failure-taxonomy.yaml', target: '.harness/taxonomies/failure-taxonomy.yaml' },
  { source: 'examples/environments/local.yaml', target: '.harness/environments/local.yaml' },
  {
    source: 'examples/policies/approval-policy.yaml',
    target: '.harness/policies/approval-policy.yaml',
  },
  {
    source: 'examples/policies/sandbox-policy.yaml',
    target: '.harness/policies/sandbox-policy.yaml',
  },
  { source: 'examples/profiles/gc-stability.yaml', target: '.harness/profiles/gc-stability.yaml' },
  { source: 'examples/judges/policy.yaml', target: '.harness/judges/policy.yaml' },
  {
    source: 'examples/run-results/run-result.json',
    target: '.harness/judges/calibration/run-result.json',
  },
  {
    source: 'examples/run-results/failed-run-result.json',
    target: '.harness/judges/calibration/failed-run-result.json',
  },
  {
    source: 'examples/verifier-results/schema-smoke.json',
    target: '.harness/judges/calibration/verifier-results/schema-smoke.json',
  },
  {
    source: 'examples/verifier-results/schema-smoke-failed.json',
    target: '.harness/judges/calibration/verifier-results/schema-smoke-failed.json',
  },
  {
    source: 'examples/scoreboards/self-test.json',
    target: '.harness/judges/calibration/scoreboard-self-test.json',
  },
  { source: 'examples/checks/doc-links.yaml', target: '.harness/checks/doc-links.yaml' },
  {
    source: 'examples/traces/recorded-external-trace.json',
    target: '.harness/traces/samples/recorded-external-trace.json',
  },
  {
    source: 'examples/traces/external-import.json',
    target: '.harness/traces/samples/external-import.json',
  },
  {
    source: 'examples/evals/harness-self-test/v1.0.0/task.yaml',
    target: '.harness/evals/harness-self-test/v1.0.0/task.yaml',
  },
  {
    source: 'examples/evals/harness-self-test/v1.0.0/oracle.txt',
    target: '.harness/evals/harness-self-test/v1.0.0/oracle.txt',
  },
  {
    source: 'examples/evals/harness-self-test/v1.0.0/broken-twin.txt',
    target: '.harness/evals/harness-self-test/v1.0.0/broken-twin.txt',
  },
] as const;

const starterDirectories = [
  '.harness/outputs/traces',
  '.harness/outputs/continuity',
  '.harness/outputs/handoffs',
  '.harness/outputs/gc',
  '.harness/outputs/doctor',
  '.harness/outputs/health',
  '.harness/outputs/profile-runs',
  '.harness/outputs/verifier-results',
  '.harness/outputs/scoreboards',
  '.harness/outputs/approvals',
  '.harness/outputs/reports',
] as const;

const targetEvalTaskPath = '.harness/evals/harness-self-test/v1.0.0/task.yaml';
const starterGitignorePath = '.harness/.gitignore';
const starterGitignore = `# Commit harness.yaml and editable .harness support files.
# Generated evidence and runtime artifacts live under outputs/.
/outputs/
`;

const starterPathReplacements: ReadonlyArray<readonly [string, string]> = [
  ['examples/evals/harness-self-test/v1.0.0/', '.harness/evals/harness-self-test/v1.0.0/'],
  ['examples/failure-taxonomy.yaml', '.harness/taxonomies/failure-taxonomy.yaml'],
  ['examples/environments/local.yaml', '.harness/environments/local.yaml'],
  ['examples/policies/approval-policy.yaml', '.harness/policies/approval-policy.yaml'],
  ['examples/policies/sandbox-policy.yaml', '.harness/policies/sandbox-policy.yaml'],
  ['examples/profiles/gc-stability.yaml', '.harness/profiles/gc-stability.yaml'],
  ['examples/judges/policy.yaml', '.harness/judges/policy.yaml'],
  ['examples/run-results/run-result.json', '.harness/judges/calibration/run-result.json'],
  [
    'examples/run-results/failed-run-result.json',
    '.harness/judges/calibration/failed-run-result.json',
  ],
  [
    'examples/verifier-results/schema-smoke.json',
    '.harness/judges/calibration/verifier-results/schema-smoke.json',
  ],
  [
    'examples/verifier-results/schema-smoke-failed.json',
    '.harness/judges/calibration/verifier-results/schema-smoke-failed.json',
  ],
  ['examples/scoreboards/self-test.json', '.harness/judges/calibration/scoreboard-self-test.json'],
  ['examples/harness.yaml', 'harness.yaml'],
  ['examples/checks/doc-links.yaml', '.harness/checks/doc-links.yaml'],
  [
    'examples/traces/recorded-external-trace.json',
    '.harness/traces/samples/recorded-external-trace.json',
  ],
  ['examples/traces/external-import.json', '.harness/traces/samples/external-import.json'],
  ['trace_output: .harness/traces', 'trace_output: .harness/outputs/traces'],
  ['output_dir: .harness/traces', 'output_dir: .harness/outputs/traces'],
  [
    'destination_hint: .harness/profiles/gc-stability.json',
    'destination_hint: .harness/outputs/profile-runs/gc-stability.json',
  ],
  [
    'destination_hint: examples/profile-runs/gc-stability.json',
    'destination_hint: .harness/outputs/profile-runs/gc-stability.json',
  ],
  ['    - examples/gc\n', '    - .harness/outputs/gc\n'],
  ['    - examples/health/results\n', '    - .harness/outputs/health\n'],
  ['    - examples/profile-runs\n', '    - .harness/outputs/profile-runs\n'],
  ['    - .harness/profiles\n', '    - .harness/outputs/profile-runs\n'],
  ['output_dir: .harness/profiles', 'output_dir: .harness/outputs/profile-runs'],
  ['.harness/run-results.jsonl', '.harness/outputs/run-results.jsonl'],
  ['.harness/verifier-results', '.harness/outputs/verifier-results'],
  ['.harness/scoreboards', '.harness/outputs/scoreboards'],
  ['.harness/doctor', '.harness/outputs/doctor'],
  ['.harness/health', '.harness/outputs/health'],
  ['.harness/gc', '.harness/outputs/gc'],
  ['.harness/continuity', '.harness/outputs/continuity'],
  ['.harness/handoffs', '.harness/outputs/handoffs'],
  ['.harness/approvals', '.harness/outputs/approvals'],
];

export async function runInit(
  args: readonly string[],
  context: ICommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 0) {
    throw new CliError('init does not accept positional arguments.', ExitCode.usageError);
  }

  const root = resolveRootForWriteCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const force = hasFlag(options, 'force');
  const managedTargets = [
    'harness.yaml',
    starterGitignorePath,
    ...starterFiles.map((starterFile) => starterFile.target),
    '.harness/outputs/run-results.jsonl',
  ];
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
  await writeStarterFile(root, context.packageRoot, 'examples/harness.yaml', 'harness.yaml');
  created.push('harness.yaml');

  for (const starterFile of starterFiles) {
    await writeStarterFile(root, context.packageRoot, starterFile.source, starterFile.target);
    created.push(starterFile.target);
  }

  await refreshEvalTaskDatasetHash(root);
  await assertNoExamplesReferencesInStarterFiles(root);

  for (const directory of starterDirectories) {
    const target = join(root, directory);
    await ensureDirectoryInsideRoot(root, target);
    created.push(`${directory}/`);
  }

  await writeTextNoFollowCreatingDirectories(
    root,
    join(root, '.harness/outputs/run-results.jsonl'),
    '',
  );
  created.push('.harness/outputs/run-results.jsonl');
  await writeTextNoFollowCreatingDirectories(
    root,
    join(root, starterGitignorePath),
    starterGitignore,
  );
  created.push(starterGitignorePath);

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
  context.stdout(
    '  note: commit harness.yaml and editable .harness support files; generated evidence is ignored under .harness/outputs/.',
  );
  if (await rootGitignoreIgnoresHarness(root)) {
    context.stdout(
      '  warning: root .gitignore appears to ignore .harness/ wholesale; adjust it so .harness support files can be committed while .harness/outputs/ stays ignored.',
    );
  }

  async function writeStarterFile(
    root: string,
    packageRoot: string,
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    const sourceText = await readFile(join(packageRoot, sourcePath), 'utf8');
    await writeTextNoFollowCreatingDirectories(
      root,
      join(root, targetPath),
      transformStarterPaths(sourceText),
    );
  }

  function transformStarterPaths(text: string): string {
    let transformed = text;
    for (const [from, to] of starterPathReplacements) {
      transformed = transformed.split(from).join(to);
    }
    return transformed;
  }

  async function refreshEvalTaskDatasetHash(root: string): Promise<void> {
    const absoluteTaskPath = join(root, targetEvalTaskPath);
    const task = await loadDocument(absoluteTaskPath);
    if (!isObject(task)) {
      throw new CliError('Starter eval task must be an object.', ExitCode.internalError);
    }
    const datasetHash = await computeEvalTaskDatasetHash(root, task);
    const text = await readFile(absoluteTaskPath, 'utf8');
    const updated = text.replace(/^dataset_hash: .+$/m, `dataset_hash: ${datasetHash}`);
    if (updated === text) {
      throw new CliError(
        `Starter eval task missing replaceable dataset_hash line: ${targetEvalTaskPath}`,
        ExitCode.internalError,
      );
    }
    await writeTextNoFollowCreatingDirectories(root, absoluteTaskPath, updated);
  }
  return ExitCode.ok;
}

async function assertNoExamplesReferencesInStarterFiles(root: string): Promise<void> {
  const checkedTargets = ['harness.yaml', ...starterFiles.map((starterFile) => starterFile.target)];
  const examplesOffenders: string[] = [];
  const flatOutputOffenders: string[] = [];
  for (const target of checkedTargets) {
    const text = await readFile(join(root, target), 'utf8');
    if (text.includes('examples/')) {
      examplesOffenders.push(target);
    }
    if (flatHarnessOutputPathPattern.test(text)) {
      flatOutputOffenders.push(target);
    }
  }
  const issues = [
    ...(examplesOffenders.length === 0
      ? []
      : [`examples/ references in: ${examplesOffenders.join(', ')}`]),
    ...(flatOutputOffenders.length === 0
      ? []
      : [`legacy flat .harness output references in: ${flatOutputOffenders.join(', ')}`]),
  ];
  if (issues.length > 0) {
    throw new CliError(
      `Starter path transformation left stale references: ${issues.join('; ')}`,
      ExitCode.internalError,
    );
  }
}

const flatHarnessOutputPathPattern =
  /\.harness\/(?:(?:traces(?!\/samples))|verifier-results|scoreboards|doctor|health|gc|continuity|handoffs|approvals|run-results(?:\.jsonl)?)(?:\/|["'\s]|$)|\.harness\/profiles(?:\/[^"'\s]+\.json|\/?(?=["'\s]|$))/;

async function rootGitignoreIgnoresHarness(root: string): Promise<boolean> {
  const gitignorePath = join(root, '.gitignore');
  if (!(await pathExists(gitignorePath))) {
    return false;
  }
  const gitignore = await readFile(gitignorePath, 'utf8');
  return gitignore.split(/\r?\n/).some(gitignoreLineIgnoresHarnessSupportFiles);
}

function gitignoreLineIgnoresHarnessSupportFiles(rawLine: string): boolean {
  const line = rawLine.replace(/#.*/, '').trim();
  if (line.length === 0 || line.startsWith('!')) {
    return false;
  }
  const normalized = line.replace(/^\*\*\//, '').replace(/^\//, '');
  return (
    normalized === '.harness' ||
    normalized === '.harness/' ||
    normalized === '.harness/*' ||
    normalized === '.harness/**' ||
    normalized === '.*' ||
    normalized === '.*/' ||
    normalized.startsWith('.harness*')
  );
}

async function writeIfMissing(root: string, path: string, text: string): Promise<void> {
  const target = join(root, path);
  if (await pathExists(target)) {
    return;
  }
  await assertNoSymlinkWithinRoot(root, target);
  await writeTextNoFollowCreatingDirectories(root, target, text);
}
