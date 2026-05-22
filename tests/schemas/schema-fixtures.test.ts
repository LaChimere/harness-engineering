import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { validateAdapterScopeAgainstMatrix } from '../../src/lib/adapter-scope.ts';
import { loadDocument } from '../../src/lib/files.ts';
import {
  getArray,
  getObject,
  getString,
  getValue,
  isObject,
  type JsonObject,
} from '../../src/lib/json.ts';
import { loadSchemaRegistry } from '../../src/lib/schema-registry.ts';

interface Manifest {
  readonly valid: readonly ValidFixture[];
  readonly invalid: readonly InvalidFixture[];
  readonly custom_valid?: readonly CustomValidFixture[];
  readonly custom_invalid?: readonly CustomInvalidFixture[];
  readonly failure_taxonomy_required_codes: readonly string[];
  readonly plugin_capability_matrix_invariants: MatrixInvariantRules;
}

interface MatrixInvariantRules {
  readonly capability_dimensions: readonly string[];
  readonly limited_adapter_core_capabilities: readonly string[];
  readonly rich_ux_capabilities: readonly string[];
  readonly out_of_scope_surface_kinds: readonly string[];
  readonly out_of_scope_distribution_surfaces: readonly string[];
  readonly tier_stage9_consequences: Readonly<Record<string, string>>;
  readonly null_decision_stage9_consequences: Readonly<Record<string, string>>;
  readonly selectable_tiers: readonly string[];
}

interface ValidFixture {
  readonly path: string;
  readonly schema: string;
}

interface InvalidFixture {
  readonly path: string;
  readonly schema: string;
  readonly expected_keyword: string;
  readonly expected_path: readonly (string | number)[];
  readonly expected_message_contains?: string;
}

interface CustomInvalidFixture {
  readonly path: string;
  readonly check: string;
  readonly matrix?: string;
  readonly expected_missing_code?: string;
  readonly expected_error_code?: string;
  readonly expected_message_contains?: string;
}

interface CustomValidFixture {
  readonly path: string;
  readonly check: string;
  readonly matrix?: string;
}

test('schema-invalid fixtures fail with their manifest-declared reason', async () => {
  const manifest = await loadManifest();
  const schemas = await loadSchemaRegistry(process.cwd());

  for (const fixture of manifest.invalid) {
    const document = await loadDocument(fixture.path);
    const schemaName = schemaNameFromPath(fixture.schema);
    const expectedPath = jsonPointer(fixture.expected_path);
    const matchingIssues = schemas.validate(schemaName, document).filter((issue) => {
      return (
        issue.keyword === fixture.expected_keyword &&
        issue.path === expectedPath &&
        messageMatches(issue.message, fixture.expected_message_contains)
      );
    });
    expect(matchingIssues.length).toBe(1);

    const [issue] = matchingIssues;
    if (issue === undefined) {
      throw new Error(`Fixture unexpectedly passed: ${fixture.path}`);
    }

    expect(issue.keyword).toBe(fixture.expected_keyword);
    expect(issue.path).toBe(expectedPath);
    if (fixture.expected_message_contains !== undefined) {
      expect(messageMatches(issue.message, fixture.expected_message_contains)).toBe(true);
    }
  }
});

test('schema-valid fixtures pass their declared schemas', async () => {
  const manifest = await loadManifest();
  const schemas = await loadSchemaRegistry(process.cwd());

  for (const fixture of manifest.valid) {
    const document = await loadDocument(fixture.path);
    const schemaName = schemaNameFromPath(fixture.schema);
    expect(schemas.validate(schemaName, document)).toEqual([]);
  }
});

test('custom-valid fixtures pass semantic checks', async () => {
  const manifest = await loadManifest();
  for (const fixture of manifest.custom_valid ?? []) {
    expect(await runCustomCheck(fixture, await loadDocument(fixture.path), manifest)).toEqual([]);
  }
});

test('custom-invalid fixtures fail with their manifest-declared reason', async () => {
  const manifest = await loadManifest();
  for (const fixture of manifest.custom_invalid ?? []) {
    const errors = await runCustomCheck(fixture, await loadDocument(fixture.path), manifest);
    expect(errors.length).toBeGreaterThan(0);
    if (fixture.expected_message_contains !== undefined) {
      expect(errors.some((error) => error.includes(fixture.expected_message_contains ?? ''))).toBe(
        true,
      );
    }
    if (fixture.expected_error_code !== undefined) {
      expect(errors.some((error) => error.startsWith(`[${fixture.expected_error_code}]`))).toBe(
        true,
      );
    }
    if (fixture.expected_missing_code !== undefined) {
      expect(errors).toEqual([`missing starter code: ${fixture.expected_missing_code}`]);
    }
  }
});

async function loadManifest(): Promise<Manifest> {
  const manifest = JSON.parse(
    await readFile('examples/fixtures/manifest.json', 'utf8'),
  ) as Manifest;
  return manifest;
}

function messageMatches(message: string, expected: string | undefined): boolean {
  if (expected === undefined) {
    return true;
  }
  return message.includes(expected) || message.includes(expected.replaceAll("'", ''));
}

function schemaNameFromPath(path: string): string {
  const match = /^schemas\/(.+)\.schema\.json$/.exec(path);
  if (match?.[1] === undefined) {
    throw new Error(`Unexpected schema path in manifest: ${path}`);
  }
  return match[1];
}

function jsonPointer(path: readonly (string | number)[]): string {
  if (path.length === 0) {
    return '';
  }
  return `/${path.map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function missingTaxonomyCodes(
  requiredCodes: ReadonlySet<string>,
  document: unknown,
): readonly string[] {
  if (!isObject(document)) {
    throw new Error('Failure taxonomy fixture must be an object.');
  }
  const codes = getArray(document, 'codes');
  if (codes === undefined) {
    throw new Error('Failure taxonomy fixture is missing codes.');
  }

  const actualCodes = new Set<string>();
  for (const entry of codes) {
    if (!isObject(entry)) {
      continue;
    }
    const code = getString(entry, 'code');
    if (code !== undefined) {
      actualCodes.add(code);
    }
  }

  return [...requiredCodes].filter((code) => !actualCodes.has(code)).sort();
}

async function runCustomCheck(
  fixture: CustomValidFixture | CustomInvalidFixture,
  document: unknown,
  manifest: Manifest,
): Promise<readonly string[]> {
  switch (fixture.check) {
    case 'failure_taxonomy_required_codes':
      return missingTaxonomyCodes(new Set(manifest.failure_taxonomy_required_codes), document).map(
        (code) => `missing starter code: ${code}`,
      );
    case 'plugin_capability_matrix_invariants':
      return validatePluginCapabilityMatrix(document, manifest.plugin_capability_matrix_invariants);
    case 'adapter_scope_matrix_subset':
      return validateAdapterScopeAgainstMatrix(
        document,
        await loadDocument(adapterScopeMatrixPath(fixture, document)),
      ).errors;
    default:
      throw new Error(`Unknown custom check: ${fixture.check}`);
  }
}

function adapterScopeMatrixPath(
  fixture: CustomValidFixture | CustomInvalidFixture,
  document: unknown,
): string {
  if (fixture.matrix !== undefined) {
    return fixture.matrix;
  }
  if (isObject(document)) {
    const matrixRef = getString(document, 'matrix_ref');
    if (matrixRef !== undefined) {
      return matrixRef;
    }
  }
  throw new Error(`Custom check ${fixture.check} requires a matrix path.`);
}

function matrixError(code: string, message: string): string {
  return `[${code}] ${message}`;
}

function validatePluginCapabilityMatrix(
  document: unknown,
  rules: MatrixInvariantRules,
): readonly string[] {
  const errors: string[] = [];
  if (!isObject(document)) {
    return [matrixError('PCM_MATRIX_TYPE', 'plugin capability matrix must be an object')];
  }

  const dimensions = getArray(document, 'capability_dimensions') ?? [];
  const dimensionSet = new Set(dimensions.filter((dimension) => typeof dimension === 'string'));
  for (const dimension of rules.capability_dimensions) {
    if (!dimensionSet.has(dimension)) {
      errors.push(
        matrixError('PCM_DIMENSION_MISSING', `missing capability dimension: ${dimension}`),
      );
    }
  }

  const hosts = getArray(document, 'hosts') ?? [];
  const hostsById = new Map<string, JsonObject>();
  const globalEvidenceIds = new Set<string>();
  for (const [index, host] of hosts.entries()) {
    if (!isObject(host)) {
      errors.push(matrixError('PCM_HOST_TYPE', `hosts[${index}] must be an object`));
      continue;
    }

    const hostInfo = getObject(host, 'host');
    const hostId = hostInfo === undefined ? undefined : getString(hostInfo, 'id');
    if (hostId === undefined) {
      errors.push(matrixError('PCM_HOST_ID_MISSING', `hosts[${index}] is missing host.id`));
      continue;
    }
    if (hostsById.has(hostId)) {
      errors.push(matrixError('PCM_HOST_DUPLICATE', `duplicate host id: ${hostId}`));
    }
    hostsById.set(hostId, host);

    const localEvidenceIds = collectEvidenceIds(host, hostId, globalEvidenceIds, errors);
    validateHostCapabilities(host, hostId, localEvidenceIds, rules, errors);
    validateHostTier(host, hostId, rules, errors);
  }

  validateMatrixDecision(document, hostsById, rules, errors);
  return errors;
}

function collectEvidenceIds(
  host: JsonObject,
  hostId: string,
  globalEvidenceIds: Set<string>,
  errors: string[],
): ReadonlySet<string> {
  const localEvidenceIds = new Set<string>();
  for (const [index, evidence] of (getArray(host, 'evidence') ?? []).entries()) {
    if (!isObject(evidence)) {
      errors.push(
        matrixError('PCM_EVIDENCE_TYPE', `${hostId}.evidence[${index}] must be an object`),
      );
      continue;
    }
    const evidenceId = getString(evidence, 'evidence_id');
    if (evidenceId === undefined) {
      errors.push(
        matrixError('PCM_EVIDENCE_ID_MISSING', `${hostId}.evidence[${index}] missing evidence_id`),
      );
      continue;
    }
    if (globalEvidenceIds.has(evidenceId)) {
      errors.push(matrixError('PCM_EVIDENCE_DUPLICATE', `duplicate evidence_id: ${evidenceId}`));
    }
    globalEvidenceIds.add(evidenceId);
    localEvidenceIds.add(evidenceId);
  }
  return localEvidenceIds;
}

function validateHostCapabilities(
  host: JsonObject,
  hostId: string,
  localEvidenceIds: ReadonlySet<string>,
  rules: MatrixInvariantRules,
  errors: string[],
): void {
  const capabilities = getObject(host, 'capabilities');
  if (capabilities === undefined) {
    errors.push(matrixError('PCM_CAPABILITIES_MISSING', `${hostId} is missing capabilities`));
    return;
  }

  for (const dimension of rules.capability_dimensions) {
    const capability = getObject(capabilities, dimension);
    if (capability === undefined) {
      errors.push(matrixError('PCM_CAPABILITY_MISSING', `${hostId}.${dimension} is missing`));
      continue;
    }
    for (const evidenceId of getArray(capability, 'evidence_ids') ?? []) {
      if (typeof evidenceId !== 'string') {
        errors.push(
          matrixError(
            'PCM_EVIDENCE_REFERENCE_TYPE',
            `${hostId}.${dimension} references a non-string evidence id`,
          ),
        );
      } else if (!localEvidenceIds.has(evidenceId)) {
        errors.push(
          matrixError(
            'PCM_EVIDENCE_DANGLING',
            `${hostId}.${dimension} references missing evidence_id: ${evidenceId}`,
          ),
        );
      }
    }
  }
}

function validateHostTier(
  host: JsonObject,
  hostId: string,
  rules: MatrixInvariantRules,
  errors: string[],
): void {
  const tier = getString(host, 'tier');
  const candidateStatus = getString(host, 'candidate_status');
  const stage9Consequence = getString(host, 'stage9_consequence');
  const surfaceKind = getString(host, 'surface_kind');
  const distributionSurface = getString(host, 'distribution_surface');
  const capabilities = getObject(host, 'capabilities');
  if (capabilities === undefined) {
    return;
  }

  if (
    surfaceKind !== undefined &&
    rules.out_of_scope_surface_kinds.includes(surfaceKind) &&
    candidateStatus !== 'out-of-scope-future-evidence'
  ) {
    errors.push(
      matrixError(
        'PCM_OUT_OF_SCOPE_SURFACE',
        `${hostId} ${surfaceKind} surface must be out-of-scope future evidence`,
      ),
    );
  }

  if (
    distributionSurface !== undefined &&
    rules.out_of_scope_distribution_surfaces.includes(distributionSurface) &&
    candidateStatus !== 'out-of-scope-future-evidence'
  ) {
    errors.push(
      matrixError(
        'PCM_OUT_OF_SCOPE_DISTRIBUTION',
        `${hostId} ${distributionSurface} distribution must be out-of-scope future evidence`,
      ),
    );
  }

  const expectedConsequence = tier === undefined ? undefined : rules.tier_stage9_consequences[tier];
  if (expectedConsequence !== undefined && stage9Consequence !== expectedConsequence) {
    errors.push(
      matrixError(
        'PCM_TIER_CONSEQUENCE',
        `${hostId} ${tier} tier must use ${expectedConsequence} consequence`,
      ),
    );
  }

  if (tier === 'future-adapter-evidence' && candidateStatus !== 'out-of-scope-future-evidence') {
    errors.push(
      matrixError(
        'PCM_FUTURE_TIER_CANDIDATE',
        `${hostId} future-adapter-evidence tier must be out-of-scope future evidence`,
      ),
    );
  }

  if (candidateStatus === 'out-of-scope-future-evidence') {
    if (tier !== 'future-adapter-evidence') {
      errors.push(
        matrixError(
          'PCM_FUTURE_CANDIDATE_TIER',
          `${hostId} future evidence must use future-adapter-evidence tier`,
        ),
      );
    }
    if (stage9Consequence !== 'future-evidence-only') {
      errors.push(
        matrixError(
          'PCM_FUTURE_CANDIDATE_CONSEQUENCE',
          `${hostId} future evidence must use future-evidence-only consequence`,
        ),
      );
    }
  }

  if (tier === 'full-plugin') {
    for (const dimension of rules.capability_dimensions) {
      const capability = getObject(capabilities, dimension);
      if (
        capability !== undefined &&
        (getString(capability, 'status') !== 'yes' ||
          getString(capability, 'fallback') !== 'supported')
      ) {
        errors.push(
          matrixError(
            'PCM_FULL_PLUGIN_CAPABILITY',
            `${hostId} full-plugin tier requires ${dimension} to be fully supported`,
          ),
        );
      }
    }
  }

  if (tier === 'limited-adapter') {
    for (const dimension of rules.limited_adapter_core_capabilities) {
      const capability = getObject(capabilities, dimension);
      const status = capability === undefined ? undefined : getString(capability, 'status');
      const fallback = capability === undefined ? undefined : getString(capability, 'fallback');
      if (status !== 'yes' || fallback !== 'supported') {
        errors.push(
          matrixError(
            'PCM_CORE_CAPABILITY',
            `${hostId} limited-adapter tier requires supported core capability ${dimension}`,
          ),
        );
      }
    }

    const missingRichUx = rules.rich_ux_capabilities.some((dimension) => {
      const capability = getObject(capabilities, dimension);
      return (
        capability === undefined ||
        getString(capability, 'status') !== 'yes' ||
        getString(capability, 'fallback') !== 'supported'
      );
    });
    if (!missingRichUx) {
      errors.push(
        matrixError(
          'PCM_LIMITED_RICH_UX',
          `${hostId} limited-adapter tier must be missing at least one rich UX capability`,
        ),
      );
    }
  }

  if (tier === 'cli-first-fallback') {
    const missingCoreCapability = rules.limited_adapter_core_capabilities.some((dimension) => {
      const capability = getObject(capabilities, dimension);
      return (
        capability === undefined ||
        getString(capability, 'status') !== 'yes' ||
        getString(capability, 'fallback') !== 'supported'
      );
    });
    if (!missingCoreCapability) {
      errors.push(
        matrixError(
          'PCM_CLI_FALLBACK_CORE_SUPPORTED',
          `${hostId} cli-first-fallback tier must be missing at least one core capability`,
        ),
      );
    }
  }
}

function validateMatrixDecision(
  matrix: JsonObject,
  hostsById: ReadonlyMap<string, JsonObject>,
  rules: MatrixInvariantRules,
  errors: string[],
): void {
  const decision = getObject(matrix, 'decision');
  if (decision === undefined) {
    errors.push(matrixError('PCM_DECISION_MISSING', 'matrix decision is missing'));
    return;
  }

  const selectedHostValue = getValue(decision, 'selected_host_id');
  if (selectedHostValue === null) {
    const selectedTier = getString(decision, 'selected_tier');
    if (selectedTier !== 'cli-first-fallback' && selectedTier !== 'none') {
      errors.push(
        matrixError(
          'PCM_DECISION_NULL_TIER',
          'matrix without selected_host_id must use cli-first-fallback or none tier',
        ),
      );
    }
    const expectedConsequence =
      selectedTier === undefined
        ? undefined
        : rules.null_decision_stage9_consequences[selectedTier];
    if (
      expectedConsequence !== undefined &&
      getString(decision, 'stage9_consequence') !== expectedConsequence
    ) {
      errors.push(
        matrixError(
          'PCM_DECISION_NULL_CONSEQUENCE',
          `matrix without selected_host_id and ${selectedTier} tier must use ${expectedConsequence} consequence`,
        ),
      );
    }
    return;
  }

  if (typeof selectedHostValue !== 'string') {
    errors.push(
      matrixError(
        'PCM_DECISION_SELECTED_TYPE',
        'matrix decision selected_host_id must be a string or null',
      ),
    );
    return;
  }

  const selectedHost = hostsById.get(selectedHostValue);
  if (selectedHost === undefined) {
    errors.push(
      matrixError(
        'PCM_DECISION_UNKNOWN_HOST',
        `matrix decision references unknown selected_host_id: ${selectedHostValue}`,
      ),
    );
    return;
  }

  const selectedTier = getString(selectedHost, 'tier');
  if (selectedTier === undefined || !rules.selectable_tiers.includes(selectedTier)) {
    errors.push(
      matrixError(
        'PCM_DECISION_UNSELECTABLE_TIER',
        `matrix decision cannot select ${selectedHostValue} at tier ${selectedTier}`,
      ),
    );
  }
  if (getString(selectedHost, 'candidate_status') !== 'in-scope-candidate') {
    errors.push(
      matrixError(
        'PCM_DECISION_OUT_OF_SCOPE',
        `matrix decision cannot select out-of-scope host: ${selectedHostValue}`,
      ),
    );
  }
  if (getString(decision, 'selected_tier') !== selectedTier) {
    errors.push(
      matrixError(
        'PCM_DECISION_TIER_MISMATCH',
        `matrix decision selected_tier must match selected host tier: ${selectedTier}`,
      ),
    );
  }

  const hostConsequence = getString(selectedHost, 'stage9_consequence');
  if (getString(decision, 'stage9_consequence') !== hostConsequence) {
    errors.push(
      matrixError(
        'PCM_DECISION_CONSEQUENCE_MISMATCH',
        `matrix decision stage9_consequence must match selected host stage9_consequence: ${hostConsequence}`,
      ),
    );
  }
}
