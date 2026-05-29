import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const canonicalSkillDir = 'skills';
const claudePluginDir = 'plugins/claude-code';
const packagedSkillDir = `${claudePluginDir}/skills`;
const skillFileName = 'SKILL.md';
const manifestPath = `${claudePluginDir}/skill-hashes.json`;
const normalizationId = 'claude-code-skill-prelude-v1';

export interface IParityFinding {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

interface ISkillHashManifest {
  readonly ['schema_version']: string;
  readonly host: string;
  readonly normalization: string;
  readonly skills: readonly ISkillHashRecord[];
}

interface ISkillHashRecord {
  readonly id: string;
  readonly ['canonical_path']: string;
  readonly ['packaged_path']: string;
  readonly ['canonical_sha256']: string;
  readonly ['packaged_normalized_sha256']: string;
}

interface ISkillPair {
  readonly id: string;
  readonly canonicalPath: string;
  readonly packagedPath: string;
  readonly canonicalText: string;
  readonly packagedText: string;
}

export async function checkSkillParity(root = process.cwd()): Promise<IParityFinding[]> {
  const findings: IParityFinding[] = [];
  const manifest = await loadManifest(root, findings);
  const skillPairs = await loadSkillPairs(root, findings);
  const canonicalIds = new Set(skillPairs.map((pair) => pair.id));
  const recordsById = new Map((manifest?.skills ?? []).map((record) => [record.id, record]));

  if (manifest !== undefined) {
    if (manifest['schema_version'] !== '0.1.0') {
      findings.push(
        finding(
          manifestPath,
          'manifest-schema-version',
          'skill-hashes schema_version must be 0.1.0.',
        ),
      );
    }
    if (manifest.host !== 'claude-code') {
      findings.push(
        finding(manifestPath, 'manifest-host', 'skill-hashes host must be claude-code.'),
      );
    }
    if (manifest.normalization !== normalizationId) {
      findings.push(
        finding(
          manifestPath,
          'manifest-normalization',
          `skill-hashes normalization must be ${normalizationId}.`,
        ),
      );
    }
  }

  for (const pair of skillPairs) {
    const normalized = normalizeClaudeSkill(
      pair.packagedText,
      pair.id,
      pair.packagedPath,
      findings,
    );
    if (normalized !== pair.canonicalText) {
      findings.push(
        finding(
          pair.packagedPath,
          'packaged-skill-drift',
          `Packaged skill body differs from canonical ${pair.canonicalPath}.`,
        ),
      );
    }
    const record = recordsById.get(pair.id);
    if (record === undefined) {
      findings.push(
        finding(manifestPath, 'manifest-missing-skill', `Missing hash record for ${pair.id}.`),
      );
      continue;
    }
    const canonicalHash = sha256(pair.canonicalText);
    const packagedHash = sha256(normalized);
    if (record['canonical_path'] !== pair.canonicalPath) {
      findings.push(finding(manifestPath, 'manifest-path', `${pair.id} canonical_path is stale.`));
    }
    if (record['packaged_path'] !== pair.packagedPath) {
      findings.push(finding(manifestPath, 'manifest-path', `${pair.id} packaged_path is stale.`));
    }
    if (record['canonical_sha256'] !== canonicalHash) {
      findings.push(
        finding(manifestPath, 'manifest-hash', `${pair.id} canonical_sha256 is stale.`),
      );
    }
    if (record['packaged_normalized_sha256'] !== packagedHash) {
      findings.push(
        finding(manifestPath, 'manifest-hash', `${pair.id} packaged_normalized_sha256 is stale.`),
      );
    }
  }

  const seenRecordIds = new Set<string>();
  for (const record of manifest?.skills ?? []) {
    if (seenRecordIds.has(record.id)) {
      findings.push(
        finding(
          manifestPath,
          'manifest-duplicate-skill',
          `Duplicate hash record for ${record.id}.`,
        ),
      );
    }
    seenRecordIds.add(record.id);
    if (!skillPairs.some((pair) => pair.id === record.id)) {
      findings.push(
        finding(manifestPath, 'manifest-extra-skill', `Extra hash record for ${record.id}.`),
      );
    }
  }
  for (const id of await loadPackagedSkillIds(root, findings)) {
    if (!canonicalIds.has(id)) {
      findings.push(
        finding(
          `${packagedSkillDir}/${id}/${skillFileName}`,
          'packaged-extra-skill',
          `Packaged skill ${id} has no canonical counterpart.`,
        ),
      );
    }
  }

  return findings.sort((left, right) =>
    `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`),
  );
}

export function normalizeClaudeSkill(
  text: string,
  expectedId: string,
  path: string,
  findings: IParityFinding[] = [],
): string {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') {
    findings.push(
      finding(path, 'claude-prelude', 'Claude packaged skill must start with host prelude.'),
    );
    return text;
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  if (endIndex < 0) {
    findings.push(finding(path, 'claude-prelude', 'Claude packaged skill prelude is not closed.'));
    return text;
  }
  const metadata = parsePrelude(lines.slice(1, endIndex));
  const allowedPreludeKeys = new Set(['name', 'description', 'disable-model-invocation']);
  for (const key of metadata.keys()) {
    if (!allowedPreludeKeys.has(key)) {
      findings.push(finding(path, 'claude-prelude', `Unsupported Claude prelude key ${key}.`));
    }
  }
  if (metadata.get('name') !== expectedId) {
    findings.push(
      finding(path, 'claude-prelude', `Claude packaged skill prelude name must be ${expectedId}.`),
    );
  }
  const description = metadata.get('description') ?? '';
  if (description.length === 0) {
    findings.push(
      finding(path, 'claude-prelude', 'Claude packaged skill prelude needs description.'),
    );
  }
  if (!description.includes('Use when')) {
    findings.push(
      finding(
        path,
        'claude-prelude',
        'Claude packaged skill description must include Use when guidance.',
      ),
    );
  }
  const disableModelInvocation = metadata.get('disable-model-invocation');
  if (expectedId === 'harness-health' && disableModelInvocation !== 'true') {
    findings.push(
      finding(
        path,
        'claude-prelude',
        'harness-health must disable model invocation in Claude metadata.',
      ),
    );
  }
  if (expectedId !== 'harness-health' && disableModelInvocation !== undefined) {
    findings.push(
      finding(
        path,
        'claude-prelude',
        `${expectedId} must not add host-specific invocation restrictions.`,
      ),
    );
  }
  return `${lines.slice(endIndex + 1).join('\n')}`;
}

async function loadManifest(
  root: string,
  findings: IParityFinding[],
): Promise<ISkillHashManifest | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(root, manifestPath), 'utf8'));
    if (!isManifest(parsed)) {
      findings.push(
        finding(manifestPath, 'manifest-shape', 'skill-hashes.json has invalid shape.'),
      );
      return undefined;
    }
    return parsed;
  } catch (error) {
    findings.push(
      finding(
        manifestPath,
        'manifest-read',
        `Unable to read skill-hashes.json: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return undefined;
  }
}

async function loadSkillPairs(root: string, findings: IParityFinding[]): Promise<ISkillPair[]> {
  let entries: string[];
  try {
    entries = await readdir(join(root, canonicalSkillDir));
  } catch (error) {
    findings.push(
      finding(
        canonicalSkillDir,
        'canonical-read',
        `Unable to read canonical skills: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return [];
  }
  const ids = entries.filter((entry) => entry !== 'README.md').sort();
  const pairs: ISkillPair[] = [];
  for (const id of ids) {
    const canonicalPath = `${canonicalSkillDir}/${id}/${skillFileName}`;
    const packagedPath = `${packagedSkillDir}/${id}/${skillFileName}`;
    await validatePackagedSkillDirectory(root, id, findings);
    try {
      pairs.push({
        id,
        canonicalPath,
        packagedPath,
        canonicalText: await readFile(join(root, canonicalPath), 'utf8'),
        packagedText: await readFile(join(root, packagedPath), 'utf8'),
      });
    } catch (error) {
      findings.push(
        finding(
          packagedPath,
          'skill-read',
          `Unable to read skill pair for ${id}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }
  return pairs;
}

async function validatePackagedSkillDirectory(
  root: string,
  id: string,
  findings: IParityFinding[],
): Promise<void> {
  const directory = `${packagedSkillDir}/${id}`;
  let entries: Dirent[];
  try {
    entries = await readdir(join(root, directory), { withFileTypes: true });
  } catch (error) {
    findings.push(
      finding(
        directory,
        'packaged-read',
        `Unable to read packaged skill directory: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return;
  }
  let hasSkillFile = false;
  for (const entry of entries) {
    const entryPath = `${directory}/${entry.name}`;
    if (entry.name === skillFileName && entry.isFile()) {
      hasSkillFile = true;
      continue;
    }
    if (entry.name === skillFileName && entry.isSymbolicLink()) {
      findings.push(
        finding(entryPath, 'packaged-symlink', 'Packaged SKILL.md must be a regular file.'),
      );
      continue;
    }
    findings.push(
      finding(
        entryPath,
        'packaged-unexpected-file',
        'Packaged skill directories may contain only a regular SKILL.md file.',
      ),
    );
  }
  if (!hasSkillFile) {
    findings.push(
      finding(`${directory}/${skillFileName}`, 'skill-read', 'Packaged skill is missing SKILL.md.'),
    );
  }
}

function parsePrelude(lines: readonly string[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of lines) {
    const match =
      /^\s*(?:"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)'|([A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.*)$/.exec(
        line,
      );
    if (match === null) {
      continue;
    }

    const [, doubleQuotedKey, singleQuotedKey, plainKey, rawValue] = match;
    const key = doubleQuotedKey ?? singleQuotedKey ?? plainKey;
    if (key !== undefined && rawValue !== undefined) {
      values.set(key, rawValue.replace(/^"|"$/g, '').trim());
    }
  }
  return values;
}

async function loadPackagedSkillIds(
  root: string,
  findings: IParityFinding[],
): Promise<readonly string[]> {
  try {
    const entries = await readdir(join(root, packagedSkillDir), { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        findings.push(
          finding(
            `${packagedSkillDir}/${entry.name}`,
            'packaged-symlink',
            'Packaged skills must be copied files, not symlinks.',
          ),
        );
        continue;
      }
      if (entry.isDirectory()) {
        ids.push(entry.name);
      } else {
        findings.push(
          finding(
            `${packagedSkillDir}/${entry.name}`,
            'packaged-unexpected-file',
            'Packaged skill directory may contain only skill directories.',
          ),
        );
      }
    }
    return ids;
  } catch (error) {
    findings.push(
      finding(
        packagedSkillDir,
        'packaged-read',
        `Unable to read packaged skills: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return [];
  }
}

function isManifest(value: unknown): value is ISkillHashManifest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { skills?: unknown }).skills)
  ) {
    return false;
  }
  const manifest = value as Partial<Record<keyof ISkillHashManifest, unknown>>;
  if (
    typeof manifest['schema_version'] !== 'string' ||
    typeof manifest.host !== 'string' ||
    typeof manifest.normalization !== 'string'
  ) {
    return false;
  }
  return (value as { skills: unknown[] }).skills.every((record) => {
    if (typeof record !== 'object' || record === null) {
      return false;
    }
    const candidate = record as Partial<Record<keyof ISkillHashRecord, unknown>>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate['canonical_path'] === 'string' &&
      typeof candidate['packaged_path'] === 'string' &&
      typeof candidate['canonical_sha256'] === 'string' &&
      typeof candidate['packaged_normalized_sha256'] === 'string'
    );
  });
}

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function finding(path: string, code: string, message: string): IParityFinding {
  return { path: path.replaceAll('\\', '/'), code, message };
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const findings = await checkSkillParity(root);
  if (findings.length > 0) {
    for (const item of findings) {
      console.error(`${relative(root, join(root, item.path))} ${item.code}: ${item.message}`);
    }
    process.exit(1);
  }
}
