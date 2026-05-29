import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';
import { assertNoSymlinkWithinRoot, loadDocument, pathKind } from './files.ts';
import { validateHarnessConfiguration } from './harness.ts';
import { getArray, getObject, getString, getValue, isObject, type JsonObject } from './json.ts';
import { relativePathFromRoot, resolveInsideRoot } from './paths.ts';
import { formatValidationIssue, type ISchemaRegistry } from './schema-registry.ts';

type EvidenceKind = 'gc-evidence' | 'health-result' | 'profile-run';
type StopStatus = 'met' | 'not_met' | 'inconclusive';

interface ILoadedEvidence {
  readonly kind: EvidenceKind;
  readonly path: string;
  readonly sha256: string;
  readonly document: JsonObject;
}

interface IConditionObservation {
  readonly metric: string;
  readonly actual: string | number | boolean | null;
  readonly comparator: string;
  readonly expected: string | number | boolean;
  readonly matched: boolean;
}

interface IConditionResult {
  readonly matched: boolean;
  readonly observations: IConditionObservation[];
}

export interface IProfileRunRequest {
  readonly root: string;
  readonly harnessPath: string;
  readonly profilePath: string;
  readonly cliVersion: string;
  readonly schemas: ISchemaRegistry;
  readonly runId?: string;
  readonly gcEvidencePath?: string;
  readonly healthResultPath?: string;
  readonly previousRunPath?: string;
  readonly outputPath?: string;
  readonly generatedAt?: string;
}

export interface IProfileRun {
  readonly result: JsonObject;
  readonly markdown: string;
  readonly status: StopStatus;
}

const schemaVersion = '0.2.0';

export async function loadRecurringProfile(input: {
  readonly root: string;
  readonly profilePath: string;
  readonly schemas: ISchemaRegistry;
}): Promise<{ readonly path: string; readonly document: JsonObject }> {
  const path = await canonicalFilePath(input.root, input.profilePath, 'Profile');
  const document = await loadSchemaObject(input.root, path, 'recurring-profile', input.schemas);
  const capabilityId = getValue(document, 'declared_capability_id');
  if (capabilityId !== undefined && capabilityId !== null) {
    throw new CliError(
      'Recurring profiles must not declare capability adoption. Leave declared_capability_id null until a separately approved capability adoption exists.',
      ExitCode.validationError,
    );
  }
  return { path, document };
}

async function loadProfileHarness(input: IProfileRunRequest): Promise<JsonObject> {
  const validation = await validateHarnessConfiguration({
    root: input.root,
    harnessPath: input.harnessPath,
    cliVersion: input.cliVersion,
    schemas: input.schemas,
  });
  const issues = [
    ...validation.schemaIssues.map((issue) => `schema: ${issue}`),
    ...validation.compatibilityIssues.map((issue) => `engines: ${issue}`),
    ...validation.referenceIssues.map((issue) => `reference: ${issue}`),
  ];
  if (issues.length > 0 || validation.document === undefined) {
    throw new CliError(
      `Harness validation failed for ${validation.harnessPath}: ${issues.join('; ')}`,
      ExitCode.validationError,
    );
  }
  return validation.document;
}

async function profilePathFromHarness(
  root: string,
  harness: JsonObject,
  profilePath: string,
): Promise<string> {
  const requestedProfilePath = await canonicalFilePath(root, profilePath, 'Profile');
  const recurringProfiles = getObject(harness, 'recurring_profiles');
  if (recurringProfiles === undefined) {
    throw new CliError(
      'profile run requires harness.yaml recurring_profiles configuration.',
      ExitCode.validationError,
    );
  }
  const configuredProfiles = (getArray(recurringProfiles, 'profiles') ?? [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) =>
      relativePathFromRoot(root, resolveInsideRoot(root, value, 'Profile'), 'Profile'),
    );
  if (!configuredProfiles.includes(requestedProfilePath)) {
    throw new CliError(
      `profile run requires ${requestedProfilePath} to be listed in harness.yaml recurring_profiles.profiles.`,
      ExitCode.validationError,
    );
  }
  return requestedProfilePath;
}

export async function runProfile(input: IProfileRunRequest): Promise<IProfileRun> {
  const harness = await loadProfileHarness(input);
  const canonicalProfilePath = await profilePathFromHarness(input.root, harness, input.profilePath);
  const profile = await loadRecurringProfile({
    root: input.root,
    profilePath: canonicalProfilePath,
    schemas: input.schemas,
  });
  validateEvidencePathsAgainstProfile(input.root, profile.document, [
    input.gcEvidencePath,
    input.healthResultPath,
    input.previousRunPath,
  ]);
  if (input.outputPath !== undefined) {
    validateProfileOutput(input.root, harness, profile.document, input.outputPath);
  }
  const requiredInputs = profileInputs(profile.document).filter(
    (profileInput) => profileInput.required,
  );
  const declaredInputKinds = new Set(
    profileInputs(profile.document).map((profileInput) => profileInput.kind),
  );
  for (const suppliedKind of suppliedEvidenceKinds(input)) {
    if (!declaredInputKinds.has(suppliedKind)) {
      throw new CliError(
        `profile run supplied ${suppliedKind} evidence, but that kind is not declared in profile.inputs.`,
        ExitCode.validationError,
      );
    }
  }
  const gcEvidence =
    input.gcEvidencePath === undefined
      ? undefined
      : await loadEvidence(input.root, input.gcEvidencePath, 'gc-evidence', input.schemas);
  const healthResult =
    input.healthResultPath === undefined
      ? undefined
      : await loadEvidence(input.root, input.healthResultPath, 'health-result', input.schemas);
  const previousRun =
    input.previousRunPath === undefined
      ? undefined
      : await loadEvidence(input.root, input.previousRunPath, 'profile-run', input.schemas);

  const evidenceByKind = new Map<EvidenceKind, ILoadedEvidence>(
    [gcEvidence, healthResult, previousRun]
      .filter((value): value is ILoadedEvidence => value !== undefined)
      .map((value) => [value.kind, value]),
  );
  for (const requiredInput of requiredInputs) {
    if (!evidenceByKind.has(requiredInput.kind)) {
      throw new CliError(
        `profile run requires --${optionNameForEvidence(requiredInput.kind)} for input ${requiredInput.id}.`,
        ExitCode.validationError,
      );
    }
  }
  if (previousRun !== undefined) {
    validatePreviousRun(profile.document, previousRun.document);
  }

  const metrics = metricsForEvidence(gcEvidence, healthResult, previousRun);
  const trigger = evaluateCondition(getObject(profile.document, 'trigger') ?? {}, metrics);
  const stopBase = evaluateCondition(getObject(profile.document, 'stop_condition') ?? {}, metrics);
  const currentClean = trigger.matched && stopBase.matched;
  const previousStreak =
    previousRun === undefined
      ? 0
      : (getNumber(
          getObject(previousRun.document, 'stop_condition_evaluation') ?? {},
          'clean_streak',
        ) ?? 0);
  const cleanStreak = currentClean ? previousStreak + 1 : 0;
  const metricsWithStreak = new Map(metrics).set('profile.clean_streak', cleanStreak);
  const stopCondition = evaluateCondition(
    getObject(profile.document, 'stop_condition') ?? {},
    metricsWithStreak,
  );
  const status: StopStatus = !trigger.matched
    ? 'inconclusive'
    : stopCondition.matched
      ? 'met'
      : 'not_met';
  const evidenceInputs = [gcEvidence, healthResult, previousRun]
    .filter((value): value is ILoadedEvidence => value !== undefined)
    .map((value) => hashedArtifact(value));
  const handoff = {
    kind: 'profile-run',
    status,
    ['next_step']: status === 'met' ? 'stop' : 'continue',
    summary: handoffSummary(status, metricsWithStreak),
  };
  const issues = profileIssues(status, handoff.summary);
  const result: JsonObject = {
    ['schema_version']: schemaVersion,
    ['run_id']: input.runId ?? `profile-${randomUUID()}`,
    ['harness_version']: input.cliVersion,
    ['generated_at']: input.generatedAt ?? new Date().toISOString(),
    status,
    ['profile_ref']: await hashedFile(
      input.root,
      profile.path,
      'application/yaml',
      'Recurring profile.',
    ),
    ['profile_id']: requiredString(profile.document, 'profile_id'),
    ['profile_version']: requiredString(profile.document, 'profile_version'),
    ['declared_capability_id']: null,
    ...(previousRun === undefined ? {} : { ['previous_run_ref']: hashedArtifactRef(previousRun) }),
    ['evidence_inputs']: evidenceInputs,
    ['trigger_evaluation']: conditionResultJson(trigger),
    ['stop_condition_evaluation']: {
      matched: stopCondition.matched,
      observations: observationsJson(stopCondition.observations),
      status,
      ['clean_streak']: cleanStreak,
    },
    ['actions_taken']: actionsForProfile(profile.document, status, metricsWithStreak),
    handoff,
    ...(issues.length === 0 ? {} : { issues }),
  };
  return {
    result,
    markdown: renderProfileRunMarkdown(result),
    status,
  };
}

function profileIssues(status: StopStatus, summary: string): JsonObject[] {
  switch (status) {
    case 'met':
      return [];
    case 'not_met':
      return [
        {
          code: 'profile-stop-condition-not-met',
          severity: 'warning',
          message: summary,
        },
      ];
    case 'inconclusive':
      return [
        {
          code: 'profile-inconclusive',
          severity: 'warning',
          message: summary,
        },
      ];
  }
}

export function serializeProfileRunJson(result: JsonObject): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function suppliedEvidenceKinds(input: IProfileRunRequest): EvidenceKind[] {
  const kinds: EvidenceKind[] = [];
  if (input.gcEvidencePath !== undefined) {
    kinds.push('gc-evidence');
  }
  if (input.healthResultPath !== undefined) {
    kinds.push('health-result');
  }
  if (input.previousRunPath !== undefined) {
    kinds.push('profile-run');
  }
  return kinds;
}

function profileInputs(
  profile: JsonObject,
): Array<{ id: string; kind: EvidenceKind; required: boolean }> {
  return (getArray(profile, 'inputs') ?? []).filter(isObject).map((input) => ({
    id: requiredString(input, 'id'),
    kind: evidenceKind(requiredString(input, 'kind')),
    required: getValue(input, 'required') === true,
  }));
}

function validatePreviousRun(profile: JsonObject, previousRun: JsonObject): void {
  const profileId = requiredString(profile, 'profile_id');
  const profileVersion = requiredString(profile, 'profile_version');
  if (getString(previousRun, 'schema_version') !== schemaVersion) {
    throw new CliError(
      'previous profile run schema_version does not match this CLI.',
      ExitCode.validationError,
    );
  }
  if (getString(previousRun, 'profile_id') !== profileId) {
    throw new CliError(
      `previous profile run profile_id ${getString(previousRun, 'profile_id') ?? '<missing>'} does not match ${profileId}.`,
      ExitCode.validationError,
    );
  }
  if (getString(previousRun, 'profile_version') !== profileVersion) {
    throw new CliError(
      `previous profile run profile_version ${getString(previousRun, 'profile_version') ?? '<missing>'} does not match ${profileVersion}.`,
      ExitCode.validationError,
    );
  }
  if (getValue(previousRun, 'declared_capability_id') !== null) {
    throw new CliError(
      'previous profile run declared_capability_id must be null for the current recurring profile contract.',
      ExitCode.validationError,
    );
  }
}

function validateEvidencePathsAgainstProfile(
  root: string,
  profile: JsonObject,
  paths: readonly (string | undefined)[],
): void {
  const trust = getObject(profile, 'trust_requirements') ?? {};
  const allowedInputs = normalizedDeclaredPaths(root, getArray(trust, 'allowed_inputs') ?? []);
  for (const path of paths) {
    if (path === undefined) {
      continue;
    }
    const canonicalPath = canonicalDeclaredPath(root, path, 'Profile evidence input');
    if (!declaresPath(allowedInputs, canonicalPath)) {
      throw new CliError(
        `profile evidence input is not declared in trust_requirements.allowed_inputs: ${path}`,
        ExitCode.validationError,
      );
    }
  }
}

export function validateProfileOutputPath(
  root: string,
  profile: JsonObject,
  outputPath: string,
): void {
  const trust = getObject(profile, 'trust_requirements') ?? {};
  const allowedOutputs = normalizedDeclaredPaths(root, getArray(trust, 'allowed_outputs') ?? []);
  const canonicalOutput = canonicalDeclaredPath(root, outputPath, 'Profile output');
  if (!declaresPath(allowedOutputs, canonicalOutput)) {
    throw new CliError(
      `profile output is not declared in trust_requirements.allowed_outputs: ${outputPath}`,
      ExitCode.validationError,
    );
  }
}

function validateProfileOutput(
  root: string,
  harness: JsonObject,
  profile: JsonObject,
  outputPath: string,
): void {
  validateProfileOutputDir(root, harness, outputPath);
  validateProfileOutputPath(root, profile, outputPath);
}

function validateProfileOutputDir(root: string, harness: JsonObject, outputPath: string): void {
  const recurringProfiles = getObject(harness, 'recurring_profiles');
  const outputDir =
    recurringProfiles === undefined ? undefined : getString(recurringProfiles, 'output_dir');
  if (outputDir === undefined) {
    throw new CliError(
      'profile run --output requires harness.yaml recurring_profiles.output_dir.',
      ExitCode.validationError,
    );
  }
  const outputDirPath = relativePathFromRoot(
    root,
    resolveInsideRoot(root, outputDir, 'Profile output directory'),
    'Profile output directory',
  );
  const canonicalOutput = canonicalDeclaredPath(root, outputPath, 'Profile output');
  if (!declaresPath([outputDirPath], canonicalOutput)) {
    throw new CliError(
      `profile output must be under harness.yaml recurring_profiles.output_dir: ${outputDirPath}`,
      ExitCode.validationError,
    );
  }
}

async function loadEvidence(
  root: string,
  path: string,
  kind: EvidenceKind,
  schemas: ISchemaRegistry,
): Promise<ILoadedEvidence> {
  const canonicalPath = await canonicalFilePath(root, path, kind);
  const document = await loadSchemaObject(root, canonicalPath, kind, schemas);
  return {
    kind,
    path: canonicalPath,
    sha256: await fileSha256(root, canonicalPath),
    document,
  };
}

function normalizedDeclaredPaths(root: string, values: readonly unknown[]): readonly string[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .filter((value) => !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !value.startsWith('#'))
    .map((value) => canonicalDeclaredPath(root, value, 'Declared profile path'))
    .sort();
}

function declaresPath(declaredPaths: readonly string[], targetPath: string): boolean {
  const normalizedTarget = targetPath.replace(/\/+$/, '');
  return declaredPaths.some(
    (declaredPath) =>
      declaredPath === '.' ||
      normalizedTarget === declaredPath ||
      normalizedTarget.startsWith(`${declaredPath}/`),
  );
}

function canonicalDeclaredPath(root: string, path: string, label: string): string {
  return relativePathFromRoot(root, resolveInsideRoot(root, path, label), label).replace(
    /\/+$/,
    '',
  );
}

async function loadSchemaObject(
  root: string,
  path: string,
  schemaName: string,
  schemas: ISchemaRegistry,
): Promise<JsonObject> {
  const document = await loadDocument(resolveInsideRoot(root, path, schemaName));
  if (!isObject(document)) {
    throw new CliError(
      `${schemaName} artifact must be an object: ${path}`,
      ExitCode.validationError,
    );
  }
  const issues = schemas.validate(schemaName, document).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(
      `${schemaName} artifact is invalid: ${issues.join('; ')}`,
      ExitCode.validationError,
    );
  }
  return document;
}

async function canonicalFilePath(root: string, path: string, label: string): Promise<string> {
  const absolutePath = resolveInsideRoot(root, path, label);
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    throw new CliError(`${label} not found: ${path}`, ExitCode.notFound);
  }
  return relativePathFromRoot(root, absolutePath, label);
}

function metricsForEvidence(
  gcEvidence: ILoadedEvidence | undefined,
  healthResult: ILoadedEvidence | undefined,
  previousRun: ILoadedEvidence | undefined,
): Map<string, string | number | boolean | null> {
  const previousStop =
    previousRun === undefined
      ? undefined
      : getObject(previousRun.document, 'stop_condition_evaluation');
  return new Map<string, string | number | boolean | null>([
    ['gc.findings.count', getArray(gcEvidence?.document ?? {}, 'findings')?.length ?? null],
    [
      'health.status',
      healthResult === undefined ? 'missing' : (getString(healthResult.document, 'status') ?? null),
    ],
    [
      'profile.clean_streak',
      previousStop === undefined ? 0 : (getNumber(previousStop, 'clean_streak') ?? 0),
    ],
  ]);
}

function evaluateCondition(
  condition: JsonObject,
  metrics: ReadonlyMap<string, string | number | boolean | null>,
): IConditionResult {
  const kind = getString(condition, 'kind');
  if (kind === 'all' || kind === 'any') {
    const results = (getArray(condition, 'conditions') ?? [])
      .filter(isObject)
      .map((child) => evaluateCondition(child, metrics));
    const observations = results.flatMap((result) => result.observations);
    return {
      matched:
        kind === 'all'
          ? results.every((result) => result.matched)
          : results.some((result) => result.matched),
      observations,
    };
  }
  const metric = requiredString(condition, 'metric');
  const comparator = requiredString(condition, 'comparator');
  const expected = getValue(condition, 'value');
  if (
    typeof expected !== 'string' &&
    typeof expected !== 'number' &&
    typeof expected !== 'boolean'
  ) {
    throw new Error(`Expected metric condition value after schema validation: ${metric}`);
  }
  const actual = metrics.get(metric) ?? null;
  const matched = compareMetric(actual, comparator, expected);
  return {
    matched,
    observations: [{ metric, actual, comparator, expected, matched }],
  };
}

function compareMetric(
  actual: string | number | boolean | null,
  comparator: string,
  expected: string | number | boolean,
): boolean {
  if (comparator === 'eq') {
    return actual === expected;
  }
  if (typeof actual !== 'number' || typeof expected !== 'number') {
    return false;
  }
  return comparator === 'lte' ? actual <= expected : actual >= expected;
}

function actionsForProfile(
  profile: JsonObject,
  status: StopStatus,
  metrics: ReadonlyMap<string, string | number | boolean | null>,
): JsonObject[] {
  const allowedActions = (getArray(profile, 'allowed_actions') ?? []).filter(
    (value): value is string => typeof value === 'string',
  );
  if (!allowedActions.includes('summary')) {
    return [];
  }
  return [
    {
      kind: 'summary',
      summary: {
        status,
        ['gc_findings']: metricNumber(metrics, 'gc.findings.count'),
        ['health_status']: metricString(metrics, 'health.status', 'missing'),
        ['clean_streak']: metricNumber(metrics, 'profile.clean_streak'),
      },
    },
  ];
}

function handoffSummary(
  status: StopStatus,
  metrics: ReadonlyMap<string, string | number | boolean | null>,
): string {
  return `gc_findings=${metricNumber(metrics, 'gc.findings.count')}; health_status=${metricString(metrics, 'health.status', 'missing')}; clean_streak=${metricNumber(metrics, 'profile.clean_streak')}; stop_condition=${status}`;
}

function renderProfileRunMarkdown(result: JsonObject): string {
  const handoff = getObject(result, 'handoff') ?? {};
  return [
    '# Harness profile run',
    '',
    `- run_id: ${getString(result, 'run_id') ?? 'unknown'}`,
    `- profile: ${getString(result, 'profile_id') ?? 'unknown'}`,
    `- status: ${getString(handoff, 'status') ?? 'unknown'}`,
    `- next_step: ${getString(handoff, 'next_step') ?? 'unknown'}`,
    `- summary: ${getString(handoff, 'summary') ?? 'unknown'}`,
    '',
  ].join('\n');
}

function conditionResultJson(result: IConditionResult): JsonObject {
  return {
    matched: result.matched,
    observations: observationsJson(result.observations),
  };
}

function observationsJson(observations: readonly IConditionObservation[]): JsonObject[] {
  return observations.map((observation) => ({
    metric: observation.metric,
    actual: observation.actual,
    comparator: observation.comparator,
    expected: observation.expected,
    matched: observation.matched,
  }));
}

function hashedArtifact(evidence: ILoadedEvidence): JsonObject {
  return {
    kind: evidence.kind,
    path: evidence.path,
    sha256: evidence.sha256,
    ['media_type']: mediaTypeForPath(evidence.path),
    description: `${evidence.kind} evidence input.`,
  };
}

function hashedArtifactRef(evidence: ILoadedEvidence): JsonObject {
  return {
    path: evidence.path,
    sha256: evidence.sha256,
    ['media_type']: mediaTypeForPath(evidence.path),
    description: `${evidence.kind} evidence input.`,
  };
}

async function hashedFile(
  root: string,
  path: string,
  mediaType: string,
  description: string,
): Promise<JsonObject> {
  return {
    path,
    sha256: await fileSha256(root, path),
    ['media_type']: mediaType,
    description,
  };
}

async function fileSha256(root: string, path: string): Promise<string> {
  const bytes = await readFile(resolveInsideRoot(root, path, 'hash input'));
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function optionNameForEvidence(kind: EvidenceKind): string {
  switch (kind) {
    case 'gc-evidence':
      return 'gc-evidence';
    case 'health-result':
      return 'health-result';
    case 'profile-run':
      return 'previous-run';
  }
}

function evidenceKind(value: string): EvidenceKind {
  if (value === 'gc-evidence' || value === 'health-result' || value === 'profile-run') {
    return value;
  }
  throw new Error(`Unexpected evidence kind after schema validation: ${value}`);
}

function metricNumber(
  metrics: ReadonlyMap<string, string | number | boolean | null>,
  key: string,
): number {
  const value = metrics.get(key);
  return typeof value === 'number' ? value : 0;
}

function metricString(
  metrics: ReadonlyMap<string, string | number | boolean | null>,
  key: string,
  fallback: string,
): string {
  const value = metrics.get(key);
  return typeof value === 'string' ? value : fallback;
}

function getNumber(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requiredString(object: JsonObject, key: string): string {
  const value = getString(object, key);
  if (value === undefined) {
    throw new Error(`Expected string field after schema validation: ${key}`);
  }
  return value;
}

function mediaTypeForPath(path: string): string {
  if (path.endsWith('.json')) {
    return 'application/json';
  }
  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    return 'application/yaml';
  }
  return 'text/plain';
}
