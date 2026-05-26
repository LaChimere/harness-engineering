import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';

import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';
import { assertNoSymlinkWithinRoot, loadDocument, pathKind } from './files.ts';
import {
  getArray,
  getObject,
  getString,
  isObject,
  type JsonObject,
  objectEntries,
} from './json.ts';
import { relativePathFromRoot, resolveInsideRoot } from './paths.ts';
import {
  formatValidationIssue,
  type SchemaRegistry,
  type ValidationIssue,
} from './schema-registry.ts';

export interface HarnessValidationResult {
  readonly harnessPath: string;
  readonly document?: JsonObject;
  readonly schemaIssues: readonly string[];
  readonly compatibilityIssues: readonly string[];
  readonly referenceIssues: readonly string[];
  readonly checkedReferences: readonly string[];
}

export interface HarnessReference {
  readonly path: string;
  readonly description: string;
  readonly schemaName?: string;
}

export async function validateHarnessConfiguration(input: {
  readonly root: string;
  readonly harnessPath: string;
  readonly cliVersion: string;
  readonly schemas: SchemaRegistry;
}): Promise<HarnessValidationResult> {
  const harnessPath = resolveInsideRoot(input.root, input.harnessPath, 'Harness file');
  await assertNoSymlinkWithinRoot(input.root, harnessPath, 'read');
  if ((await pathKind(harnessPath)) !== 'file') {
    throw new CliError(`Harness file not found: ${input.harnessPath}`, ExitCode.notFound);
  }

  const document = await loadDocument(harnessPath);
  const schemaIssues = input.schemas
    .validate('harness', document)
    .map((issue) => formatValidationIssue(issue));

  if (!isObject(document)) {
    return {
      harnessPath: input.harnessPath,
      schemaIssues,
      compatibilityIssues: [],
      referenceIssues: [],
      checkedReferences: [],
    };
  }

  const compatibilityIssues =
    schemaIssues.length === 0
      ? checkEngineCompatibility(document, input.cliVersion, input.schemas)
      : [];
  const referenceResult =
    schemaIssues.length === 0
      ? await checkHarnessReferences(input.root, document, input.schemas)
      : { issues: [], checked: [] };

  return {
    harnessPath: input.harnessPath,
    document,
    schemaIssues,
    compatibilityIssues,
    referenceIssues: referenceResult.issues,
    checkedReferences: referenceResult.checked,
  };
}

function checkEngineCompatibility(
  harness: JsonObject,
  cliVersion: string,
  schemas: SchemaRegistry,
): readonly string[] {
  const engines = getObject(harness, 'engines');
  if (engines === undefined) {
    return [];
  }

  const issues: string[] = [];
  const cliRange = getString(engines, 'cli');
  if (
    cliRange !== undefined &&
    !semver.satisfies(cliVersion, cliRange, { includePrerelease: true })
  ) {
    issues.push(`engines.cli ${cliRange} does not include CLI version ${cliVersion}`);
  }

  const schemaRanges = getObject(engines, 'schemas');
  if (schemaRanges !== undefined) {
    for (const [schemaName, range] of objectEntries(schemaRanges)) {
      if (typeof range !== 'string') {
        continue;
      }
      if (!schemas.schemaNames.has(schemaName)) {
        issues.push(`engines.schemas.${schemaName} references an unknown local schema`);
        continue;
      }
      if (!semver.satisfies(schemas.schemaVersion, range, { includePrerelease: true })) {
        issues.push(
          `engines.schemas.${schemaName} ${range} does not include local schema version ${schemas.schemaVersion}`,
        );
      }
    }
  }

  return issues;
}

async function checkHarnessReferences(
  root: string,
  harness: JsonObject,
  schemas: SchemaRegistry,
): Promise<{ readonly issues: readonly string[]; readonly checked: readonly string[] }> {
  const issues: string[] = [];
  const checked: string[] = [];

  for (const reference of collectHarnessReferences(harness)) {
    if (isExternalReference(reference.path)) {
      continue;
    }

    const localPath = stripFragment(reference.path);
    if (localPath.length === 0) {
      continue;
    }

    let absolutePath: string;
    try {
      absolutePath = resolveInsideRoot(root, localPath, reference.description);
      await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
    } catch (error) {
      if (error instanceof CliError) {
        issues.push(error.message);
        continue;
      }
      throw error;
    }
    const kind = await pathKind(absolutePath);
    const checkedPath = relativePathFromRoot(root, absolutePath, reference.description);
    checked.push(checkedPath);
    if (kind === undefined) {
      issues.push(`${reference.description} not found: ${localPath}`);
      continue;
    }

    if (reference.schemaName !== undefined) {
      const validationTargets =
        kind === 'directory' ? await schemaDocumentsInDirectory(absolutePath) : [absolutePath];
      if (validationTargets.length === 0) {
        issues.push(`${reference.description} has no YAML or JSON artifacts: ${localPath}`);
        continue;
      }
      for (const target of validationTargets) {
        await assertNoSymlinkWithinRoot(root, target, 'read');
        const relativeTarget = target.startsWith(root)
          ? relativePathFromRoot(root, target, reference.description)
          : target;
        const document = await loadDocument(target);
        const validationIssues = schemas.validate(reference.schemaName, document);
        issues.push(...formatReferenceIssues(relativeTarget, validationIssues));
      }
    }
  }

  return { issues, checked };
}

export function collectHarnessReferences(harness: JsonObject): readonly HarnessReference[] {
  const references: HarnessReference[] = [];
  const harnessBlock = getObject(harness, 'harness');
  const failureTaxonomy =
    harnessBlock === undefined ? undefined : getString(harnessBlock, 'failure_taxonomy');
  pushReference(references, failureTaxonomy, 'failure taxonomy', 'failure-taxonomy');

  const context = getObject(harness, 'context');
  const maps = context === undefined ? undefined : getArray(context, 'maps');
  if (maps !== undefined) {
    for (const map of maps) {
      if (typeof map === 'string') {
        pushReference(references, map, 'context map');
      }
    }
  }

  pushReference(references, getString(harness, 'environment'), 'environment', 'environment');
  pushReference(
    references,
    getString(harness, 'approval_policy'),
    'approval policy',
    'approval-policy',
  );
  pushReference(references, getString(harness, 'sandbox'), 'sandbox policy', 'sandbox-policy');
  pushReferenceMap(
    references,
    getObject(harness, 'model_profiles'),
    'model profile',
    'model-profile',
  );
  pushReferenceMap(references, getObject(harness, 'agent_runners'), 'agent runner', 'agent-runner');

  const traces = getObject(harness, 'traces');
  const traceExamples = traces === undefined ? undefined : getArray(traces, 'examples');
  if (traceExamples !== undefined) {
    for (const example of traceExamples) {
      if (typeof example === 'string') {
        pushReference(references, example, 'trace example', 'trace');
      }
    }
  }

  const evals = getObject(harness, 'evals');
  const suites = evals === undefined ? undefined : getArray(evals, 'suites');
  if (suites !== undefined) {
    for (const suite of suites) {
      if (isObject(suite)) {
        pushReference(references, getString(suite, 'tasks'), 'eval task suite', 'eval-task');
      }
    }
  }

  const judges = getObject(harness, 'judges');
  const judgePolicies = judges === undefined ? undefined : getArray(judges, 'policies');
  if (judgePolicies !== undefined) {
    for (const policy of judgePolicies) {
      if (typeof policy === 'string') {
        pushReference(references, policy, 'judge policy', 'judge-policy');
      }
    }
  }

  const doctor = getObject(harness, 'doctor');
  const checks = doctor === undefined ? undefined : getArray(doctor, 'checks');
  if (checks !== undefined) {
    for (const check of checks) {
      if (isObject(check)) {
        pushReference(references, getString(check, 'path'), 'doctor check');
      }
    }
  }

  const recurringProfiles = getObject(harness, 'recurring_profiles');
  const profiles =
    recurringProfiles === undefined ? undefined : getArray(recurringProfiles, 'profiles');
  if (profiles !== undefined) {
    for (const profile of profiles) {
      if (typeof profile === 'string') {
        pushReference(references, profile, 'recurring profile', 'recurring-profile');
      }
    }
  }

  return references;
}

function pushReference(
  references: HarnessReference[],
  path: string | undefined,
  description: string,
  schemaName?: string,
): void {
  if (path === undefined) {
    return;
  }
  references.push(
    schemaName === undefined ? { path, description } : { path, description, schemaName },
  );
}

function pushReferenceMap(
  references: HarnessReference[],
  map: JsonObject | undefined,
  description: string,
  schemaName: string,
): void {
  if (map === undefined) {
    return;
  }
  for (const value of Object.values(map)) {
    if (typeof value === 'string') {
      pushReference(references, value, description, schemaName);
    }
  }
}

function isExternalReference(reference: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference) || reference.startsWith('#');
}

function stripFragment(reference: string): string {
  const fragmentIndex = reference.indexOf('#');
  return fragmentIndex === -1 ? reference : reference.slice(0, fragmentIndex);
}

async function schemaDocumentsInDirectory(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(?:json|ya?ml)$/.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort();
}

function formatReferenceIssues(
  path: string,
  issues: readonly ValidationIssue[],
): readonly string[] {
  return issues.map((issue) => `${path}: ${formatValidationIssue(issue)}`);
}
