import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const approvedSkills = [
  'harness-quickstart',
  'harness-doctor',
  'harness-health',
  'harness-assess',
  'harness-evidence-loop',
  'harness-gc-review',
  'harness-profile',
] as const;

type SkillId = (typeof approvedSkills)[number];
type InvocationPolicy = 'user-or-model' | 'explicit-user-intent';

export interface ILintFinding {
  readonly path: string;
  readonly line: number;
  readonly ruleId: string;
  readonly message: string;
}

interface ISkillFile {
  readonly id: SkillId;
  readonly path: string;
  readonly text: string;
}

interface IFrontmatter {
  readonly values: ReadonlyMap<string, string>;
  readonly bodyStartLine: number;
  readonly invalidLine?: number;
}

interface IForbiddenRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly message: string;
}

const skillRoot = 'skills';
const readmePath = join(skillRoot, 'README.md');
const skillFileName = 'SKILL.md';
const requiredSections = ['Purpose', 'Invocation', 'Steps', 'Safety'] as const;
const ignoreMarkerPattern =
  /^<!--\s*harness-skill-lint-ignore\s+([a-z0-9-]+):\s*(\S(?:.*\S)?)\s*-->$/;

const expectedInvocationPolicies: Readonly<Record<SkillId, InvocationPolicy>> = {
  ['harness-quickstart']: 'user-or-model',
  ['harness-doctor']: 'user-or-model',
  ['harness-health']: 'explicit-user-intent',
  ['harness-assess']: 'user-or-model',
  ['harness-evidence-loop']: 'user-or-model',
  ['harness-gc-review']: 'user-or-model',
  ['harness-profile']: 'user-or-model',
};

const forbiddenRules: readonly IForbiddenRule[] = [
  {
    id: 'generated-output-redirect',
    pattern: />\s*\.?\.harness\/outputs\//,
    message: 'Do not redirect shell output into generated evidence paths.',
  },
  {
    id: 'generated-output-tee',
    pattern: /\btee\s+\.?\.harness\/outputs\//,
    message: 'Do not tee shell output into generated evidence paths.',
  },
  {
    id: 'direct-model-execution',
    pattern: /\b(?:openai\.chat|anthropic\.messages|model\.generate)\b/,
    message: 'Skills must not call provider/model APIs directly.',
  },
  {
    id: 'manual-generated-evidence-write',
    pattern: /\b(?:echo|cat)\b.*>\s*.*\.harness\/outputs\//,
    message: 'Do not hand-write generated evidence artifacts.',
  },
  {
    id: 'next-actions',
    pattern: /\bnext_actions\b/,
    message: 'Skills must derive next steps from evidence rather than next_actions.',
  },
  {
    id: 'universal-success-field',
    pattern: /"success"\s*:/,
    message: 'Skills must use command-specific status fields, not a universal success flag.',
  },
  {
    id: 'agent-facing-validate',
    pattern: /\bharness\s+validate\b/,
    message: 'Agent-facing structural inspection must use harness doctor, not harness validate.',
  },
  {
    id: 'aggregate-loop-run',
    pattern: /\bharness\s+loop\s+run\b/,
    message: 'Skills must not invent or depend on a harness loop run aggregate command.',
  },
  {
    id: 'invented-evidence-loop-command',
    pattern: /\bharness\s+evidence-loop\b/,
    message: 'Skills must sequence existing commands rather than invent harness evidence-loop.',
  },
];

const allowedHarnessCommands = new Set([
  'adapter',
  'assess',
  'doctor',
  'eval',
  'gc',
  'health',
  'init',
  'loop',
  'migrate',
  'profile',
  'report',
  'trace',
  'validate',
  'verify',
  'version',
]);

const allowedHarnessSubcommands: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['adapter', new Set(['validate'])],
  ['eval', new Set(['validate'])],
  ['gc', new Set(['audit', 'validate'])],
  ['loop', new Set(['validate'])],
  ['profile', new Set(['validate', 'run'])],
  ['trace', new Set(['validate', 'import'])],
]);

export async function lintSkills(root = process.cwd()): Promise<ILintFinding[]> {
  const findings: ILintFinding[] = [];
  findings.push(...(await lintSkillTree(root)));
  findings.push(...(await lintReadme(root)));
  const skillFiles = await loadSkillFiles(root);
  findings.push(...skillFiles.findings);
  for (const skill of skillFiles.files) {
    findings.push(...lintSkillFile(skill));
  }
  return findings.sort((left, right) =>
    `${left.path}:${left.line}:${left.ruleId}`.localeCompare(
      `${right.path}:${right.line}:${right.ruleId}`,
    ),
  );
}

export function lintSkillText(path: string, id: SkillId, text: string): ILintFinding[] {
  return lintSkillFile({ id, path, text });
}

async function lintSkillTree(root: string): Promise<ILintFinding[]> {
  const findings: ILintFinding[] = [];
  const entries = await readdir(join(root, skillRoot), { withFileTypes: true });
  const foundSkillDirs = new Set<string>();

  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'README.md') {
      continue;
    }
    if (!entry.isDirectory()) {
      findings.push(
        finding(
          join(skillRoot, entry.name),
          1,
          'unexpected-skill-root-entry',
          'Only README.md and approved skill directories may live under skills/.',
        ),
      );
      continue;
    }
    foundSkillDirs.add(entry.name);
    if (!isSkillId(entry.name)) {
      findings.push(
        finding(
          join(skillRoot, entry.name),
          1,
          'unknown-skill',
          `Unexpected skill directory ${entry.name}.`,
        ),
      );
      continue;
    }
    const skillEntries = await readdir(join(root, skillRoot, entry.name), { withFileTypes: true });
    let hasSkillFile = false;
    for (const skillEntry of skillEntries) {
      if (skillEntry.isFile() && skillEntry.name === skillFileName) {
        hasSkillFile = true;
        continue;
      }
      findings.push(
        finding(
          join(skillRoot, entry.name, skillEntry.name),
          1,
          'unexpected-skill-file',
          'Skill directories may contain only SKILL.md.',
        ),
      );
    }
    if (!hasSkillFile) {
      findings.push(
        finding(
          join(skillRoot, entry.name, skillFileName),
          1,
          'missing-skill-file',
          `${entry.name} must contain SKILL.md.`,
        ),
      );
    }
  }

  for (const id of approvedSkills) {
    if (!foundSkillDirs.has(id)) {
      findings.push(finding(join(skillRoot, id), 1, 'missing-skill', `Missing ${id}.`));
    }
  }
  return findings;
}

async function lintReadme(root: string): Promise<ILintFinding[]> {
  const path = readmePath;
  let text: string;
  try {
    text = await readFile(join(root, path), 'utf8');
  } catch {
    return [finding(path, 1, 'missing-readme', 'skills/README.md is required.')];
  }
  const findings: ILintFinding[] = [];
  for (const section of [
    'Canonical skill structure',
    'Invocation policies',
    'Safety rules',
    'Evidence citation',
    'Lint rules',
  ]) {
    if (!text.includes(`## ${section}`)) {
      findings.push(finding(path, 1, 'missing-readme-section', `README missing ## ${section}.`));
    }
  }
  return findings;
}

async function loadSkillFiles(
  root: string,
): Promise<{ readonly files: readonly ISkillFile[]; readonly findings: readonly ILintFinding[] }> {
  const files: ISkillFile[] = [];
  const findings: ILintFinding[] = [];
  for (const id of approvedSkills) {
    const path = join(skillRoot, id, skillFileName);
    try {
      files.push({
        id,
        path,
        text: await readFile(join(root, path), 'utf8'),
      });
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        continue;
      }
      findings.push(finding(path, 1, 'unreadable-skill-file', `Unable to read ${path}.`));
    }
  }
  return { files, findings };
}

function lintSkillFile(skill: ISkillFile): ILintFinding[] {
  const findings: ILintFinding[] = [];
  const frontmatter = parseFrontmatter(skill.text);
  if (frontmatter === undefined) {
    findings.push(
      finding(skill.path, 1, 'missing-frontmatter', 'Skill file must start with YAML frontmatter.'),
    );
  } else {
    findings.push(...lintFrontmatter(skill, frontmatter));
  }
  findings.push(...lintRequiredSections(skill.path, skill.text));
  findings.push(...lintForbiddenPatterns(skill.path, skill.text));
  findings.push(...lintHarnessCommands(skill.path, skill.text));
  return findings;
}

function parseFrontmatter(text: string): IFrontmatter | undefined {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') {
    return undefined;
  }
  const values = new Map<string, string>();
  let invalidLine: number | undefined;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '---') {
      return {
        values,
        bodyStartLine: index + 2,
        ...(invalidLine === undefined ? {} : { invalidLine }),
      };
    }
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line ?? '');
    if (match === null) {
      if (line?.trim() !== '') {
        invalidLine ??= index + 1;
      }
      continue;
    }
    const [, key, rawValue] = match;
    if (key !== undefined && rawValue !== undefined) {
      values.set(key, rawValue.replace(/^"|"$/g, '').trim());
    }
  }
  return undefined;
}

function lintFrontmatter(skill: ISkillFile, frontmatter: IFrontmatter): ILintFinding[] {
  const findings: ILintFinding[] = [];
  if (frontmatter.invalidLine !== undefined) {
    findings.push(
      finding(
        skill.path,
        frontmatter.invalidLine,
        'frontmatter-invalid-line',
        'Frontmatter supports simple key/value lines before the closing delimiter.',
      ),
    );
  }
  const required = ['id', 'purpose', 'invocation_policy', 'version'] as const;
  for (const key of required) {
    const value = frontmatter.values.get(key);
    if (value === undefined || value.length === 0) {
      findings.push(
        finding(skill.path, 1, 'frontmatter-required', `Missing frontmatter key ${key}.`),
      );
    }
  }
  if (frontmatter.values.get('id') !== skill.id) {
    findings.push(finding(skill.path, 1, 'frontmatter-id', `Frontmatter id must be ${skill.id}.`));
  }
  const policy = frontmatter.values.get('invocation_policy');
  if (policy !== 'user-or-model' && policy !== 'explicit-user-intent') {
    findings.push(
      finding(
        skill.path,
        1,
        'frontmatter-invocation-policy',
        'invocation_policy must be user-or-model or explicit-user-intent.',
      ),
    );
  } else if (policy !== expectedInvocationPolicies[skill.id]) {
    findings.push(
      finding(
        skill.path,
        1,
        'frontmatter-invocation-policy',
        `${skill.id} invocation_policy must be ${expectedInvocationPolicies[skill.id]}.`,
      ),
    );
  }
  const version = frontmatter.values.get('version');
  if (version !== undefined && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
    findings.push(finding(skill.path, 1, 'frontmatter-version', 'version must be semver-like.'));
  }
  const requiresApproval = frontmatter.values.get('requires_approval');
  if (
    requiresApproval !== undefined &&
    requiresApproval !== 'true' &&
    requiresApproval !== 'false'
  ) {
    findings.push(
      finding(
        skill.path,
        1,
        'frontmatter-requires-approval',
        'requires_approval must be true or false.',
      ),
    );
  }
  if (skill.id === 'harness-health' && frontmatter.values.get('requires_approval') !== 'true') {
    findings.push(
      finding(
        skill.path,
        1,
        'frontmatter-requires-approval',
        'harness-health must require approval.',
      ),
    );
  }
  return findings;
}

function lintRequiredSections(path: string, text: string): ILintFinding[] {
  const findings: ILintFinding[] = [];
  for (const section of requiredSections) {
    if (!new RegExp(`^## ${escapeRegExp(section)}$`, 'm').test(text)) {
      findings.push(finding(path, 1, 'missing-section', `Missing ## ${section}.`));
    }
  }
  return findings;
}

function lintForbiddenPatterns(path: string, text: string): ILintFinding[] {
  const findings: ILintFinding[] = [];
  const lines = text.split(/\r?\n/);
  const ignoreMarkers = collectIgnoreMarkers(path, lines, findings);
  const usedMarkers = new Set<string>();

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.includes('harness-skill-lint-ignore')) {
      continue;
    }
    for (const rule of forbiddenRules) {
      if (!rule.pattern.test(line)) {
        continue;
      }
      const markerKey = markerId(lineNumber, rule.id);
      if (ignoreMarkers.has(markerKey)) {
        usedMarkers.add(markerKey);
        continue;
      }
      findings.push(finding(path, lineNumber, rule.id, rule.message));
    }
  }

  for (const markerKey of ignoreMarkers.keys()) {
    if (!usedMarkers.has(markerKey)) {
      const [lineNumberText, ruleId] = markerKey.split(':');
      findings.push(
        finding(
          path,
          Number(lineNumberText) - 1,
          'unused-ignore',
          `Ignore marker for ${ruleId ?? 'unknown'} did not match a violation on the next line.`,
        ),
      );
    }
  }
  return findings;
}

function collectIgnoreMarkers(
  path: string,
  lines: readonly string[],
  findings: ILintFinding[],
): ReadonlyMap<string, true> {
  const markers = new Map<string, true>();
  for (const [index, line] of lines.entries()) {
    if (!line.includes('harness-skill-lint-ignore')) {
      continue;
    }
    const match = ignoreMarkerPattern.exec(line.trim());
    const lineNumber = index + 1;
    if (match === null) {
      findings.push(
        finding(
          path,
          lineNumber,
          'invalid-ignore',
          'Ignore marker must be <!-- harness-skill-lint-ignore <rule-id>: <reason> -->.',
        ),
      );
      continue;
    }
    const [, ruleId, reason] = match;
    if (ruleId === undefined || reason === undefined || reason.trim().length < 3) {
      findings.push(
        finding(path, lineNumber, 'invalid-ignore', 'Ignore marker requires a reason.'),
      );
      continue;
    }
    if (!forbiddenRules.some((rule) => rule.id === ruleId)) {
      findings.push(finding(path, lineNumber, 'invalid-ignore', `Unknown ignore rule ${ruleId}.`));
      continue;
    }
    markers.set(markerId(lineNumber + 1, ruleId), true);
  }
  return markers;
}

function lintHarnessCommands(path: string, text: string): ILintFinding[] {
  const findings: ILintFinding[] = [];
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    const pattern =
      /`harness\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?|^\s*harness\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/g;
    for (const match of line.matchAll(pattern)) {
      const command = match[1] ?? match[3];
      const subcommand = match[2] ?? match[4];
      if (command === undefined) {
        continue;
      }
      if (allowedHarnessCommands.has(command)) {
        const allowedSubcommands = allowedHarnessSubcommands.get(command);
        if (allowedSubcommands === undefined && subcommand === undefined) {
          continue;
        }
        if (allowedSubcommands === undefined && subcommand !== undefined) {
          findings.push(
            finding(
              path,
              lineIndex + 1,
              'unknown-harness-subcommand',
              `Command harness ${command} does not accept subcommand ${subcommand}.`,
            ),
          );
          continue;
        }
        if (allowedSubcommands !== undefined && subcommand === undefined) {
          findings.push(
            finding(
              path,
              lineIndex + 1,
              'missing-harness-subcommand',
              `Command harness ${command} requires an explicit subcommand.`,
            ),
          );
          continue;
        }
        if (subcommand !== undefined && allowedSubcommands?.has(subcommand) === true) {
          continue;
        }
        findings.push(
          finding(
            path,
            lineIndex + 1,
            'unknown-harness-subcommand',
            `Unknown harness ${command} subcommand ${subcommand}.`,
          ),
        );
        continue;
      }
      findings.push(
        finding(
          path,
          lineIndex + 1,
          'unknown-harness-command',
          `Unknown harness command ${command}.`,
        ),
      );
    }
  }
  return findings;
}

function finding(path: string, line: number, ruleId: string, message: string): ILintFinding {
  return { path: path.replaceAll('\\', '/'), line, ruleId, message };
}

function markerId(lineNumber: number, ruleId: string): string {
  return `${lineNumber}:${ruleId}`;
}

function isSkillId(value: string): value is SkillId {
  return (approvedSkills as readonly string[]).includes(value);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const findings = await lintSkills(root);
  if (findings.length > 0) {
    for (const item of findings) {
      console.error(
        `${relative(root, join(root, item.path))}:${item.line} ${item.ruleId}: ${item.message}`,
      );
    }
    process.exit(1);
  }
}
