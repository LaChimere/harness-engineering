import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';

import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';
import { assertNoSymlinkWithinRoot, loadDocument, pathKind } from './files.ts';
import { type IHarnessValidationResult, validateHarnessConfiguration } from './harness.ts';
import {
  getArray,
  getObject,
  getString,
  isObject,
  type JsonObject,
  type JsonValue,
  objectEntries,
} from './json.ts';
import { relativePathFromRoot, resolveInsideRoot } from './paths.ts';
import { formatValidationIssue, type ISchemaRegistry } from './schema-registry.ts';

export type GcStatus = 'passed' | 'findings';

export interface IGcAuditInput {
  readonly root: string;
  readonly harnessPath: string;
  readonly cliVersion: string;
  readonly schemas: ISchemaRegistry;
  readonly auditId?: string;
  readonly generatedAt?: string;
  readonly previousAuditRef?: string;
  readonly repairActionsDir?: string;
  readonly capabilityLedgerPath?: string;
  readonly verificationPath?: string;
  readonly runResultsPath?: string;
  readonly scoreboardPath?: string;
  readonly tracePath?: string;
  readonly judgeResultPath?: string;
}

export interface IGcAuditRun {
  readonly evidence: JsonObject;
  readonly markdown: string;
  readonly status: GcStatus;
}

interface IFindingInput {
  readonly category:
    | 'broken-reference'
    | 'duplicate-id'
    | 'stale-schema-version'
    | 'verification-evidence'
    | 'execution-evidence'
    | 'eval-evidence'
    | 'trace-evidence'
    | 'judge-calibration';
  readonly severity: 'info' | 'warning' | 'error' | 'critical';
  readonly confidence: number;
  readonly evidencePath: string;
  readonly evidenceDescription: string;
  readonly cleanupId: string;
  readonly cleanupDescription: string;
  readonly targetFiles: readonly string[];
  readonly blastRadius: string;
  readonly atomicityNotes: string;
}

interface IDuplicateRecord {
  readonly key: string;
  readonly value: string;
  readonly path: string;
}

interface ILoadedEvidenceArtifact {
  readonly path: string;
  readonly document: JsonObject;
}

const schemaVersion = '0.1.0';

export async function runGcAudit(input: IGcAuditInput): Promise<IGcAuditRun> {
  const validation = await validateHarnessConfiguration({
    root: input.root,
    harnessPath: input.harnessPath,
    cliVersion: input.cliVersion,
    schemas: input.schemas,
  });
  if (validation.schemaIssues.length > 0) {
    throw new CliError(
      `GC audit requires a schema-valid harness: ${validation.schemaIssues.join('; ')}`,
      ExitCode.validationError,
    );
  }
  const findingInputs = dedupeFindingCleanupIds([
    ...brokenReferenceFindings(input.harnessPath, validation),
    ...staleSchemaVersionFindings(input.harnessPath, validation, input.schemas),
    ...(await duplicateIdFindings(
      input.root,
      input.harnessPath,
      validation,
      input.repairActionsDir,
      input.capabilityLedgerPath,
    )),
    ...(await verificationFindings(input)),
    ...(await executionFindings(input)),
    ...(await scoreboardFindings(input)),
    ...(await traceFindings(input)),
    ...(await judgeCalibrationFindings(input)),
  ]);
  const findings = findingInputs.map(finding);
  const evidence: JsonObject = {
    ['schema_version']: schemaVersion,
    ['audit_id']: input.auditId ?? defaultAuditId(input.harnessPath, findings),
    ['generated_at']: input.generatedAt ?? new Date().toISOString(),
    findings,
    ...(input.previousAuditRef === undefined
      ? {}
      : { ['previous_audit_ref']: input.previousAuditRef }),
  };
  return {
    evidence,
    markdown: renderGcMarkdown(evidence),
    status: findings.length === 0 ? 'passed' : 'findings',
  };
}

export function serializeGcJson(evidence: JsonObject): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

export function validateGcEvidenceSemantics(evidence: JsonObject): readonly string[] {
  const issues: string[] = [];
  const findings = getArray(evidence, 'findings') ?? [];
  const cleanupIds = new Set<string>();
  for (const [index, item] of findings.entries()) {
    if (!isObject(item)) {
      continue;
    }
    const evidenceRefs = getArray(item, 'evidence_refs') ?? [];
    if (evidenceRefs.length === 0) {
      issues.push(`findings[${index}] must include at least one evidence_ref`);
    }
    const cleanup = getObject(item, 'proposed_cleanup_slice');
    const cleanupId = cleanup === undefined ? undefined : getString(cleanup, 'id');
    if (cleanupId !== undefined) {
      if (cleanupIds.has(cleanupId)) {
        issues.push(`findings[${index}] duplicates proposed_cleanup_slice.id ${cleanupId}`);
      }
      cleanupIds.add(cleanupId);
    }
    const targetFiles = cleanup === undefined ? [] : (getArray(cleanup, 'target_files') ?? []);
    if (targetFiles.length === 0) {
      issues.push(`findings[${index}] must include at least one cleanup target file`);
    }
    for (const targetFile of targetFiles) {
      if (typeof targetFile === 'string' && targetFile.includes('#')) {
        issues.push(
          `findings[${index}] cleanup target file must not include a fragment: ${targetFile}`,
        );
      }
    }
  }
  return issues;
}

export async function validateGcEvidenceReferences(
  evidence: JsonObject,
  root: string,
): Promise<readonly string[]> {
  const issues: string[] = [];
  const previousAuditRef = getString(evidence, 'previous_audit_ref');
  if (previousAuditRef !== undefined) {
    await validateArtifactReferences(root, issues, 'previous_audit_ref', [previousAuditRef]);
  }
  const findings = getArray(evidence, 'findings') ?? [];
  for (const [index, item] of findings.entries()) {
    if (!isObject(item)) {
      continue;
    }
    await validateArtifactReferences(
      root,
      issues,
      `findings[${index}].evidence_refs`,
      evidencePaths(item),
    );
    await validateArtifactReferences(
      root,
      issues,
      `findings[${index}].promotion_decision_refs`,
      evidencePaths(item, 'promotion_decision_refs'),
    );
    await validateArtifactReferences(
      root,
      issues,
      `findings[${index}].retirement_decision_refs`,
      evidencePaths(item, 'retirement_decision_refs'),
    );
    const cleanup = getObject(item, 'proposed_cleanup_slice');
    await validateCleanupTargets(
      root,
      issues,
      `findings[${index}].proposed_cleanup_slice.target_files`,
      stringList(cleanup === undefined ? undefined : getArray(cleanup, 'target_files')),
    );
  }
  return issues;
}

export function renderGcMarkdown(evidence: JsonObject): string {
  const findings = (getArray(evidence, 'findings') ?? []).filter(isObject);
  const lines = ['# Harness GC audit', ''];
  lines.push(`- audit: ${getString(evidence, 'audit_id') ?? 'unknown'}`);
  lines.push(`- generated: ${getString(evidence, 'generated_at') ?? 'unknown'}`);
  lines.push(`- findings: ${findings.length}`);
  lines.push('');
  if (findings.length === 0) {
    lines.push('No deterministic GC findings were detected.');
    return `${lines.join('\n')}\n`;
  }
  lines.push('## Findings', '');
  for (const item of findings) {
    const cleanup = getObject(item, 'proposed_cleanup_slice') ?? {};
    lines.push(
      `- ${getString(item, 'category') ?? 'unknown'}: ${getString(cleanup, 'id') ?? 'unknown'}`,
    );
    lines.push(`  - severity: ${getString(item, 'severity') ?? 'unknown'}`);
    lines.push(`  - confidence: ${getNumberForGc(item, 'confidence') ?? 'unknown'}`);
    lines.push(`  - cleanup: ${getString(cleanup, 'description') ?? 'unknown'}`);
    lines.push(
      `  - target files: ${stringList(getArray(cleanup, 'target_files')).join(', ') || 'none'}`,
    );
    lines.push(`  - evidence: ${evidencePaths(item).join(', ') || 'none'}`);
    lines.push(
      `  - promotion refs: ${evidencePaths(item, 'promotion_decision_refs').join(', ') || 'none'}`,
    );
    lines.push(
      `  - retirement refs: ${evidencePaths(item, 'retirement_decision_refs').join(', ') || 'none'}`,
    );
    lines.push(`  - blast radius: ${getString(item, 'blast_radius') ?? 'unknown'}`);
    lines.push(`  - atomicity: ${getString(item, 'atomicity_notes') ?? 'unknown'}`);
  }
  return `${lines.join('\n')}\n`;
}

async function validateArtifactReferences(
  root: string,
  issues: string[],
  field: string,
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    if (isExternalOrFragmentRef(path)) {
      continue;
    }
    const cleanPath = pathWithoutFragment(path);
    let absolutePath: string;
    try {
      absolutePath = resolveInsideRoot(root, cleanPath, field);
    } catch (error) {
      if (error instanceof CliError) {
        issues.push(`${field} path is not inside root: ${path}`);
        continue;
      }
      throw error;
    }
    await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
    if ((await pathKind(absolutePath)) === undefined) {
      issues.push(`${field} path does not exist: ${path}`);
    }
  }
}

async function validateCleanupTargets(
  root: string,
  issues: string[],
  field: string,
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    if (isExternalOrFragmentRef(path) || path.includes('#')) {
      issues.push(
        `${field} cleanup target must be a local file path without a URI or fragment: ${path}`,
      );
      continue;
    }
    await validateArtifactReferences(root, issues, field, [path]);
  }
}

function isExternalOrFragmentRef(path: string): boolean {
  return path.startsWith('#') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path);
}

function brokenReferenceFindings(
  harnessPath: string,
  validation: IHarnessValidationResult,
): readonly IFindingInput[] {
  return validation.referenceIssues.map((issue, index) => ({
    category: 'broken-reference',
    severity: 'error',
    confidence: 1,
    evidencePath: harnessPath,
    evidenceDescription: issue,
    cleanupId: `fix-broken-reference-${index + 1}`,
    cleanupDescription: issue,
    targetFiles: [harnessPath],
    blastRadius: 'Harness references and their target artifact validation.',
    atomicityNotes:
      'Fix the broken reference or target artifact only; do not mix with schema or behavior changes.',
  }));
}

function staleSchemaVersionFindings(
  harnessPath: string,
  validation: IHarnessValidationResult,
  schemas: ISchemaRegistry,
): readonly IFindingInput[] {
  const harness = validation.document;
  if (harness === undefined) {
    return [];
  }
  const schemaRanges = getObject(getObject(harness, 'engines') ?? {}, 'schemas');
  if (schemaRanges === undefined) {
    return [];
  }
  const findings: IFindingInput[] = [];
  for (const [schemaName, range] of objectEntries(schemaRanges)) {
    if (typeof range !== 'string' || !schemas.schemaNames.has(schemaName)) {
      continue;
    }
    if (!semver.satisfies(schemas.schemaVersion, range, { includePrerelease: true })) {
      findings.push({
        category: 'stale-schema-version',
        severity: 'warning',
        confidence: 1,
        evidencePath: harnessPath,
        evidenceDescription: `engines.schemas.${schemaName} ${range} does not include local schema version ${schemas.schemaVersion}`,
        cleanupId: `update-schema-range-${schemaName}`,
        cleanupDescription: `Update engines.schemas.${schemaName} to include local schema version ${schemas.schemaVersion}.`,
        targetFiles: [harnessPath],
        blastRadius: `Schema compatibility declaration for ${schemaName}.`,
        atomicityNotes:
          'Update only the schema range and any directly related compatibility evidence.',
      });
    }
  }
  return findings;
}

async function duplicateIdFindings(
  root: string,
  harnessPath: string,
  validation: IHarnessValidationResult,
  repairActionsDir: string | undefined,
  capabilityLedgerPath: string | undefined,
): Promise<readonly IFindingInput[]> {
  const records = [
    ...doctorCheckIdRecords(harnessPath, validation),
    ...(await repairActionIdRecords(root, repairActionsDir ?? 'examples/repair-actions')),
    ...(await capabilityIdRecords(
      root,
      capabilityLedgerPath ?? 'plans/harness-engineering-platform/capability-ledger.yaml',
    )),
  ];
  const groups = new Map<string, IDuplicateRecord[]>();
  for (const record of records) {
    const groupKey = `${record.key}:${record.value}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), record]);
  }
  const findings: IFindingInput[] = [];
  for (const recordsForId of groups.values()) {
    if (recordsForId.length < 2) {
      continue;
    }
    const [first] = recordsForId;
    if (first === undefined) {
      continue;
    }
    findings.push({
      category: 'duplicate-id',
      severity: 'warning',
      confidence: 1,
      evidencePath: first.path,
      evidenceDescription: `${first.key} ${first.value} appears in ${recordsForId.map((record) => record.path).join(', ')}`,
      cleanupId: `dedupe-${first.key.replaceAll('_', '-')}-${slugForId(first.value)}`,
      cleanupDescription: `Give each ${first.key} value a unique stable id: ${first.value}.`,
      targetFiles: unique(recordsForId.map((record) => pathWithoutFragment(record.path))),
      blastRadius: `Stable id namespace ${first.key}.`,
      atomicityNotes:
        'Rename or merge only the duplicate id records; do not combine with unrelated content changes.',
    });
  }
  return findings;
}

async function verificationFindings(input: IGcAuditInput): Promise<readonly IFindingInput[]> {
  if (input.verificationPath === undefined) {
    return [];
  }
  const loaded = await loadEvidenceArtifact(
    input.root,
    input.verificationPath,
    'self-verification',
    'verification evidence',
    input.schemas,
  );
  const document = loaded.document;
  const failedChecks = (getArray(document, 'acceptance_checks') ?? [])
    .filter(isObject)
    .filter((check) => getString(check, 'status') !== 'passed')
    .map((check) => getString(check, 'id') ?? 'unknown');
  const failedCommands = (getArray(document, 'checks_run') ?? [])
    .filter(isObject)
    .filter((check) => getString(check, 'status') === 'failed')
    .map((check) => getString(getObject(check, 'command') ?? {}, 'command') ?? 'unknown command');
  const specStatus = getString(getObject(document, 'spec_reread') ?? {}, 'status');
  const unresolvedRisks = (getArray(document, 'unresolved_risks') ?? []).filter(
    (risk) => typeof risk === 'string',
  );
  const issues = [
    ...(specStatus === 'matched' ? [] : [`spec reread status is ${specStatus ?? 'unknown'}`]),
    ...(failedChecks.length === 0 ? [] : [`failed acceptance checks: ${failedChecks.join(', ')}`]),
    ...(failedCommands.length === 0 ? [] : [`failed commands: ${failedCommands.join(', ')}`]),
    ...(unresolvedRisks.length === 0 ? [] : [`unresolved risks: ${unresolvedRisks.length}`]),
  ];
  if (issues.length === 0) {
    return [];
  }
  const verificationId = getString(document, 'verification_id') ?? 'verification';
  return [
    {
      category: 'verification-evidence',
      severity: failedChecks.length > 0 || failedCommands.length > 0 ? 'error' : 'warning',
      confidence: 1,
      evidencePath: loaded.path,
      evidenceDescription: `Verification evidence ${verificationId} is not clean: ${issues.join('; ')}`,
      cleanupId: `review-verification-${slugForId(verificationId)}`,
      cleanupDescription: `Resolve or explicitly defer non-clean verification evidence for ${verificationId}.`,
      targetFiles: [loaded.path],
      blastRadius: 'Verification evidence and the work it claims to validate.',
      atomicityNotes:
        'Resolve verification evidence separately from unrelated implementation changes.',
    },
  ];
}

async function executionFindings(input: IGcAuditInput): Promise<readonly IFindingInput[]> {
  if (input.runResultsPath === undefined) {
    return [];
  }
  const runResults = await loadRunResults(input.root, input.runResultsPath, input.schemas);
  return runResults
    .filter((runResult) => getString(runResult.document, 'status') !== 'passed')
    .map((runResult): IFindingInput => {
      const runId = getString(runResult.document, 'run_id') ?? 'run';
      const kind = getString(runResult.document, 'kind') ?? 'unknown';
      const status = getString(runResult.document, 'status') ?? 'unknown';
      const failureCode = getString(runResult.document, 'failure_code') ?? 'unspecified';
      return {
        category: 'execution-evidence',
        severity: status === 'error' ? 'error' : 'warning',
        confidence: 1,
        evidencePath: runResult.path,
        evidenceDescription: `Run result ${runId} kind=${kind} status is ${status}; failure_code=${failureCode}.`,
        cleanupId: `review-run-result-${slugForId(runId)}`,
        cleanupDescription: `Review failed or errored ${kind} run-result evidence for ${runId}.`,
        targetFiles: [runResult.path],
        blastRadius: 'Execution evidence and linked trace/verifier artifacts.',
        atomicityNotes:
          'Fix execution evidence or its directly linked artifacts separately from unrelated changes.',
      };
    });
}

async function scoreboardFindings(input: IGcAuditInput): Promise<readonly IFindingInput[]> {
  if (input.scoreboardPath === undefined) {
    return [];
  }
  const loaded = await loadEvidenceArtifact(
    input.root,
    input.scoreboardPath,
    'scoreboard',
    'scoreboard',
    input.schemas,
  );
  const status = getString(loaded.document, 'status');
  if (status === 'passed') {
    return [];
  }
  const scoreboardId = getString(loaded.document, 'scoreboard_id') ?? 'scoreboard';
  return [
    {
      category: 'eval-evidence',
      severity: status === 'error' ? 'error' : 'warning',
      confidence: 1,
      evidencePath: loaded.path,
      evidenceDescription: `Scoreboard ${scoreboardId} status is ${status ?? 'unknown'}.`,
      cleanupId: `review-scoreboard-${slugForId(scoreboardId)}`,
      cleanupDescription: `Review failing scoreboard evidence for ${scoreboardId}.`,
      targetFiles: [loaded.path],
      blastRadius: 'Behavioral eval summary and linked run results.',
      atomicityNotes: 'Fix eval evidence separately from unrelated harness changes.',
    },
  ];
}

async function traceFindings(input: IGcAuditInput): Promise<readonly IFindingInput[]> {
  if (input.tracePath === undefined) {
    return [];
  }
  const loaded = await loadEvidenceArtifact(
    input.root,
    input.tracePath,
    'trace',
    'trace',
    input.schemas,
  );
  const exitCode = getNumberForGc(loaded.document, 'exit_code') ?? 0;
  const errorActions = (getArray(loaded.document, 'actions') ?? [])
    .filter(isObject)
    .filter((action) => (getArray(action, 'errors') ?? []).length > 0);
  if (exitCode === 0 && errorActions.length === 0) {
    return [];
  }
  const runId = getString(loaded.document, 'run_id') ?? 'trace';
  return [
    {
      category: 'trace-evidence',
      severity: exitCode === 0 ? 'warning' : 'error',
      confidence: 1,
      evidencePath: loaded.path,
      evidenceDescription: `Trace ${runId} exit_code=${exitCode}; actions with errors=${errorActions.length}.`,
      cleanupId: `review-trace-${slugForId(runId)}`,
      cleanupDescription: `Review trace errors for ${runId}.`,
      targetFiles: [loaded.path],
      blastRadius: 'Trace actions, logs, and linked artifacts.',
      atomicityNotes:
        'Fix trace-producing behavior or artifact links separately from unrelated cleanup.',
    },
  ];
}

async function judgeCalibrationFindings(input: IGcAuditInput): Promise<readonly IFindingInput[]> {
  if (input.judgeResultPath === undefined) {
    return [];
  }
  const loaded = await loadEvidenceArtifact(
    input.root,
    input.judgeResultPath,
    'judge-result',
    'judge result',
    input.schemas,
  );
  const calibration = getObject(loaded.document, 'calibration') ?? {};
  const calibrationStatus = getString(calibration, 'status');
  if (calibrationStatus === 'passed') {
    return [];
  }
  const resultId = getString(loaded.document, 'result_id') ?? 'judge-result';
  return [
    {
      category: 'judge-calibration',
      severity: 'warning',
      confidence: 1,
      evidencePath: loaded.path,
      evidenceDescription: `Judge result ${resultId} calibration status is ${calibrationStatus ?? 'unknown'}.`,
      cleanupId: `refresh-judge-calibration-${slugForId(resultId)}`,
      cleanupDescription: `Refresh or keep advisory judge calibration evidence for ${resultId}.`,
      targetFiles: [loaded.path],
      blastRadius: 'Inferential review policy and any consumers of blocking/advisory judge output.',
      atomicityNotes:
        'Refresh judge calibration evidence separately from deterministic verifier or run-result changes.',
    },
  ];
}

async function loadEvidenceArtifact(
  root: string,
  path: string,
  schemaName: string,
  label: string,
  schemas: ISchemaRegistry,
): Promise<ILoadedEvidenceArtifact> {
  const absolutePath = resolveInsideRoot(root, path, label);
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    throw new CliError(
      `GC audit ${label} does not exist or is not a file: ${path}`,
      ExitCode.usageError,
    );
  }
  const document = await loadDocument(absolutePath);
  if (!isObject(document)) {
    throw new CliError(
      `GC audit ${label} must contain a JSON object: ${path}`,
      ExitCode.validationError,
    );
  }
  const issues = schemas.validate(schemaName, document).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(
      `GC audit ${label} must be valid ${schemaName} evidence: ${issues.join('; ')}`,
      ExitCode.validationError,
    );
  }
  return {
    path: relativePathFromRoot(root, absolutePath, label),
    document,
  };
}

async function loadRunResults(
  root: string,
  path: string,
  schemas: ISchemaRegistry,
): Promise<readonly ILoadedEvidenceArtifact[]> {
  const absolutePath = resolveInsideRoot(root, path, 'run results');
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    throw new CliError(
      `GC audit run results do not exist or are not a file: ${path}`,
      ExitCode.usageError,
    );
  }
  const relativePath = relativePathFromRoot(root, absolutePath, 'run results');
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.jsonl') || lowerPath.endsWith('.ndjson')) {
    const lines = (await readFile(absolutePath, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.map((line, index) => {
      let value: JsonValue;
      try {
        value = JSON.parse(line) as JsonValue;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError(
          `GC audit run results could not parse JSON line ${index + 1}: ${message}`,
          ExitCode.validationError,
        );
      }
      return validatedRunResult(relativePath, value, schemas);
    });
  }
  const document = await loadDocument(absolutePath);
  if (Array.isArray(document)) {
    return document.map((entry) => validatedRunResult(relativePath, entry, schemas));
  }
  return [validatedRunResult(relativePath, document, schemas)];
}

function validatedRunResult(
  path: string,
  value: JsonValue,
  schemas: ISchemaRegistry,
): ILoadedEvidenceArtifact {
  if (!isObject(value)) {
    throw new CliError(
      `GC audit run results must contain JSON objects: ${path}`,
      ExitCode.validationError,
    );
  }
  const issues = schemas.validate('run-result', value).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(
      `GC audit run result must be valid run-result evidence: ${issues.join('; ')}`,
      ExitCode.validationError,
    );
  }
  return {
    path,
    document: value,
  };
}

function doctorCheckIdRecords(
  harnessPath: string,
  validation: IHarnessValidationResult,
): readonly IDuplicateRecord[] {
  const intrinsicRecords: IDuplicateRecord[] = [
    'schema-validity',
    'engine-compatibility',
    'reference-exists',
    'builtin-check-supported',
  ].map((id) => ({
    key: 'doctor_check_id',
    value: id,
    path: `${harnessPath}#/doctor/intrinsic/${id}`,
  }));
  const checks = getArray(getObject(validation.document ?? {}, 'doctor') ?? {}, 'checks') ?? [];
  const declaredRecords = checks.flatMap((check, index): IDuplicateRecord[] => {
    const id = isObject(check) ? getString(check, 'id') : undefined;
    return id === undefined
      ? []
      : [
          {
            key: 'doctor_check_id',
            value: id.replace(/^builtin:/, ''),
            path: `${harnessPath}#/doctor/checks/${index}`,
          },
        ];
  });
  return [...intrinsicRecords, ...declaredRecords];
}

async function repairActionIdRecords(
  root: string,
  directory: string,
): Promise<readonly IDuplicateRecord[]> {
  const absoluteDirectory = resolveInsideRoot(root, directory, 'repair actions directory');
  if ((await pathKind(absoluteDirectory)) !== 'directory') {
    return [];
  }
  const records: IDuplicateRecord[] = [];
  for (const file of (await readdir(absoluteDirectory)).sort()) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml') && !file.endsWith('.json')) {
      continue;
    }
    const absolutePath = join(absoluteDirectory, file);
    await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
    const document = await loadDocument(absolutePath);
    if (!isObject(document)) {
      continue;
    }
    const actionId = getString(document, 'action_id');
    if (actionId !== undefined) {
      records.push({
        key: 'repair_action_id',
        value: actionId,
        path: relativePathFromRoot(root, absolutePath, 'repair action'),
      });
    }
  }
  return records;
}

async function capabilityIdRecords(
  root: string,
  path: string,
): Promise<readonly IDuplicateRecord[]> {
  const absolutePath = resolveInsideRoot(root, path, 'capability ledger');
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    return [];
  }
  const document = await loadDocument(absolutePath);
  const capabilities = isObject(document) ? (getArray(document, 'capabilities') ?? []) : [];
  return capabilities.flatMap((capability, index): IDuplicateRecord[] => {
    if (!isObject(capability)) {
      return [];
    }
    const capabilityId = getString(capability, 'capability_id');
    return capabilityId === undefined
      ? []
      : [{ key: 'capability_id', value: capabilityId, path: `${path}#/capabilities/${index}` }];
  });
}

function finding(input: IFindingInput): JsonObject {
  return {
    category: input.category,
    severity: input.severity,
    confidence: input.confidence,
    ['evidence_refs']: [
      {
        path: input.evidencePath,
        ['media_type']: mediaType(input.evidencePath),
        description: input.evidenceDescription,
      },
    ],
    ['proposed_cleanup_slice']: {
      id: input.cleanupId,
      description: input.cleanupDescription,
      ['target_files']: [...input.targetFiles],
    },
    ['blast_radius']: input.blastRadius,
    ['atomicity_notes']: input.atomicityNotes,
    ['promotion_decision_refs']: [],
    ['retirement_decision_refs']: [],
  };
}

function dedupeFindingCleanupIds(inputs: readonly IFindingInput[]): readonly IFindingInput[] {
  const seenCounts = new Map<string, number>();
  const emittedIds = new Set<string>();
  return inputs.map((input) => {
    let count = seenCounts.get(input.cleanupId) ?? 0;
    seenCounts.set(input.cleanupId, count + 1);
    let candidate = count === 0 ? input.cleanupId : `${input.cleanupId}-${count + 1}`;
    while (emittedIds.has(candidate)) {
      count += 1;
      seenCounts.set(input.cleanupId, count + 1);
      candidate = `${input.cleanupId}-${count + 1}`;
    }
    emittedIds.add(candidate);
    if (candidate === input.cleanupId) {
      return input;
    }
    return {
      ...input,
      cleanupId: candidate,
    };
  });
}

function defaultAuditId(harnessPath: string, findings: readonly JsonObject[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ harnessPath, findings }))
    .digest('hex')
    .slice(0, 12);
  return `gc-${digest}`;
}

function mediaType(path: string): string {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.json')) {
    return 'application/json';
  }
  if (lowerPath.endsWith('.jsonl') || lowerPath.endsWith('.ndjson')) {
    return 'application/jsonl';
  }
  if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) {
    return 'application/yaml';
  }
  return 'text/plain';
}

function pathWithoutFragment(path: string): string {
  return path.split('#', 1)[0] ?? path;
}

function stringList(values: ReturnType<typeof getArray>): string[] {
  return (values ?? []).filter((value): value is string => typeof value === 'string');
}

function evidencePaths(item: JsonObject, key = 'evidence_refs'): string[] {
  return (getArray(item, key) ?? [])
    .filter(isObject)
    .map((evidence) => getString(evidence, 'path'))
    .filter((path): path is string => path !== undefined);
}

function getNumberForGc(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === 'number' ? value : undefined;
}

function slugForId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length === 0 ? 'unnamed' : slug;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
