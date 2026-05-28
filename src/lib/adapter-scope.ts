import {
  getArray,
  getObject,
  getString,
  getValue,
  isObject,
  type JsonObject,
  type JsonValue,
} from './json.ts';

export interface IAdapterScopeValidationSummary {
  readonly selectedHostId: string;
  readonly capabilityTier: string;
  readonly implementedCount: number;
  readonly unavailableCount: number;
  readonly writeModes: Readonly<Record<string, string>>;
}

export interface IAdapterScopeValidationResult {
  readonly errors: readonly string[];
  readonly summary?: IAdapterScopeValidationSummary;
}

const capabilityDimensions = [
  'agent_cli_install_distribution',
  'cli_bundling_bootstrap',
  'filesystem_access',
  'cli_invocation',
  'cli_report_rendering',
  'annotation_apis',
  'background_runs',
  'repair_action_ui',
  'trace_deep_links',
] as const;

const requiredLimitedAdapterCapabilities = [
  'agent_cli_install_distribution',
  'cli_bundling_bootstrap',
  'filesystem_access',
  'cli_invocation',
  'cli_report_rendering',
] as const;

const fallbackRanks: Readonly<Record<string, number>> = {
  supported: 0,
  'cli-redirect': 1,
  'advisory-only': 2,
  disable: 3,
  hide: 3,
  'hard-error': 4,
};

const writeClasses = ['init', 'migrate', 'repair'] as const;

export function adapterScopeError(code: string, message: string): string {
  return `[${code}] ${message}`;
}

export function validateAdapterScopeAgainstMatrix(
  scopeDocument: JsonValue | unknown,
  matrixDocument: JsonValue | unknown,
): IAdapterScopeValidationResult {
  if (!isObject(scopeDocument)) {
    return {
      errors: [adapterScopeError('ASM_SCOPE_TYPE', 'adapter scope must be an object')],
    };
  }
  if (!isObject(matrixDocument)) {
    return {
      errors: [adapterScopeError('ASM_MATRIX_TYPE', 'plugin capability matrix must be an object')],
    };
  }

  const errors: string[] = [];
  const selectedHostId = getString(scopeDocument, 'selected_host_id');
  const decision = getObject(matrixDocument, 'decision');
  const matrixSelectedHostValue =
    decision === undefined ? undefined : getValue(decision, 'selected_host_id');
  if (selectedHostId === undefined) {
    errors.push(
      adapterScopeError('ASM_SELECTED_HOST_MISSING', 'adapter scope is missing selected_host_id'),
    );
  }
  if (typeof matrixSelectedHostValue !== 'string') {
    errors.push(
      adapterScopeError(
        'ASM_MATRIX_DECISION_UNSUPPORTED',
        'adapter validation requires a matrix decision with a selected host',
      ),
    );
  } else if (selectedHostId !== undefined && selectedHostId !== matrixSelectedHostValue) {
    errors.push(
      adapterScopeError(
        'ASM_SELECTED_HOST_MISMATCH',
        `adapter selected_host_id ${selectedHostId} must match matrix decision ${matrixSelectedHostValue}`,
      ),
    );
  }

  const selectedHost =
    selectedHostId === undefined ? undefined : findMatrixHost(matrixDocument, selectedHostId);
  if (selectedHostId !== undefined && selectedHost === undefined) {
    errors.push(
      adapterScopeError(
        'ASM_SELECTED_HOST_UNKNOWN',
        `adapter selected_host_id ${selectedHostId} is not present in matrix hosts`,
      ),
    );
  }

  if (selectedHost !== undefined) {
    validateSelectedHostFields(scopeDocument, selectedHost, decision, selectedHostId ?? '', errors);
    validateCliManagement(scopeDocument, selectedHost, selectedHostId ?? '', errors);
    validateCapabilities(scopeDocument, matrixDocument, selectedHost, selectedHostId ?? '', errors);
    validateWriteClasses(scopeDocument, selectedHost, selectedHostId ?? '', errors);
  }
  validateLocalState(scopeDocument, errors);

  const summary =
    selectedHostId === undefined
      ? undefined
      : {
          selectedHostId,
          capabilityTier: getString(scopeDocument, 'capability_tier') ?? 'unknown',
          implementedCount: countObjects(scopeDocument, 'implemented_capabilities'),
          unavailableCount: countObjects(scopeDocument, 'unavailable_capabilities'),
          writeModes: collectWriteModes(scopeDocument),
        };
  return summary === undefined ? { errors } : { errors, summary };
}

function findMatrixHost(matrix: JsonObject, hostId: string): JsonObject | undefined {
  for (const host of getArray(matrix, 'hosts') ?? []) {
    if (!isObject(host)) {
      continue;
    }
    const hostInfo = getObject(host, 'host');
    if (hostInfo !== undefined && getString(hostInfo, 'id') === hostId) {
      return host;
    }
  }
  return undefined;
}

function validateSelectedHostFields(
  scope: JsonObject,
  host: JsonObject,
  decision: JsonObject | undefined,
  hostId: string,
  errors: string[],
): void {
  if (decision !== undefined && getString(decision, 'selected_tier') !== 'limited-adapter') {
    errors.push(
      adapterScopeError(
        'ASM_MATRIX_TIER_UNSUPPORTED',
        'adapter validation currently requires a limited-adapter matrix decision',
      ),
    );
  }

  compareField(scope, host, 'capability_tier', 'tier', hostId, errors);
  compareField(scope, host, 'tier_consequence', 'tier_consequence', hostId, errors);
  compareField(scope, host, 'surface_kind', 'surface_kind', hostId, errors);
  compareField(scope, host, 'distribution_surface', 'distribution_surface', hostId, errors);

  if (getString(host, 'candidate_status') !== 'in-scope-candidate') {
    errors.push(
      adapterScopeError('ASM_HOST_OUT_OF_SCOPE', `${hostId} is not an in-scope adapter candidate`),
    );
  }
  if (getString(host, 'tier') !== 'limited-adapter') {
    errors.push(
      adapterScopeError(
        'ASM_HOST_TIER_UNSUPPORTED',
        `${hostId} must be selected at limited-adapter tier for this adapter scope`,
      ),
    );
  }
}

function compareField(
  scope: JsonObject,
  host: JsonObject,
  scopeField: string,
  hostField: string,
  hostId: string,
  errors: string[],
): void {
  const scopeValue = getString(scope, scopeField);
  const hostValue = getString(host, hostField);
  if (scopeValue !== undefined && hostValue !== undefined && scopeValue !== hostValue) {
    errors.push(
      adapterScopeError(
        'ASM_SELECTED_HOST_FIELD_MISMATCH',
        `${scopeField} ${scopeValue} must match ${hostId}.${hostField} ${hostValue}`,
      ),
    );
  }
}

function validateCliManagement(
  scope: JsonObject,
  host: JsonObject,
  hostId: string,
  errors: string[],
): void {
  const scopeModes = new Set(
    (getArray(scope, 'cli_management_modes') ?? []).filter(
      (mode): mode is string => typeof mode === 'string',
    ),
  );
  const hostModes = new Set(
    (getArray(host, 'cli_management_modes') ?? []).filter(
      (mode): mode is string => typeof mode === 'string',
    ),
  );
  for (const field of ['cli_management_modes', 'cli_resolution_order'] as const) {
    for (const mode of (getArray(scope, field) ?? []).filter(
      (value): value is string => typeof value === 'string',
    )) {
      if (!hostModes.has(mode)) {
        errors.push(
          adapterScopeError(
            'ASM_CLI_MODE_UNSUPPORTED',
            `${field} includes ${mode}, which is not proven for ${hostId}`,
          ),
        );
      }
      if (field === 'cli_resolution_order' && !scopeModes.has(mode)) {
        errors.push(
          adapterScopeError(
            'ASM_RESOLUTION_ORDER_UNMAPPED',
            `cli_resolution_order includes ${mode}, which is not declared in cli_management_modes`,
          ),
        );
      }
    }
  }

  const cliCompatibility = getObject(scope, 'cli_compatibility');
  const hostCli =
    cliCompatibility === undefined ? undefined : getObject(cliCompatibility, 'host_cli');
  const hostCliId = hostCli === undefined ? undefined : getString(hostCli, 'host_id');
  if (hostCliId !== undefined && hostCliId !== hostId) {
    errors.push(
      adapterScopeError(
        'ASM_HOST_CLI_MISMATCH',
        `cli_compatibility.host_cli.host_id ${hostCliId} must match selected host ${hostId}`,
      ),
    );
  }
}

function validateCapabilities(
  scope: JsonObject,
  matrix: JsonObject,
  host: JsonObject,
  hostId: string,
  errors: string[],
): void {
  const matrixDimensions = new Set(
    (getArray(matrix, 'capability_dimensions') ?? []).filter(
      (dimension): dimension is string => typeof dimension === 'string',
    ),
  );
  for (const dimension of capabilityDimensions) {
    if (!matrixDimensions.has(dimension)) {
      errors.push(
        adapterScopeError('ASM_MATRIX_DIMENSION_MISSING', `matrix is missing ${dimension}`),
      );
    }
  }

  const hostEvidenceIds = collectHostEvidenceIds(host);
  const hostCapabilities = getObject(host, 'capabilities');
  const coverage = new Map<string, 'implemented' | 'unavailable'>();
  validateCapabilityEntries(
    scope,
    'implemented_capabilities',
    'implemented',
    hostCapabilities,
    hostEvidenceIds,
    coverage,
    hostId,
    errors,
  );
  validateCapabilityEntries(
    scope,
    'unavailable_capabilities',
    'unavailable',
    hostCapabilities,
    hostEvidenceIds,
    coverage,
    hostId,
    errors,
  );

  for (const dimension of capabilityDimensions) {
    if (!coverage.has(dimension)) {
      errors.push(
        adapterScopeError(
          'ASM_CAPABILITY_COVERAGE',
          `adapter scope must classify ${dimension} as implemented or unavailable`,
        ),
      );
    }
  }
  for (const dimension of requiredLimitedAdapterCapabilities) {
    if (coverage.get(dimension) !== 'implemented') {
      errors.push(
        adapterScopeError(
          'ASM_REQUIRED_CAPABILITY_UNAVAILABLE',
          `limited adapter scope requires implemented capability ${dimension}`,
        ),
      );
    }
  }
}

function validateCapabilityEntries(
  scope: JsonObject,
  field: 'implemented_capabilities' | 'unavailable_capabilities',
  classification: 'implemented' | 'unavailable',
  hostCapabilities: JsonObject | undefined,
  hostEvidenceIds: ReadonlySet<string>,
  coverage: Map<string, 'implemented' | 'unavailable'>,
  hostId: string,
  errors: string[],
): void {
  for (const [index, entry] of (getArray(scope, field) ?? []).entries()) {
    if (!isObject(entry)) {
      continue;
    }
    const capability = getString(entry, 'capability');
    if (capability === undefined) {
      continue;
    }
    if (coverage.has(capability)) {
      errors.push(
        adapterScopeError('ASM_CAPABILITY_DUPLICATE', `${capability} is declared more than once`),
      );
    }
    coverage.set(capability, classification);

    const matrixCapability =
      hostCapabilities === undefined ? undefined : getObject(hostCapabilities, capability);
    if (matrixCapability === undefined) {
      errors.push(
        adapterScopeError(
          'ASM_CAPABILITY_UNKNOWN',
          `${field}[${index}] references capability ${capability}, which is not present for ${hostId}`,
        ),
      );
      continue;
    }

    if (
      classification === 'implemented' &&
      (getString(matrixCapability, 'status') !== 'yes' ||
        getString(matrixCapability, 'fallback') !== 'supported')
    ) {
      errors.push(
        adapterScopeError(
          'ASM_CAPABILITY_OVERCLAIM',
          `${capability} cannot be implemented because ${hostId} matrix status is ${getString(
            matrixCapability,
            'status',
          )} with ${getString(matrixCapability, 'fallback')} fallback`,
        ),
      );
    }

    validateFallbackConservatism(
      getString(entry, 'fallback'),
      getString(matrixCapability, 'fallback'),
      capability,
      errors,
    );
    validateCapabilityEvidence(entry, matrixCapability, hostEvidenceIds, capability, errors);
  }
}

function collectHostEvidenceIds(host: JsonObject): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const evidence of getArray(host, 'evidence') ?? []) {
    if (!isObject(evidence)) {
      continue;
    }
    const id = getString(evidence, 'evidence_id');
    if (id !== undefined) {
      ids.add(id);
    }
  }
  return ids;
}

function validateCapabilityEvidence(
  entry: JsonObject,
  matrixCapability: JsonObject,
  hostEvidenceIds: ReadonlySet<string>,
  capability: string,
  errors: string[],
): void {
  const capabilityEvidenceIds = new Set(
    (getArray(matrixCapability, 'evidence_ids') ?? []).filter(
      (id): id is string => typeof id === 'string',
    ),
  );
  for (const evidenceId of (getArray(entry, 'evidence_ids') ?? []).filter(
    (id): id is string => typeof id === 'string',
  )) {
    if (!hostEvidenceIds.has(evidenceId)) {
      errors.push(
        adapterScopeError(
          'ASM_EVIDENCE_DANGLING',
          `${capability} references missing selected-host evidence_id ${evidenceId}`,
        ),
      );
    } else if (!capabilityEvidenceIds.has(evidenceId)) {
      errors.push(
        adapterScopeError(
          'ASM_EVIDENCE_NOT_CAPABILITY',
          `${capability} references evidence_id ${evidenceId} outside the matrix capability evidence`,
        ),
      );
    }
  }
}

function validateFallbackConservatism(
  adapterFallback: string | undefined,
  matrixFallback: string | undefined,
  capability: string,
  errors: string[],
): void {
  const adapterRank = adapterFallback === undefined ? undefined : fallbackRanks[adapterFallback];
  const matrixRank = matrixFallback === undefined ? undefined : fallbackRanks[matrixFallback];
  if (adapterRank !== undefined && matrixRank !== undefined && adapterRank < matrixRank) {
    errors.push(
      adapterScopeError(
        'ASM_FALLBACK_OVERCLAIM',
        `${capability} fallback ${adapterFallback} is less conservative than matrix fallback ${matrixFallback}`,
      ),
    );
  }
}

function validateWriteClasses(
  scope: JsonObject,
  host: JsonObject,
  hostId: string,
  errors: string[],
): void {
  const hostCapabilities = getObject(host, 'capabilities');
  const repairCapability =
    hostCapabilities === undefined ? undefined : getObject(hostCapabilities, 'repair_action_ui');
  const previewBackedProven =
    repairCapability !== undefined &&
    getString(repairCapability, 'status') === 'yes' &&
    getString(repairCapability, 'fallback') === 'supported';
  const classModes = collectWriteModes(scope);
  for (const writeClass of writeClasses) {
    if (classModes[writeClass] === 'preview-backed' && !previewBackedProven) {
      errors.push(
        adapterScopeError(
          'ASM_WRITE_MODE_OVERCLAIM',
          `${writeClass} cannot be preview-backed because ${hostId}.repair_action_ui is not fully supported`,
        ),
      );
    }
  }
}

function collectWriteModes(scope: JsonObject): Readonly<Record<string, string>> {
  const modes: Record<string, string> = {};
  const classes = getObject(scope, 'write_classes');
  if (classes === undefined) {
    return modes;
  }
  for (const writeClass of writeClasses) {
    const config = getObject(classes, writeClass);
    const mode = config === undefined ? undefined : getString(config, 'mode');
    if (mode !== undefined) {
      modes[writeClass] = mode;
    }
  }
  return modes;
}

function validateLocalState(scope: JsonObject, errors: string[]): void {
  const localState = getObject(scope, 'local_state');
  if (localState !== undefined && getValue(localState, 'authoritative') === true) {
    errors.push(
      adapterScopeError(
        'ASM_LOCAL_STATE_AUTHORITATIVE',
        'adapter-local state must be non-authoritative and reconstructible',
      ),
    );
  }
}

function countObjects(scope: JsonObject, field: string): number {
  return (getArray(scope, field) ?? []).filter((entry) => isObject(entry)).length;
}
