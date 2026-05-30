import { lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface IPluginManifestFinding {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

interface IPluginManifestCheck {
  readonly path: string;
  readonly root: string;
  readonly requiredFields: readonly string[];
  readonly pathFields: readonly IManifestPathField[];
  readonly textChecks?: readonly ITextCheck[];
}

interface IManifestPathField {
  readonly field: string;
  readonly expected: string;
  readonly kind: 'directory' | 'file';
  readonly resolveFrom: 'plugin-root' | 'manifest-directory';
}

interface ITextCheck {
  readonly path: string;
  readonly includes: readonly string[];
  readonly canonicalGuidance?: string;
  readonly command?: string;
}

interface IManifestObject {
  readonly name?: unknown;
  readonly [key: string]: unknown;
}

interface IMarketplaceEntry {
  readonly name?: unknown;
  readonly source?: unknown;
  readonly policy?: unknown;
  readonly category?: unknown;
}

const manifestChecks: readonly IPluginManifestCheck[] = [
  {
    path: 'plugins/claude-code/.claude-plugin/plugin.json',
    root: 'plugins/claude-code',
    requiredFields: ['name', 'version', 'description'],
    pathFields: [],
  },
  {
    path: 'plugins/codex/.codex-plugin/plugin.json',
    root: 'plugins/codex',
    requiredFields: ['name', 'version', 'description', 'skills'],
    pathFields: [
      { field: 'skills', expected: './skills/', kind: 'directory', resolveFrom: 'plugin-root' },
    ],
  },
  {
    path: 'plugins/copilot-cli/plugin.json',
    root: 'plugins/copilot-cli',
    requiredFields: ['name', 'version', 'description', 'agents', 'skills'],
    pathFields: [
      {
        field: 'agents',
        expected: 'agents/',
        kind: 'directory',
        resolveFrom: 'manifest-directory',
      },
      {
        field: 'skills',
        expected: 'skills/',
        kind: 'directory',
        resolveFrom: 'manifest-directory',
      },
    ],
    textChecks: [
      {
        path: 'plugins/copilot-cli/agents/harness.agent.md',
        includes: ['harness health --accept-unsandboxed-execution --format json'],
        canonicalGuidance: 'only when the user explicitly asks for declared local health checks',
        command: 'harness health --accept-unsandboxed-execution --format json',
      },
    ],
  },
  {
    path: 'plugins/gemini-cli/gemini-extension.json',
    root: 'plugins/gemini-cli',
    requiredFields: ['name', 'version', 'description', 'contextFileName'],
    pathFields: [
      {
        field: 'contextFileName',
        expected: 'GEMINI.md',
        kind: 'file',
        resolveFrom: 'manifest-directory',
      },
    ],
    textChecks: [
      {
        path: 'plugins/gemini-cli/GEMINI.md',
        includes: ['harness health --accept-unsandboxed-execution --format json'],
        canonicalGuidance: 'only when the user explicitly asks for declared local health checks',
        command: 'harness health --accept-unsandboxed-execution --format json',
      },
    ],
  },
];

export async function checkPluginManifests(
  root = process.cwd(),
): Promise<IPluginManifestFinding[]> {
  const findings: IPluginManifestFinding[] = [];
  for (const check of manifestChecks) {
    await validateManifest(root, check, findings);
  }
  await validateCodexMarketplace(root, findings);
  return findings.sort((left, right) =>
    `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`),
  );
}

async function validateCodexMarketplace(
  root: string,
  findings: IPluginManifestFinding[],
): Promise<void> {
  const marketplacePath = '.agents/plugins/marketplace.json';
  let marketplace: unknown;
  try {
    const marketplaceText = await safeReadText(
      root,
      marketplacePath,
      findings,
      'marketplace-read',
      'Marketplace',
    );
    if (marketplaceText === undefined) {
      return;
    }
    marketplace = JSON.parse(marketplaceText);
  } catch (error) {
    findings.push(
      finding(
        marketplacePath,
        'marketplace-read',
        `Unable to read marketplace: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return;
  }
  if (typeof marketplace !== 'object' || marketplace === null || Array.isArray(marketplace)) {
    findings.push(
      finding(marketplacePath, 'marketplace-shape', 'Marketplace must be a JSON object.'),
    );
    return;
  }
  const object = marketplace as { name?: unknown; plugins?: unknown };
  if (object.name !== 'harness-engineering-local') {
    findings.push(
      finding(
        marketplacePath,
        'marketplace-name',
        'Marketplace name must be harness-engineering-local.',
      ),
    );
  }
  if (!Array.isArray(object.plugins)) {
    findings.push(
      finding(marketplacePath, 'marketplace-shape', 'Marketplace plugins must be an array.'),
    );
    return;
  }
  const entries = object.plugins as readonly IMarketplaceEntry[];
  for (const [index, entry] of object.plugins.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      findings.push(
        finding(
          marketplacePath,
          'marketplace-plugin',
          `Marketplace plugin entry ${index} must be an object.`,
        ),
      );
      return;
    }
  }
  const harnessEntry = entries.find((entry) => entry.name === 'harness-engineering');
  if (harnessEntry === undefined) {
    findings.push(
      finding(
        marketplacePath,
        'marketplace-plugin',
        'Marketplace must expose harness-engineering.',
      ),
    );
    return;
  }
  validateCodexMarketplaceEntry(root, marketplacePath, harnessEntry, findings);
}

function validateCodexMarketplaceEntry(
  root: string,
  marketplacePath: string,
  entry: IMarketplaceEntry,
  findings: IPluginManifestFinding[],
): void {
  if (entry.category !== 'Productivity') {
    findings.push(
      finding(
        marketplacePath,
        'marketplace-category',
        'Codex plugin category must be Productivity.',
      ),
    );
  }
  const source = entry.source;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    findings.push(
      finding(marketplacePath, 'marketplace-source', 'Codex plugin source must be an object.'),
    );
    return;
  }
  const sourceObject = source as { source?: unknown; path?: unknown };
  if (sourceObject.source !== 'local' || sourceObject.path !== './plugins/codex') {
    findings.push(
      finding(
        marketplacePath,
        'marketplace-source',
        'Codex plugin source must be local ./plugins/codex.',
      ),
    );
  }
  validateResolvedTarget(
    root,
    marketplacePath,
    'source.path',
    './plugins/codex',
    'directory',
    root,
    findings,
  );

  const policy = entry.policy;
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
    findings.push(
      finding(marketplacePath, 'marketplace-policy', 'Codex plugin policy must be an object.'),
    );
    return;
  }
  const policyObject = policy as { installation?: unknown; authentication?: unknown };
  if (policyObject.installation !== 'AVAILABLE' || policyObject.authentication !== 'ON_INSTALL') {
    findings.push(
      finding(
        marketplacePath,
        'marketplace-policy',
        'Codex plugin policy must be AVAILABLE and ON_INSTALL.',
      ),
    );
  }
}

async function validateManifest(
  root: string,
  check: IPluginManifestCheck,
  findings: IPluginManifestFinding[],
): Promise<void> {
  let manifest: unknown;
  try {
    const manifestText = await safeReadText(
      root,
      check.path,
      findings,
      'manifest-read',
      'Manifest',
    );
    if (manifestText === undefined) {
      return;
    }
    manifest = JSON.parse(manifestText);
  } catch (error) {
    findings.push(
      finding(
        check.path,
        'manifest-read',
        `Unable to read manifest: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return;
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    findings.push(finding(check.path, 'manifest-shape', 'Manifest must be a JSON object.'));
    return;
  }
  const object = manifest as IManifestObject;
  if (object.name !== 'harness-engineering') {
    findings.push(
      finding(check.path, 'manifest-name', 'Manifest name must be harness-engineering.'),
    );
  }
  for (const field of check.requiredFields) {
    if (typeof object[field] !== 'string' || object[field].length === 0) {
      findings.push(
        finding(check.path, 'manifest-field', `Manifest field ${field} must be a string.`),
      );
    }
  }
  for (const pathField of check.pathFields) {
    validatePathField(root, check, pathField, object[pathField.field], findings);
  }
  for (const textCheck of check.textChecks ?? []) {
    await validateTextCheck(root, textCheck, findings);
  }
}

function validatePathField(
  root: string,
  check: IPluginManifestCheck,
  pathField: IManifestPathField,
  value: unknown,
  findings: IPluginManifestFinding[],
): void {
  if (value !== pathField.expected) {
    findings.push(
      finding(check.path, 'manifest-path', `${pathField.field} must be ${pathField.expected}.`),
    );
    return;
  }
  const manifestParent = check.path.slice(0, check.path.lastIndexOf('/'));
  const base = pathField.resolveFrom === 'plugin-root' ? check.root : manifestParent;
  const expectedPath = pathField.expected.replace(/\/+$/, '').replace(/^\.\//, '');
  validateResolvedTarget(
    root,
    check.path,
    pathField.field,
    expectedPath,
    pathField.kind,
    join(root, base),
    findings,
  );
}

function validateResolvedTarget(
  root: string,
  manifestPath: string,
  field: string,
  expectedPath: string,
  kind: 'directory' | 'file',
  basePath: string,
  findings: IPluginManifestFinding[],
): void {
  const resolvedPath = join(basePath, expectedPath.replace(/\/+$/, '').replace(/^\.\//, ''));
  const stat = safeResolvedPathStatus(root, resolvedPath, kind, findings, {
    findingPath: manifestPath,
    code: 'manifest-path-target',
    subject: `${field} target ${relativeToRoot(root, resolvedPath)}`,
  });
  if (stat === undefined) {
    return;
  }
  const kindMatches = kind === 'directory' ? stat.isDirectory() : stat.isFile();
  if (!kindMatches) {
    findings.push(
      finding(
        manifestPath,
        'manifest-path-target',
        `${field} target ${relativeToRoot(root, resolvedPath)} must be a ${kind}.`,
      ),
    );
  }
}

async function validateTextCheck(
  root: string,
  check: ITextCheck,
  findings: IPluginManifestFinding[],
): Promise<void> {
  let text: string;
  try {
    const guidanceText = await safeReadText(
      root,
      check.path,
      findings,
      'manifest-guidance-read',
      'Guidance',
    );
    if (guidanceText === undefined) {
      return;
    }
    text = guidanceText;
  } catch (error) {
    findings.push(
      finding(
        check.path,
        'manifest-guidance-read',
        `Unable to read guidance: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return;
  }
  for (const expected of check.includes) {
    if (!text.includes(expected)) {
      findings.push(
        finding(check.path, 'manifest-guidance', `Guidance must include "${expected}".`),
      );
    }
  }
  if (check.canonicalGuidance !== undefined) {
    const normalizedText = text.replace(/\s+/g, ' ').toLowerCase();
    const canonicalGuidance = check.canonicalGuidance.toLowerCase();
    const command = check.command?.toLowerCase();
    const contradictoryGuidance = guidanceContradictsExplicitIntent(text, command);
    const guidanceIsCloseToCommand =
      command === undefined || guidanceAppearsNearCommand(text, command, canonicalGuidance);
    if (
      !normalizedText.includes(canonicalGuidance) ||
      !guidanceIsCloseToCommand ||
      contradictoryGuidance
    ) {
      findings.push(
        finding(
          check.path,
          'manifest-guidance',
          `Guidance must preserve "${check.canonicalGuidance}".`,
        ),
      );
    }
  }

  function guidanceAppearsNearCommand(text: string, command: string, guidance: string): boolean {
    for (const sentence of text.split(/(?:[.!?]+|\n\s*\n)+/)) {
      const normalizedSentence = sentence.replace(/\s+/g, ' ').toLowerCase();
      if (normalizedSentence.includes(command) && normalizedSentence.includes(guidance)) {
        return true;
      }
    }
    return false;
  }

  function guidanceContradictsExplicitIntent(text: string, command?: string): boolean {
    const normalizedText = text.replace(/\s+/g, ' ').toLowerCase();
    const sensitive = command === undefined || normalizedText.includes(command);
    return (
      sensitive &&
      /(?:automatically|without (?:explicit )?(?:user|approval|consent)|without asking|do not ask|don't ask|no approval|skip approval|bypass approval|always run|run .*without waiting)/.test(
        normalizedText,
      )
    );
  }
}

async function safeReadText(
  root: string,
  path: string,
  findings: IPluginManifestFinding[],
  code: string,
  subject: string,
): Promise<string | undefined> {
  if (
    safeRelativePathStatus(root, path, 'file', findings, {
      findingPath: path,
      code,
      subject,
    }) === undefined
  ) {
    return undefined;
  }
  return readFile(join(root, path), 'utf8');
}

function safeResolvedPathStatus(
  root: string,
  resolvedPath: string,
  kind: 'directory' | 'file',
  findings: IPluginManifestFinding[],
  options: { findingPath: string; code: string; subject: string },
): ReturnType<typeof lstatSync> | undefined {
  const relativePath = relativeToRoot(root, resolvedPath);
  if (relativePath.startsWith('../') || relativePath === '..') {
    findings.push(finding(options.findingPath, options.code, `${options.subject} escapes root.`));
    return undefined;
  }
  return safeRelativePathStatus(root, relativePath, kind, findings, options);
}

function safeRelativePathStatus(
  root: string,
  path: string,
  kind: 'directory' | 'file',
  findings: IPluginManifestFinding[],
  options: { findingPath: string; code: string; subject: string },
): ReturnType<typeof lstatSync> | undefined {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  let currentPath = '';
  let stat: ReturnType<typeof lstatSync> | undefined;
  try {
    for (const [index, part] of parts.entries()) {
      currentPath = currentPath.length === 0 ? part : `${currentPath}/${part}`;
      stat = lstatSync(join(root, currentPath));
      if (stat.isSymbolicLink()) {
        findings.push(
          finding(
            options.findingPath,
            options.code,
            `${options.subject} must not cross symlink component ${currentPath}.`,
          ),
        );
        return undefined;
      }
      if (index < parts.length - 1 && !stat.isDirectory()) {
        findings.push(
          finding(
            options.findingPath,
            options.code,
            `${options.subject} parent ${currentPath} must be a directory.`,
          ),
        );
        return undefined;
      }
    }
  } catch (error) {
    const message =
      error instanceof Error && 'code' in error && error.code !== 'ENOENT'
        ? `cannot be inspected: ${error.message}`
        : 'is missing';
    findings.push(finding(options.findingPath, options.code, `${options.subject} ${message}.`));
    return undefined;
  }
  if (stat === undefined) {
    findings.push(finding(options.findingPath, options.code, `${options.subject} path is empty.`));
    return undefined;
  }
  const kindMatches = kind === 'directory' ? stat.isDirectory() : stat.isFile();
  if (!kindMatches) {
    findings.push(
      finding(options.findingPath, options.code, `${options.subject} must be a ${kind}.`),
    );
    return undefined;
  }
  return stat;
}

function relativeToRoot(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}

function finding(path: string, code: string, message: string): IPluginManifestFinding {
  return { path: path.replaceAll('\\', '/'), code, message };
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const findings = await checkPluginManifests(root);
  if (findings.length > 0) {
    for (const item of findings) {
      console.error(`${relative(root, join(root, item.path))} ${item.code}: ${item.message}`);
    }
    process.exit(1);
  }
}
