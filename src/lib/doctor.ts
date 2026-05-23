import { createHash } from 'node:crypto';
import { validateHarnessConfiguration } from './harness.ts';
import type { JsonObject, JsonValue } from './json.ts';
import { getArray, getObject, getString, isObject } from './json.ts';
import type { SchemaRegistry } from './schema-registry.ts';

type DoctorStatus = 'passed' | 'failed' | 'warning';
type DoctorOutcome = 'passed' | 'failed' | 'skipped';

export interface DoctorRun {
  readonly result: JsonObject;
  readonly markdown: string;
  readonly status: DoctorStatus;
}

export interface DoctorRunInput {
  readonly root: string;
  readonly harnessPath: string;
  readonly cliVersion: string;
  readonly schemas: SchemaRegistry;
  readonly runId?: string;
}

interface DoctorDeclaration {
  readonly kind: 'builtin' | 'local';
  readonly id: string;
  readonly path?: string;
  readonly trustRequirements?: JsonObject;
}

const schemaVersion = '0.1.0';
const supportedBuiltinChecks = new Set([
  'schema-validity',
  'engine-compatibility',
  'reference-exists',
]);

const processExitSemantics = {
  pass: 0,
  warn: 1,
  fail: 1,
} as const;

const readOnlyTrustRequirements: JsonObject = {
  trust_level: 'sandboxed',
  sandbox_required: 'process',
  network_access: false,
  secret_access: false,
  host_file_access: false,
  allowed_inputs: [],
  allowed_outputs: [],
};

export async function runDoctor(input: DoctorRunInput): Promise<DoctorRun> {
  const validation = await validateHarnessConfiguration(input);
  const declarations =
    validation.schemaIssues.length === 0 && validation.document !== undefined
      ? collectDoctorDeclarations(validation.document)
      : [];

  const checks = [
    schemaValidityCheck(input.harnessPath, validation.schemaIssues),
    engineCompatibilityCheck(
      input.harnessPath,
      validation.schemaIssues,
      validation.compatibilityIssues,
    ),
    referenceExistsCheck(
      input.harnessPath,
      validation.schemaIssues,
      validation.referenceIssues,
      validation.checkedReferences,
    ),
    builtinSupportCheck(input.harnessPath, validation.schemaIssues, declarations),
    ...localCheckDeclarations(validation.schemaIssues, declarations),
  ];
  const status = statusForChecks(checks);
  const result: JsonObject = {
    schema_version: schemaVersion,
    run_id:
      input.runId ??
      defaultRunId(input.harnessPath, input.cliVersion, input.schemas.schemaVersion, checks),
    harness_version: input.cliVersion,
    status,
    checks,
  };
  return {
    result,
    markdown: renderDoctorMarkdown(result),
    status,
  };
}

export function serializeDoctorJson(result: JsonObject): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function schemaValidityCheck(harnessPath: string, issues: readonly string[]): JsonObject {
  const passed = issues.length === 0;
  return doctorCheck({
    id: 'schema-validity',
    category: 'schema',
    inputs: [harnessPath],
    severity: 'error',
    outcome: passed ? 'passed' : 'failed',
    evidenceDescription: passed
      ? 'Harness schema validation passed.'
      : `Harness schema validation failed with ${issues.length} issue(s): ${issues.join('; ')}`,
    evidencePath: harnessPath,
    remediation: passed
      ? 'No remediation required.'
      : 'Fix harness schema validation errors and re-run doctor.',
    fixtures: ['examples/fixtures/invalid/harness-with-plugin-key.yaml'],
  });
}

function engineCompatibilityCheck(
  harnessPath: string,
  schemaIssues: readonly string[],
  issues: readonly string[],
): JsonObject {
  if (schemaIssues.length > 0) {
    return doctorCheck({
      id: 'engine-compatibility',
      category: 'compatibility',
      inputs: [harnessPath],
      severity: 'error',
      outcome: 'skipped',
      evidenceDescription:
        'Engine compatibility was skipped because harness schema validation failed.',
      evidencePath: harnessPath,
      remediation: 'Fix schema validation errors before checking engine compatibility.',
      fixtures: ['examples/fixtures/doctor/incompatible-engine.yaml'],
    });
  }
  const passed = issues.length === 0;
  return doctorCheck({
    id: 'engine-compatibility',
    category: 'compatibility',
    inputs: [harnessPath],
    severity: 'error',
    outcome: passed ? 'passed' : 'failed',
    evidenceDescription: passed
      ? 'CLI and schema engine ranges are compatible with the local package.'
      : `Engine compatibility failed with ${issues.length} issue(s): ${issues.join('; ')}`,
    evidencePath: harnessPath,
    remediation: passed
      ? 'No remediation required.'
      : 'Update engines.cli or engines.schemas to include the local CLI and schema family.',
    fixtures: ['examples/fixtures/doctor/incompatible-engine.yaml'],
  });
}

function referenceExistsCheck(
  harnessPath: string,
  schemaIssues: readonly string[],
  issues: readonly string[],
  checkedReferences: readonly string[],
): JsonObject {
  const inputs = unique([harnessPath, ...checkedReferences]);
  if (schemaIssues.length > 0) {
    return doctorCheck({
      id: 'reference-exists',
      category: 'references',
      inputs,
      severity: 'error',
      outcome: 'skipped',
      evidenceDescription:
        'Reference checks were skipped because harness schema validation failed.',
      evidencePath: harnessPath,
      remediation: 'Fix schema validation errors before checking composed references.',
      fixtures: ['examples/fixtures/doctor/missing-reference.yaml'],
    });
  }
  const passed = issues.length === 0;
  return doctorCheck({
    id: 'reference-exists',
    category: 'references',
    inputs,
    severity: 'error',
    outcome: passed ? 'passed' : 'failed',
    evidenceDescription: passed
      ? `${checkedReferences.length} composed reference(s) resolved and validated.`
      : `Reference checks failed with ${issues.length} issue(s): ${issues.join('; ')}`,
    evidencePath: harnessPath,
    remediation: passed
      ? 'No remediation required.'
      : 'Restore missing referenced artifacts or update harness.yaml references.',
    fixtures: ['examples/fixtures/doctor/missing-reference.yaml'],
  });
}

function builtinSupportCheck(
  harnessPath: string,
  schemaIssues: readonly string[],
  declarations: readonly DoctorDeclaration[],
): JsonObject {
  if (schemaIssues.length > 0) {
    return doctorCheck({
      id: 'builtin-check-supported',
      category: 'doctor-registration',
      inputs: [harnessPath],
      severity: 'error',
      outcome: 'skipped',
      evidenceDescription:
        'Builtin registration checks were skipped because harness schema validation failed.',
      evidencePath: harnessPath,
      remediation: 'Fix schema validation errors before checking doctor registrations.',
      fixtures: ['examples/fixtures/doctor/unsupported-builtin.yaml'],
    });
  }

  const unsupported = declarations
    .filter((declaration) => declaration.kind === 'builtin')
    .map((declaration) => declaration.id)
    .filter((id) => !supportedBuiltinChecks.has(id))
    .sort();
  const passed = unsupported.length === 0;
  return doctorCheck({
    id: 'builtin-check-supported',
    category: 'doctor-registration',
    inputs: [harnessPath],
    severity: 'error',
    outcome: passed ? 'passed' : 'failed',
    evidenceDescription: passed
      ? 'Every declared builtin doctor check is supported by this CLI.'
      : `Unsupported builtin doctor check(s): ${unsupported.map((id) => `builtin:${id}`).join(', ')}`,
    evidencePath: harnessPath,
    remediation: passed
      ? 'No remediation required.'
      : 'Remove unsupported builtin doctor checks or upgrade to a CLI version that supports them.',
    fixtures: ['examples/fixtures/doctor/unsupported-builtin.yaml'],
  });
}

function localCheckDeclarations(
  schemaIssues: readonly string[],
  declarations: readonly DoctorDeclaration[],
): readonly JsonObject[] {
  if (schemaIssues.length > 0) {
    return [];
  }
  return declarations
    .filter((declaration) => declaration.kind === 'local')
    .map((declaration) => {
      if (declaration.path === undefined) {
        throw new Error('Local doctor check declaration is missing path after schema validation.');
      }
      const path = declaration.path;
      const trustRequirements = declaration.trustRequirements ?? readOnlyTrustRequirements;
      const allowedInputs = getArray(trustRequirements, 'allowed_inputs') ?? [];
      return doctorCheck({
        id: declaration.id,
        category: 'local-check-registration',
        inputs: unique([path, ...allowedInputs.filter((input) => typeof input === 'string')]),
        severity: 'info',
        outcome: 'skipped',
        evidenceDescription:
          'Local doctor check is declared with trust requirements but is not executed by the current doctor command.',
        evidencePath: path,
        remediation:
          'Keep the declaration for future local-check execution support; the current doctor command validates registration only.',
        fixtures: [path],
        trustRequirements,
      });
    });
}

function doctorCheck(input: {
  readonly id: string;
  readonly category: string;
  readonly inputs: readonly string[];
  readonly severity: 'info' | 'warning' | 'error' | 'critical';
  readonly outcome: DoctorOutcome;
  readonly evidenceDescription: string;
  readonly evidencePath: string;
  readonly remediation: string;
  readonly fixtures: readonly string[];
  readonly trustRequirements?: JsonObject;
}): JsonObject {
  return {
    id: input.id,
    version: schemaVersion,
    category: input.category,
    inputs: [...input.inputs],
    determinism: 'deterministic',
    severity: input.severity,
    outcome: input.outcome,
    evidence: [
      {
        path: input.evidencePath,
        media_type: mediaTypeForPath(input.evidencePath),
        description: input.evidenceDescription,
      },
    ],
    remediation: input.remediation,
    fixtures: [...input.fixtures],
    false_positive_policy:
      'Doctor findings are deterministic structural findings. Treat false positives as schema/check contract bugs and fix the fixture or check definition before suppressing.',
    exit_semantics: processExitSemantics,
    trust_requirements: input.trustRequirements ?? readOnlyTrustRequirements,
  };
}

function collectDoctorDeclarations(harness: JsonObject): readonly DoctorDeclaration[] {
  const doctor = getObject(harness, 'doctor');
  const checks = doctor === undefined ? undefined : getArray(doctor, 'checks');
  if (checks === undefined) {
    return [];
  }

  const declarations: DoctorDeclaration[] = [];
  for (const check of checks) {
    if (typeof check === 'string' && check.startsWith('builtin:')) {
      // Builtins are intrinsic structural checks; declarations validate support, not execution selection.
      declarations.push({ kind: 'builtin', id: check.slice('builtin:'.length) });
    } else if (isObject(check)) {
      const id = getString(check, 'id');
      if (id === undefined) {
        continue;
      }
      const path = getString(check, 'path');
      const trustRequirements = getObject(check, 'trust_requirements');
      declarations.push({
        kind: 'local',
        id,
        ...(path === undefined ? {} : { path }),
        ...(trustRequirements === undefined ? {} : { trustRequirements }),
      });
    }
  }
  return declarations;
}

function statusForChecks(checks: readonly JsonObject[]): DoctorStatus {
  let hasWarning = false;
  for (const check of checks) {
    if (getString(check, 'outcome') !== 'failed') {
      continue;
    }
    const severity = getString(check, 'severity');
    if (severity === 'warning' || severity === 'info') {
      hasWarning = true;
      continue;
    }
    if (severity === 'error' || severity === 'critical') {
      return 'failed';
    }
  }
  return hasWarning ? 'warning' : 'passed';
}

function defaultRunId(
  harnessPath: string,
  cliVersion: string,
  localSchemaVersion: string,
  checks: readonly JsonObject[],
): string {
  const checkIds = checks.map((check) => getString(check, 'id') ?? 'unknown').sort();
  const digest = createHash('sha256')
    .update([harnessPath, cliVersion, localSchemaVersion, ...checkIds].join('\n'))
    .digest('hex')
    .slice(0, 12);
  return `doctor-${digest}`;
}

function renderDoctorMarkdown(result: JsonObject): string {
  const lines = ['# Harness doctor report', ''];
  lines.push(`- run_id: ${getString(result, 'run_id') ?? 'unknown'}`);
  lines.push(`- status: ${getString(result, 'status') ?? 'unknown'}`);
  lines.push('');
  lines.push('| Check | Outcome | Severity | Remediation |');
  lines.push('|---|---|---|---|');
  const checks = getArray(result, 'checks') ?? [];
  for (const check of checks) {
    if (!isObject(check)) {
      continue;
    }
    lines.push(
      `| ${escapeMarkdownCell(getString(check, 'id') ?? 'unknown')} | ${escapeMarkdownCell(getString(check, 'outcome') ?? 'unknown')} | ${escapeMarkdownCell(getString(check, 'severity') ?? 'unknown')} | ${escapeMarkdownCell(getString(check, 'remediation') ?? '')} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function mediaTypeForPath(path: string): string {
  if (path.endsWith('.json')) {
    return 'application/json';
  }
  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    return 'application/yaml';
  }
  if (path.endsWith('.md')) {
    return 'text/markdown';
  }
  return 'text/plain';
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

export function isDoctorResult(value: JsonValue): value is JsonObject {
  return isObject(value) && getArray(value, 'checks') !== undefined;
}
