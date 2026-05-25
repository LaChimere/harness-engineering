import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';

import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';
import { assertNoSymlinkWithinRoot, loadDocument, pathKind } from './files.ts';
import { type HarnessValidationResult, validateHarnessConfiguration } from './harness.ts';
import {
  getArray,
  getObject,
  getString,
  isObject,
  type JsonObject,
  objectEntries,
} from './json.ts';
import { relativePathFromRoot, resolveInsideRoot } from './paths.ts';
import type { SchemaRegistry } from './schema-registry.ts';

export type GcStatus = 'passed' | 'findings';

export interface GcAuditInput {
  readonly root: string;
  readonly harnessPath: string;
  readonly cliVersion: string;
  readonly schemas: SchemaRegistry;
  readonly auditId?: string;
  readonly generatedAt?: string;
  readonly previousAuditRef?: string;
  readonly repairActionsDir?: string;
}

export interface GcAuditRun {
  readonly evidence: JsonObject;
  readonly markdown: string;
  readonly status: GcStatus;
}

interface FindingInput {
  readonly category: 'broken-reference' | 'duplicate-id' | 'stale-schema-version';
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

interface DuplicateRecord {
  readonly key: string;
  readonly value: string;
  readonly path: string;
}

const schemaVersion = '0.1.0';

export async function runGcAudit(input: GcAuditInput): Promise<GcAuditRun> {
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
  const findings = [
    ...brokenReferenceFindings(input.harnessPath, validation),
    ...staleSchemaVersionFindings(input.harnessPath, validation, input.schemas),
    ...(await duplicateIdFindings(
      input.root,
      input.harnessPath,
      validation,
      input.repairActionsDir,
    )),
  ].map(finding);
  const evidence: JsonObject = {
    schema_version: schemaVersion,
    audit_id: input.auditId ?? defaultAuditId(input.harnessPath, findings),
    generated_at: input.generatedAt ?? new Date().toISOString(),
    findings,
    ...(input.previousAuditRef === undefined ? {} : { previous_audit_ref: input.previousAuditRef }),
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

function brokenReferenceFindings(
  harnessPath: string,
  validation: HarnessValidationResult,
): readonly FindingInput[] {
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
  validation: HarnessValidationResult,
  schemas: SchemaRegistry,
): readonly FindingInput[] {
  const harness = validation.document;
  if (harness === undefined) {
    return [];
  }
  const schemaRanges = getObject(getObject(harness, 'engines') ?? {}, 'schemas');
  if (schemaRanges === undefined) {
    return [];
  }
  const findings: FindingInput[] = [];
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
  validation: HarnessValidationResult,
  repairActionsDir: string | undefined,
): Promise<readonly FindingInput[]> {
  const records = [
    ...doctorCheckIdRecords(harnessPath, validation),
    ...(await repairActionIdRecords(root, repairActionsDir ?? 'examples/repair-actions')),
    ...(await capabilityIdRecords(
      root,
      'plans/harness-engineering-platform/capability-ledger.yaml',
    )),
  ];
  const groups = new Map<string, DuplicateRecord[]>();
  for (const record of records) {
    const groupKey = `${record.key}:${record.value}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), record]);
  }
  const findings: FindingInput[] = [];
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

function doctorCheckIdRecords(
  harnessPath: string,
  validation: HarnessValidationResult,
): readonly DuplicateRecord[] {
  const intrinsicRecords: DuplicateRecord[] = [
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
  const declaredRecords = checks.flatMap((check, index): DuplicateRecord[] => {
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
): Promise<readonly DuplicateRecord[]> {
  const absoluteDirectory = resolveInsideRoot(root, directory, 'repair actions directory');
  if ((await pathKind(absoluteDirectory)) !== 'directory') {
    return [];
  }
  const records: DuplicateRecord[] = [];
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
): Promise<readonly DuplicateRecord[]> {
  const absolutePath = resolveInsideRoot(root, path, 'capability ledger');
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    return [];
  }
  const document = await loadDocument(absolutePath);
  const capabilities = isObject(document) ? (getArray(document, 'capabilities') ?? []) : [];
  return capabilities.flatMap((capability, index): DuplicateRecord[] => {
    if (!isObject(capability)) {
      return [];
    }
    const capabilityId = getString(capability, 'capability_id');
    return capabilityId === undefined
      ? []
      : [{ key: 'capability_id', value: capabilityId, path: `${path}#/capabilities/${index}` }];
  });
}

function finding(input: FindingInput): JsonObject {
  return {
    category: input.category,
    severity: input.severity,
    confidence: input.confidence,
    evidence_refs: [
      {
        path: input.evidencePath,
        media_type: mediaType(input.evidencePath),
        description: input.evidenceDescription,
      },
    ],
    proposed_cleanup_slice: {
      id: input.cleanupId,
      description: input.cleanupDescription,
      target_files: [...input.targetFiles],
    },
    blast_radius: input.blastRadius,
    atomicity_notes: input.atomicityNotes,
    promotion_decision_refs: [],
    retirement_decision_refs: [],
  };
}

function defaultAuditId(harnessPath: string, findings: readonly JsonObject[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ harnessPath, findings }))
    .digest('hex')
    .slice(0, 12);
  return `gc-${digest}`;
}

function mediaType(path: string): string {
  if (path.endsWith('.json')) {
    return 'application/json';
  }
  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
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
