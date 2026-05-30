import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseDocument, parse as parseYaml } from 'yaml';

const canonicalSkillDir = 'skills';
const skillFileName = 'SKILL.md';
const schemaVersion = '0.1.0';

export interface IParityFinding {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

interface IAdapterConfig {
  readonly host: string;
  readonly packagedSkillDir: string;
  readonly manifestPath: string;
  readonly normalization: string;
  readonly allowedPreludeKeys: ReadonlySet<string>;
  readonly requiredSkillFiles?: readonly string[];
  readonly validateSkill?: (
    root: string,
    pair: ISkillPair,
    findings: IParityFinding[],
  ) => Promise<void>;
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
  readonly adapter: IAdapterConfig;
}

interface IPackagedSkillEntry {
  readonly path: string;
  readonly relativePath: string;
  readonly symlink: boolean;
  readonly directory: boolean;
  readonly file: boolean;
}

const hostSkillPreludeKeys = new Set(['name', 'description']);
const agentHostPreludeDescriptions = new Map([
  [
    'harness-assess',
    'Use when assessing harness evidence and routing repair actions through deterministic CLI outputs.',
  ],
  [
    'harness-doctor',
    'Use when inspecting harness.yaml and schema structure with deterministic doctor evidence.',
  ],
  [
    'harness-evidence-loop',
    'Use when running a bounded evidence loop across doctor, eval, trace, profile, and gc commands.',
  ],
  [
    'harness-gc-review',
    'Use when reviewing generated harness evidence for cleanup candidates without deleting files.',
  ],
  [
    'harness-health',
    'Use only when the user explicitly asks to run declared harness health checks for a local project.',
  ],
  [
    'harness-profile',
    'Use when producing deterministic handoff profile artifacts from existing harness evidence.',
  ],
  [
    'harness-quickstart',
    'Use when helping a project adopt harness.yaml and run deterministic harness checks.',
  ],
]);
const claudePreludeDescriptions = new Map([
  [
    'harness-assess',
    'Summarize harness maturity and implementation routing from existing evidence. Use when summarizing maturity, gaps, or implementation routing from evidence.',
  ],
  [
    'harness-doctor',
    'Run and interpret harness doctor structural inspection. Use when structural harness inspection or reference validation is needed.',
  ],
  [
    'harness-evidence-loop',
    'Sequence explicit Harness evidence commands safely. Use when orchestrating a safe evidence-gathering pass across existing Harness commands.',
  ],
  [
    'harness-gc-review',
    'Review deterministic GC audit findings without applying cleanup. Use when reviewing deterministic GC audit findings without applying cleanup.',
  ],
  [
    'harness-health',
    'Run declared local project health checks with explicit user intent. Use when the user explicitly asks to run declared local health checks.',
  ],
  [
    'harness-profile',
    'Run or interpret recurring profile handoff evidence. Use when interpreting recurring profile handoff evidence or stop conditions.',
  ],
  [
    'harness-quickstart',
    'Guide initial harness setup and first evidence-backed inspection. Use when initializing Harness or producing first inspection evidence.',
  ],
]);
const adapters: readonly IAdapterConfig[] = [
  {
    host: 'claude-code',
    packagedSkillDir: 'plugins/claude-code/skills',
    manifestPath: 'plugins/claude-code/skill-hashes.json',
    normalization: 'claude-code-skill-prelude-v1',
    allowedPreludeKeys: new Set([...hostSkillPreludeKeys, 'disable-model-invocation']),
  },
  {
    host: 'codex',
    packagedSkillDir: 'plugins/codex/skills',
    manifestPath: 'plugins/codex/skill-hashes.json',
    normalization: 'agent-skill-prelude-v1',
    allowedPreludeKeys: hostSkillPreludeKeys,
    requiredSkillFiles: ['agents/openai.yaml'],
    validateSkill: validateCodexSkillPolicy,
  },
  {
    host: 'copilot-cli',
    packagedSkillDir: 'plugins/copilot-cli/skills',
    manifestPath: 'plugins/copilot-cli/skill-hashes.json',
    normalization: 'agent-skill-prelude-v1',
    allowedPreludeKeys: hostSkillPreludeKeys,
  },
  {
    host: 'gemini-cli',
    packagedSkillDir: 'plugins/gemini-cli/skills',
    manifestPath: 'plugins/gemini-cli/skill-hashes.json',
    normalization: 'agent-skill-prelude-v1',
    allowedPreludeKeys: hostSkillPreludeKeys,
  },
];

export async function checkSkillParity(root = process.cwd()): Promise<IParityFinding[]> {
  const findings: IParityFinding[] = [];
  const canonicalSkills = await loadCanonicalSkills(root, findings);
  for (const adapter of adapters) {
    await checkAdapterSkillParity(root, adapter, canonicalSkills, findings);
  }
  return findings.sort((left, right) =>
    `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`),
  );
}

async function checkAdapterSkillParity(
  root: string,
  adapter: IAdapterConfig,
  canonicalSkills: ReadonlyMap<string, { path: string; text: string }>,
  findings: IParityFinding[],
): Promise<void> {
  const manifest = await loadManifest(root, adapter, findings);
  const skillPairs = await loadSkillPairs(root, adapter, canonicalSkills, findings);
  const canonicalIds = new Set(canonicalSkills.keys());
  const recordsById = new Map((manifest?.skills ?? []).map((record) => [record.id, record]));

  if (manifest !== undefined) {
    if (manifest['schema_version'] !== schemaVersion) {
      findings.push(
        finding(
          adapter.manifestPath,
          'manifest-schema-version',
          `skill-hashes schema_version must be ${schemaVersion}.`,
        ),
      );
    }
    if (manifest.host !== adapter.host) {
      findings.push(
        finding(
          adapter.manifestPath,
          'manifest-host',
          `skill-hashes host must be ${adapter.host}.`,
        ),
      );
    }
    if (manifest.normalization !== adapter.normalization) {
      findings.push(
        finding(
          adapter.manifestPath,
          'manifest-normalization',
          `skill-hashes normalization must be ${adapter.normalization}.`,
        ),
      );
    }
  }

  for (const pair of skillPairs) {
    const normalized = normalizePackagedSkill(
      pair.packagedText,
      pair.id,
      pair.packagedPath,
      pair.adapter,
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
        finding(
          adapter.manifestPath,
          'manifest-missing-skill',
          `Missing hash record for ${pair.id}.`,
        ),
      );
    } else {
      validateHashRecord(adapter, pair, normalized, record, findings);
    }
    await adapter.validateSkill?.(root, pair, findings);
  }

  const seenRecordIds = new Set<string>();
  for (const record of manifest?.skills ?? []) {
    if (seenRecordIds.has(record.id)) {
      findings.push(
        finding(
          adapter.manifestPath,
          'manifest-duplicate-skill',
          `Duplicate hash record for ${record.id}.`,
        ),
      );
    }
    seenRecordIds.add(record.id);
    if (!canonicalIds.has(record.id)) {
      findings.push(
        finding(
          adapter.manifestPath,
          'manifest-extra-skill',
          `Extra hash record for ${record.id}.`,
        ),
      );
    }
  }
  for (const id of await loadPackagedSkillIds(root, adapter, findings)) {
    if (!canonicalIds.has(id)) {
      findings.push(
        finding(
          `${adapter.packagedSkillDir}/${id}/${skillFileName}`,
          'packaged-extra-skill',
          `Packaged skill ${id} has no canonical counterpart.`,
        ),
      );
    }
  }
}

function validateHashRecord(
  adapter: IAdapterConfig,
  pair: ISkillPair,
  normalized: string,
  record: ISkillHashRecord,
  findings: IParityFinding[],
): void {
  const canonicalHash = sha256(pair.canonicalText);
  const packagedHash = sha256(normalized);
  if (record['canonical_path'] !== pair.canonicalPath) {
    findings.push(
      finding(adapter.manifestPath, 'manifest-path', `${pair.id} canonical_path is stale.`),
    );
  }
  if (record['packaged_path'] !== pair.packagedPath) {
    findings.push(
      finding(adapter.manifestPath, 'manifest-path', `${pair.id} packaged_path is stale.`),
    );
  }
  if (record['canonical_sha256'] !== canonicalHash) {
    findings.push(
      finding(adapter.manifestPath, 'manifest-hash', `${pair.id} canonical_sha256 is stale.`),
    );
  }
  if (record['packaged_normalized_sha256'] !== packagedHash) {
    findings.push(
      finding(
        adapter.manifestPath,
        'manifest-hash',
        `${pair.id} packaged_normalized_sha256 is stale.`,
      ),
    );
  }
}

function normalizePackagedSkill(
  text: string,
  expectedId: string,
  path: string,
  adapter: IAdapterConfig,
  findings: IParityFinding[],
): string {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') {
    findings.push(
      finding(path, 'host-prelude', `${adapter.host} packaged skill must start with host prelude.`),
    );
    return text;
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  if (endIndex < 0) {
    findings.push(
      finding(path, 'host-prelude', `${adapter.host} packaged skill prelude is not closed.`),
    );
    return text;
  }
  const metadata = parsePrelude(lines.slice(1, endIndex), path, 'host-prelude', findings);
  if (metadata === undefined) {
    return text;
  }
  for (const key of metadata.keys()) {
    if (!adapter.allowedPreludeKeys.has(key)) {
      findings.push(
        finding(path, 'host-prelude', `Unsupported ${adapter.host} prelude key ${key}.`),
      );
    }
  }
  if (metadata.get('name') !== expectedId) {
    findings.push(
      finding(
        path,
        'host-prelude',
        `${adapter.host} packaged skill prelude name must be ${expectedId}.`,
      ),
    );
  }
  const description = metadata.get('description') ?? '';
  if (description.length === 0) {
    findings.push(
      finding(path, 'host-prelude', `${adapter.host} packaged skill prelude needs description.`),
    );
  }
  const expectedDescription = expectedPreludeDescription(adapter.host, expectedId);
  if (expectedDescription === undefined) {
    findings.push(
      finding(
        path,
        'host-prelude',
        `${adapter.host} packaged skill ${expectedId} needs a reviewed prelude description contract.`,
      ),
    );
  } else if (description !== expectedDescription) {
    findings.push(
      finding(
        path,
        'host-prelude',
        `${adapter.host} packaged skill description must match the reviewed adapter contract.`,
      ),
    );
  }

  const disableModelInvocation = metadata.get('disable-model-invocation');
  if (adapter.host === 'claude-code') {
    if (expectedId === 'harness-health' && disableModelInvocation !== 'true') {
      findings.push(
        finding(
          path,
          'host-prelude',
          'harness-health must disable model invocation in Claude metadata.',
        ),
      );
    }
    if (expectedId !== 'harness-health' && disableModelInvocation !== undefined) {
      findings.push(
        finding(
          path,
          'host-prelude',
          `${expectedId} must not add host-specific invocation restrictions.`,
        ),
      );
    }
  }

  if (adapter.host !== 'claude-code' && expectedId === 'harness-health') {
    const lowerDescription = description.toLowerCase();
    if (
      !lowerDescription.includes('only when the user explicitly asks') ||
      !lowerDescription.includes('declared') ||
      !lowerDescription.includes('health checks')
    ) {
      findings.push(
        finding(
          path,
          'host-prelude',
          'harness-health host prelude must preserve explicit user intent guidance.',
        ),
      );
    }
  }

  return lines.slice(endIndex + 1).join('\n');
}

async function loadCanonicalSkills(
  root: string,
  findings: IParityFinding[],
): Promise<ReadonlyMap<string, { path: string; text: string }>> {
  let entries: string[];
  try {
    if (
      (await safeRelativePathStatus(root, canonicalSkillDir, 'directory', findings, {
        readCode: 'canonical-read',
        symlinkCode: 'canonical-read',
        subject: 'Canonical skills directory',
      })) === undefined
    ) {
      return new Map();
    }
    entries = await readdir(join(root, canonicalSkillDir));
  } catch (error) {
    findings.push(
      finding(
        canonicalSkillDir,
        'canonical-read',
        `Unable to read canonical skills: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return new Map();
  }
  const skills = new Map<string, { path: string; text: string }>();
  for (const id of entries.filter((entry) => entry !== 'README.md').sort()) {
    const canonicalPath = `${canonicalSkillDir}/${id}/${skillFileName}`;
    try {
      if (
        (await safeRelativePathStatus(root, canonicalPath, 'file', findings, {
          readCode: 'canonical-read',
          symlinkCode: 'canonical-read',
          subject: 'Canonical skill file',
        })) === undefined
      ) {
        continue;
      }
      skills.set(id, {
        path: canonicalPath,
        text: await readFile(join(root, canonicalPath), 'utf8'),
      });
    } catch (error) {
      findings.push(
        finding(
          canonicalPath,
          'canonical-read',
          `Unable to read canonical skill ${id}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }
  return skills;
}

async function loadManifest(
  root: string,
  adapter: IAdapterConfig,
  findings: IParityFinding[],
): Promise<ISkillHashManifest | undefined> {
  try {
    if (
      (await safeRelativePathStatus(root, adapter.manifestPath, 'file', findings, {
        readCode: 'manifest-read',
        symlinkCode: 'manifest-read',
        subject: 'skill-hashes.json',
      })) === undefined
    ) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(await readFile(join(root, adapter.manifestPath), 'utf8'));
    if (!isManifest(parsed)) {
      findings.push(
        finding(adapter.manifestPath, 'manifest-shape', 'skill-hashes.json has invalid shape.'),
      );
      return undefined;
    }
    return parsed;
  } catch (error) {
    findings.push(
      finding(
        adapter.manifestPath,
        'manifest-read',
        `Unable to read skill-hashes.json: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return undefined;
  }
}

async function loadSkillPairs(
  root: string,
  adapter: IAdapterConfig,
  canonicalSkills: ReadonlyMap<string, { path: string; text: string }>,
  findings: IParityFinding[],
): Promise<ISkillPair[]> {
  const pairs: ISkillPair[] = [];
  for (const [id, canonicalSkill] of canonicalSkills) {
    const packagedPath = `${adapter.packagedSkillDir}/${id}/${skillFileName}`;
    await validatePackagedSkillDirectory(root, adapter, id, findings);
    try {
      if ((await regularFileStatus(root, packagedPath, findings)) === undefined) {
        continue;
      }
      pairs.push({
        id,
        canonicalPath: canonicalSkill.path,
        packagedPath,
        canonicalText: canonicalSkill.text,
        packagedText: await readFile(join(root, packagedPath), 'utf8'),
        adapter,
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
  adapter: IAdapterConfig,
  id: string,
  findings: IParityFinding[],
): Promise<void> {
  const directory = `${adapter.packagedSkillDir}/${id}`;
  const requiredFiles = new Set([skillFileName, ...(adapter.requiredSkillFiles ?? [])]);
  const allowedDirectories = new Set<string>();
  for (const file of requiredFiles) {
    const parts = file.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      allowedDirectories.add(parts.slice(0, index).join('/'));
    }
  }

  let entries: readonly IPackagedSkillEntry[];
  try {
    if (
      (await safeRelativePathStatus(root, directory, 'directory', findings, {
        readCode: 'packaged-read',
        symlinkCode: 'packaged-symlink',
        subject: 'Packaged skill directory',
      })) === undefined
    ) {
      return;
    }
    entries = await walkSkillDirectory(root, directory);
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

  const seenFiles = new Set<string>();
  for (const entry of entries) {
    if (entry.symlink) {
      findings.push(
        finding(entry.path, 'packaged-symlink', 'Packaged skills must use regular files.'),
      );
      continue;
    }
    if (entry.directory) {
      if (!allowedDirectories.has(entry.relativePath)) {
        findings.push(
          finding(
            entry.path,
            'packaged-unexpected-file',
            'Packaged skill directory contains an unexpected directory.',
          ),
        );
      }
      continue;
    }
    if (!entry.file) {
      findings.push(
        finding(
          entry.path,
          'packaged-unexpected-file',
          'Packaged skill directory contains an unsupported filesystem entry.',
        ),
      );
      continue;
    }
    seenFiles.add(entry.relativePath);
    if (!requiredFiles.has(entry.relativePath)) {
      findings.push(
        finding(
          entry.path,
          'packaged-unexpected-file',
          'Packaged skill directory contains an unexpected file.',
        ),
      );
    }
  }
  for (const file of requiredFiles) {
    if (!seenFiles.has(file)) {
      findings.push(
        finding(`${directory}/${file}`, 'skill-read', `Packaged skill is missing ${file}.`),
      );
    }
  }
}

async function walkSkillDirectory(
  root: string,
  directory: string,
  baseDirectory = directory,
): Promise<readonly IPackagedSkillEntry[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const collected: IPackagedSkillEntry[] = [];
  for (const entry of entries) {
    const entryPath = `${directory}/${entry.name}`;
    const relativePath = relative(baseDirectory, entryPath).replaceAll('\\', '/');
    collected.push({
      path: entryPath,
      relativePath,
      symlink: entry.isSymbolicLink(),
      directory: entry.isDirectory(),
      file: entry.isFile(),
    });
    if (entry.isDirectory()) {
      collected.push(...(await walkSkillDirectory(root, entryPath, baseDirectory)));
    }
  }
  return collected;
}

async function loadPackagedSkillIds(
  root: string,
  adapter: IAdapterConfig,
  findings: IParityFinding[],
): Promise<readonly string[]> {
  try {
    if (
      (await safeRelativePathStatus(root, adapter.packagedSkillDir, 'directory', findings, {
        readCode: 'packaged-read',
        symlinkCode: 'packaged-symlink',
        subject: 'Packaged skills directory',
      })) === undefined
    ) {
      return [];
    }
    const entries = await readdir(join(root, adapter.packagedSkillDir), { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        findings.push(
          finding(
            `${adapter.packagedSkillDir}/${entry.name}`,
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
            `${adapter.packagedSkillDir}/${entry.name}`,
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
        adapter.packagedSkillDir,
        'packaged-read',
        `Unable to read packaged skills: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return [];
  }
}

async function validateCodexSkillPolicy(
  root: string,
  pair: ISkillPair,
  findings: IParityFinding[],
): Promise<void> {
  const policyPath = `${pair.adapter.packagedSkillDir}/${pair.id}/agents/openai.yaml`;
  let parsed: unknown;
  try {
    if ((await regularFileStatus(root, policyPath, findings)) === undefined) {
      return;
    }
    parsed = parseYaml(await readFile(join(root, policyPath), 'utf8'));
  } catch (error) {
    findings.push(
      finding(
        policyPath,
        'codex-policy-read',
        `Unable to read Codex skill policy: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return;
  }

  const policy = codexPolicy(parsed);
  if (policy === undefined) {
    findings.push(
      finding(policyPath, 'codex-policy-shape', 'Codex skill policy must contain a policy object.'),
    );
    return;
  }
  const parsedObject = parsed as Record<string, unknown>;
  for (const key of Object.keys(parsedObject)) {
    if (key !== 'schema_version' && key !== 'policy') {
      findings.push(
        finding(
          policyPath,
          'codex-policy-key',
          `Unsupported Codex skill policy top-level key ${key}.`,
        ),
      );
    }
  }
  const schemaVersionValue = (parsed as { ['schema_version']?: unknown })['schema_version'];
  if (schemaVersionValue !== schemaVersion) {
    findings.push(
      finding(
        policyPath,
        'codex-policy-schema',
        `Codex skill policy schema_version must be ${schemaVersion}.`,
      ),
    );
  }
  for (const key of Object.keys(policy)) {
    if (key !== 'allow_implicit_invocation') {
      findings.push(
        finding(policyPath, 'codex-policy-key', `Unsupported Codex skill policy key ${key}.`),
      );
    }
  }

  const invocationPolicy = canonicalInvocationPolicy(
    pair.canonicalText,
    pair.canonicalPath,
    findings,
  );
  if (invocationPolicy === undefined) {
    findings.push(
      finding(
        pair.canonicalPath,
        'canonical-policy',
        `${pair.id} is missing canonical invocation_policy.`,
      ),
    );
    return;
  }
  const expectedImplicit = invocationPolicy === 'user-or-model';
  const actualImplicit = codexAllowImplicitInvocation(policy);
  if (actualImplicit !== expectedImplicit) {
    findings.push(
      finding(
        policyPath,
        'codex-policy',
        `${pair.id} allow_implicit_invocation must be ${String(expectedImplicit)}.`,
      ),
    );
  }
}

function canonicalInvocationPolicy(
  canonicalText: string,
  canonicalPath: string,
  findings: IParityFinding[],
): 'explicit-user-intent' | 'user-or-model' | undefined {
  const lines = canonicalText.split(/\r?\n/);
  if (lines[0] !== '---') {
    return undefined;
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  if (endIndex < 0) {
    return undefined;
  }
  const metadata = parsePrelude(
    lines.slice(1, endIndex),
    canonicalPath,
    'canonical-policy',
    findings,
  );
  if (metadata === undefined) {
    return undefined;
  }
  const value = metadata.get('invocation_policy');
  return value === 'explicit-user-intent' || value === 'user-or-model' ? value : undefined;
}

function codexPolicy(parsed: unknown): Record<string, unknown> | undefined {
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const policy = (parsed as { policy?: unknown }).policy;
  if (typeof policy !== 'object' || policy === null) {
    return undefined;
  }
  return policy as Record<string, unknown>;
}

function codexAllowImplicitInvocation(policy: Record<string, unknown>): boolean | undefined {
  const value = (policy as { ['allow_implicit_invocation']?: unknown })[
    'allow_implicit_invocation'
  ];
  return typeof value === 'boolean' ? value : undefined;
}

async function regularFileStatus(
  root: string,
  path: string,
  findings: IParityFinding[],
): Promise<true | undefined> {
  const stat = await safeRelativePathStatus(root, path, 'file', findings, {
    readCode: 'skill-read',
    symlinkCode: 'packaged-symlink',
    subject: 'Packaged skill file',
  });
  return stat === undefined ? undefined : true;
}

async function safeRelativePathStatus(
  root: string,
  path: string,
  kind: 'file' | 'directory',
  findings: IParityFinding[],
  options: { readCode: string; symlinkCode: string; subject: string },
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  let currentPath = '';
  let stat: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    for (const [index, part] of parts.entries()) {
      currentPath = currentPath.length === 0 ? part : `${currentPath}/${part}`;
      stat = await lstat(join(root, currentPath));
      if (stat.isSymbolicLink()) {
        findings.push(
          finding(currentPath, options.symlinkCode, `${options.subject} must not cross symlinks.`),
        );
        return undefined;
      }
      if (index < parts.length - 1 && !stat.isDirectory()) {
        findings.push(
          finding(currentPath, options.readCode, `${options.subject} parent must be a directory.`),
        );
        return undefined;
      }
    }
  } catch (error) {
    findings.push(
      finding(
        path,
        options.readCode,
        `Unable to stat ${options.subject}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return undefined;
  }
  if (stat === undefined) {
    findings.push(finding(path, options.readCode, `${options.subject} path is empty.`));
    return undefined;
  }
  const kindMatches = kind === 'file' ? stat.isFile() : stat.isDirectory();
  if (!kindMatches) {
    findings.push(finding(path, options.readCode, `${options.subject} must be a ${kind}.`));
    return undefined;
  }
  return stat;
}

function expectedPreludeDescription(host: string, skillId: string): string | undefined {
  return host === 'claude-code'
    ? claudePreludeDescriptions.get(skillId)
    : agentHostPreludeDescriptions.get(skillId);
}

function parsePrelude(
  lines: readonly string[],
  path?: string,
  code?: string,
  findings?: IParityFinding[],
): ReadonlyMap<string, string> | undefined {
  const source = lines.join('\n');
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    findings?.push(
      finding(
        path ?? 'frontmatter',
        code ?? 'frontmatter',
        document.errors[0]?.message ?? 'Invalid YAML.',
      ),
    );
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = document.toJS();
  } catch (error) {
    findings?.push(
      finding(
        path ?? 'frontmatter',
        code ?? 'frontmatter',
        error instanceof Error ? error.message : String(error),
      ),
    );
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    findings?.push(
      finding(path ?? 'frontmatter', code ?? 'frontmatter', 'Frontmatter must be a YAML mapping.'),
    );
    return undefined;
  }
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
      findings?.push(
        finding(
          path ?? 'frontmatter',
          code ?? 'frontmatter',
          `Unsupported frontmatter key ${key}.`,
        ),
      );
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'boolean') {
      findings?.push(
        finding(
          path ?? 'frontmatter',
          code ?? 'frontmatter',
          `Frontmatter key ${key} must be a string or boolean.`,
        ),
      );
      continue;
    }
    values.set(key, String(value).trim());
  }
  return values;
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
