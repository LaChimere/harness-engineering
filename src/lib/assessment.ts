import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

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
} from './json.ts';
import { relativePathFromRoot, resolveInsideRoot } from './paths.ts';
import { formatValidationIssue, type ISchemaRegistry } from './schema-registry.ts';

export interface IAssessmentRequest {
  readonly root: string;
  readonly harnessPath: string;
  readonly cliVersion: string;
  readonly schemas: ISchemaRegistry;
  readonly doctorResultPath?: string;
  readonly healthResultPath?: string;
  readonly runResultsPath?: string;
  readonly tracePath?: string;
  readonly scoreboardPath?: string;
  readonly reportPath?: string;
  readonly repairActionPath?: string;
  readonly repairActionsDir?: string;
  readonly trustedRepairActionId?: string;
}

type ArtifactRead = JsonObject & {
  path: string;
  ['media_type']?: string;
  description: string;
};

interface ILoadedArtifact {
  readonly path: string;
  readonly document?: JsonObject;
  readonly status: 'loaded' | 'missing' | 'invalid';
  readonly issues: readonly string[];
}

type ScorecardItem = JsonObject & {
  id: string;
  label: string;
  status: 'present' | 'partial' | 'missing' | 'advisory';
  summary: string;
  evidence: ArtifactRead[];
};

interface IRepairActionCandidate {
  readonly path: string;
  readonly status: 'loaded' | 'missing' | 'invalid';
  readonly document?: JsonObject;
  readonly issues: readonly string[];
}

const schemaVersion = '0.1.0';
const defaultRepairActionsDir = 'examples/repair-actions';

export async function buildAssessment(request: IAssessmentRequest): Promise<JsonObject> {
  const artifactsRead: ArtifactRead[] = [];
  const harness = await loadHarnessAssessment(request, artifactsRead);
  const harnessDocument = harness.document;
  const doctorResult = await loadOptionalSchemaArtifact({
    root: request.root,
    path: request.doctorResultPath,
    label: 'doctor result',
    schemaName: 'doctor-result',
    schemas: request.schemas,
    artifactsRead,
  });
  const healthResult = await loadOptionalSchemaArtifact({
    root: request.root,
    path: request.healthResultPath,
    label: 'health result',
    schemaName: 'health-result',
    schemas: request.schemas,
    artifactsRead,
  });
  const runResults = await loadRunResults({
    root: request.root,
    path: request.runResultsPath ?? defaultRunResultsPath(harnessDocument),
    artifactsRead,
    schemas: request.schemas,
  });
  const trace = await loadOptionalSchemaArtifact({
    root: request.root,
    path: request.tracePath,
    label: 'trace',
    schemaName: 'trace',
    schemas: request.schemas,
    artifactsRead,
  });
  const scoreboard = await loadOptionalSchemaArtifact({
    root: request.root,
    path: request.scoreboardPath,
    label: 'scoreboard',
    schemaName: 'scoreboard',
    schemas: request.schemas,
    artifactsRead,
  });
  const report = await loadReportArtifact(request.root, request.reportPath, artifactsRead);
  const repairActions = await discoverRepairActions({
    root: request.root,
    schemas: request.schemas,
    explicitPath: request.repairActionPath,
    directory: request.repairActionsDir ?? defaultRepairActionsDir,
    artifactsRead,
  });

  const scorecard = buildScorecard({
    harness,
    harnessDocument,
    doctorResult,
    healthResult,
    runResults,
    trace,
    scoreboard,
    report,
    repairActions,
    trustedRepairActionId: request.trustedRepairActionId,
  });
  const missingPrimitives = scorecard
    .filter((item) => item.status === 'missing' || item.status === 'partial')
    .map((item) => ({
      id: item.id,
      label: item.label,
      severity: item.status === 'missing' ? 'warning' : 'info',
      recommendation: recommendationForPrimitive(item.id),
    }));
  const maturity = maturityForScorecard(scorecard);
  const implementationRouting = implementationRoutingFor(
    harnessDocument,
    harness.path,
    repairActions,
    scorecard,
    request.trustedRepairActionId,
  );
  const recommendations = recommendationsFor({
    harnessDocument,
    scorecard,
    implementationRouting,
  });

  const sortedArtifactsRead = sortedArtifacts(artifactsRead);
  return {
    ['schema_version']: schemaVersion,
    'x-stability': 'provisional',
    ['assessment_id']: assessmentIdFor({
      cliVersion: request.cliVersion,
      harnessPath: harness.path,
      scorecard,
      implementationRouting,
      artifactsRead: sortedArtifactsRead,
    }),
    ['adapter_path']: {
      kind: 'cli-command',
      command: 'harness assess --format json',
      rationale:
        'The native agent-facing adapter is a deterministic CLI command so agents, plugins, skills, and CI can consume one schema-backed substrate output.',
      ['rejected_paths']: [
        'skills/harness-engineering is intentionally deferred so this repository does not introduce a skill-only source of truth; external workflow practices are recorded as source material for harness-native capability candidates.',
      ],
    },
    source: {
      root: '.',
      harness: harness.path,
      ['cli_version']: request.cliVersion,
    },
    status: statusFor(harness, scorecard),
    maturity,
    ['scorecard_version']: '0.2.0',
    scorecard,
    ['missing_primitives']: missingPrimitives,
    ['rollout_plan']: rolloutPlan(scorecard),
    recommendations,
    ['implementation_routing']: implementationRouting,
    ['artifacts_read']: sortedArtifactsRead,
  };
}

export function renderAssessmentMarkdown(assessment: JsonObject): string {
  const lines = ['# Harness assessment', ''];
  lines.push(
    '> Read-only assessment: this output summarizes existing substrate evidence and routing options; it does not execute checks, repair actions, loops, shell commands, evals, agents, or migrations.',
  );
  lines.push('');
  const maturity = getObject(assessment, 'maturity') ?? {};
  lines.push(`- status: ${markdownText(getString(assessment, 'status') ?? 'unknown')}`);
  lines.push(
    `- maturity: ${markdownText(getString(maturity, 'label') ?? 'unknown')} (${numberText(maturity, 'score')}/${numberText(maturity, 'max_score')})`,
  );
  lines.push('');
  lines.push('## Maturity scorecard');
  lines.push('');
  lines.push('| Primitive | Status | Summary |');
  lines.push('|---|---|---|');
  for (const item of jsonObjects(getArray(assessment, 'scorecard') ?? [])) {
    lines.push(
      `| ${markdownText(getString(item, 'label') ?? getString(item, 'id') ?? 'unknown')} | ${markdownText(getString(item, 'status') ?? 'unknown')} | ${markdownText(getString(item, 'summary') ?? '')} |`,
    );
  }
  lines.push('');
  lines.push('## Missing primitives');
  lines.push('');
  const missing = jsonObjects(getArray(assessment, 'missing_primitives') ?? []);
  if (missing.length === 0) {
    lines.push('- none');
  } else {
    for (const item of missing) {
      lines.push(
        `- ${markdownText(getString(item, 'label') ?? getString(item, 'id') ?? 'unknown')}: ${markdownText(getString(item, 'recommendation') ?? '')}`,
      );
    }
  }
  lines.push('');
  lines.push('## Rollout plan');
  lines.push('');
  for (const step of jsonObjects(getArray(assessment, 'rollout_plan') ?? [])) {
    lines.push(
      `- ${markdownText(getString(step, 'step') ?? 'step')} (${markdownText(getString(step, 'status') ?? 'unknown')}): ${markdownText(getString(step, 'title') ?? '')}`,
    );
  }
  lines.push('');
  lines.push('## Recommendations');
  lines.push('');
  const recommendations = jsonObjects(getArray(assessment, 'recommendations') ?? []);
  if (recommendations.length === 0) {
    lines.push('- none');
  } else {
    for (const recommendation of recommendations) {
      lines.push(
        `- ${markdownText(getString(recommendation, 'category') ?? 'general')}: ${markdownText(getString(recommendation, 'message') ?? '')}`,
      );
    }
  }
  lines.push('');
  lines.push('## Implementation routing');
  lines.push('');
  const routing = getObject(assessment, 'implementation_routing') ?? {};
  lines.push(
    `- selected route: **${markdownText(getString(routing, 'selected_route') ?? 'unknown')}**`,
  );
  for (const route of jsonObjects(getArray(routing, 'routes') ?? [])) {
    lines.push(
      `- ${markdownText(getString(route, 'id') ?? 'route')} (${markdownText(getString(route, 'status') ?? 'unknown')})${routeMetadata(route)}: ${markdownText(getString(route, 'summary') ?? '')}`,
    );
  }
  lines.push('');
  lines.push('## Artifacts read');
  lines.push('');
  for (const artifact of jsonObjects(getArray(assessment, 'artifacts_read') ?? [])) {
    lines.push(`- ${markdownText(getString(artifact, 'path') ?? 'unknown')}`);
  }
  return lines.join('\n');
}

function routeMetadata(route: JsonObject): string {
  const fields = [
    ['applicability', 'applicability'],
    ['approval_trust', 'approval-trust'],
    ['approval_state', 'approval'],
    ['repair_mode', 'mode'],
    ['risk_class', 'risk'],
    ['sandbox_requirement', 'sandbox'],
  ] as const;
  const entries = fields
    .map(([key, label]) => {
      const value = getString(route, key);
      return value === undefined ? undefined : `${label}=${markdownText(value)}`;
    })
    .filter((entry): entry is string => entry !== undefined);
  return entries.length === 0 ? '' : ` [${entries.join(', ')}]`;
}

async function loadHarnessAssessment(
  request: IAssessmentRequest,
  artifactsRead: ArtifactRead[],
): Promise<ILoadedArtifact> {
  const absolutePath = resolveInsideRoot(request.root, request.harnessPath, 'Harness file');
  await assertNoSymlinkWithinRoot(request.root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    return {
      path: relativePathFromRoot(request.root, absolutePath, 'Harness file'),
      status: 'missing',
      issues: [`Harness file not found: ${request.harnessPath}`],
    };
  }
  artifactsRead.push(
    artifact(
      relativePathFromRoot(request.root, absolutePath, 'Harness file'),
      'application/yaml',
      'Harness source of truth.',
    ),
  );
  let validation: IHarnessValidationResult;
  try {
    validation = await validateHarnessConfiguration({
      root: request.root,
      harnessPath: request.harnessPath,
      cliVersion: request.cliVersion,
      schemas: request.schemas,
    });
  } catch (error) {
    const message = validationErrorMessage(error);
    if (message === undefined) {
      throw error;
    }
    return {
      path: relativePathFromRoot(request.root, absolutePath, 'Harness file'),
      status: 'invalid',
      issues: [`schema: ${message}`],
    };
  }
  const issues = [
    ...validation.schemaIssues.map((issue) => `schema: ${issue}`),
    ...validation.compatibilityIssues.map((issue) => `engines: ${issue}`),
    ...validation.referenceIssues.map((issue) => `reference: ${issue}`),
  ];
  for (const checkedReference of validation.checkedReferences) {
    artifactsRead.push(
      artifact(checkedReference, mediaType(checkedReference), 'Composed harness reference.'),
    );
  }
  return {
    path: validation.harnessPath,
    ...(validation.document === undefined ? {} : { document: validation.document }),
    status: issues.length === 0 ? 'loaded' : 'invalid',
    issues,
  };
}

async function loadOptionalSchemaArtifact(input: {
  readonly root: string;
  readonly path: string | undefined;
  readonly label: string;
  readonly schemaName: string;
  readonly schemas: ISchemaRegistry;
  readonly artifactsRead: ArtifactRead[];
}): Promise<ILoadedArtifact | undefined> {
  if (input.path === undefined) {
    return undefined;
  }
  const absolutePath = resolveInsideRoot(input.root, input.path, input.label);
  await assertNoSymlinkWithinRoot(input.root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    return {
      path: input.path,
      status: 'missing',
      issues: [`${input.label} not found: ${input.path}`],
    };
  }
  input.artifactsRead.push(artifact(input.path, mediaType(input.path), `${input.label} artifact.`));
  let document: JsonValue;
  try {
    document = await loadDocument(absolutePath);
  } catch (error) {
    const message = validationErrorMessage(error);
    if (message === undefined) {
      throw error;
    }
    return {
      path: input.path,
      status: 'invalid',
      issues: [message],
    };
  }
  if (!isObject(document)) {
    return {
      path: input.path,
      status: 'invalid',
      issues: [`${input.label} must be a JSON object.`],
    };
  }
  const issues = input.schemas.validate(input.schemaName, document).map(formatValidationIssue);
  return {
    path: input.path,
    document,
    status: issues.length === 0 ? 'loaded' : 'invalid',
    issues,
  };
}

async function loadRunResults(input: {
  readonly root: string;
  readonly path: string | undefined;
  readonly schemas: ISchemaRegistry;
  readonly artifactsRead: ArtifactRead[];
}): Promise<ILoadedArtifact | undefined> {
  if (input.path === undefined) {
    return undefined;
  }
  const absolutePath = resolveInsideRoot(input.root, input.path, 'run results');
  await assertNoSymlinkWithinRoot(input.root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    return {
      path: input.path,
      status: 'missing',
      issues: [`run results not found: ${input.path}`],
    };
  }
  input.artifactsRead.push(artifact(input.path, mediaType(input.path), 'Run-result ledger.'));
  const issues: string[] = [];
  let passed = 0;
  let failed = 0;
  let error = 0;
  let skipped = 0;
  let externalImportPassed = 0;
  let externalImportFailed = 0;
  let externalImportError = 0;
  let externalImportSkipped = 0;
  const text = await readFile(absolutePath, 'utf8');
  const parsedEntries: Array<{ readonly label: string; readonly value: unknown }> = [];
  if (input.path.endsWith('.json')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        parsedEntries.push(
          ...parsed.map((value, index) => ({ label: `entry ${index + 1}`, value })),
        );
      } else {
        parsedEntries.push({ label: 'run result', value: parsed });
      }
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      issues.push(message);
    }
  } else {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const [index, entry] of lines.entries()) {
      try {
        parsedEntries.push({ label: `line ${index + 1}`, value: JSON.parse(entry) });
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : String(parseError);
        issues.push(`line ${index + 1}: ${message}`);
      }
    }
  }
  for (const entry of parsedEntries) {
    if (!isObject(entry.value)) {
      issues.push(`${entry.label}: run result must be a JSON object`);
      continue;
    }
    issues.push(
      ...input.schemas
        .validate('run-result', entry.value)
        .map((issue) => `${entry.label}: ${formatValidationIssue(issue)}`),
    );
    const kind = getString(entry.value, 'kind');
    const status = getString(entry.value, 'status');
    if (kind === 'external-import') {
      switch (status) {
        case 'passed':
          externalImportPassed += 1;
          break;
        case 'failed':
          externalImportFailed += 1;
          break;
        case 'error':
          externalImportError += 1;
          break;
        case 'skipped':
          externalImportSkipped += 1;
          break;
      }
      continue;
    }
    switch (status) {
      case 'passed':
        passed += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      case 'error':
        error += 1;
        break;
      case 'skipped':
        skipped += 1;
        break;
    }
  }
  return {
    path: input.path,
    document: {
      ['schema_version']: schemaVersion,
      total: passed + failed + error + skipped,
      ['external_import_total']:
        externalImportPassed + externalImportFailed + externalImportError + externalImportSkipped,
      ['external_import_passed']: externalImportPassed,
      ['external_import_failed']: externalImportFailed,
      ['external_import_error']: externalImportError,
      ['external_import_skipped']: externalImportSkipped,
      passed,
      failed,
      error,
      skipped,
    },
    status: issues.length === 0 ? 'loaded' : 'invalid',
    issues,
  };
}

async function loadReportArtifact(
  root: string,
  reportPath: string | undefined,
  artifactsRead: ArtifactRead[],
): Promise<ILoadedArtifact | undefined> {
  if (reportPath === undefined) {
    return undefined;
  }
  const absolutePath = resolveInsideRoot(root, reportPath, 'report');
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    return {
      path: reportPath,
      status: 'missing',
      issues: [`report not found: ${reportPath}`],
    };
  }
  artifactsRead.push(artifact(reportPath, mediaType(reportPath), 'Harness report text.'));
  const text = await readFile(absolutePath, 'utf8');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const issues: string[] = [];
  if (lines[0] !== 'Harness report') {
    issues.push('report must be generated by harness report and start with "Harness report"');
  }
  if (!lines.includes('- cited paths:')) {
    issues.push('report must include the "cited paths" section emitted by harness report');
  }
  return {
    path: reportPath,
    ...(issues.length === 0
      ? {
          document: {
            ['schema_version']: schemaVersion,
            ['line_count']: lines.length,
          },
        }
      : {}),
    status: issues.length === 0 ? 'loaded' : 'invalid',
    issues,
  };
}

async function discoverRepairActions(input: {
  readonly root: string;
  readonly schemas: ISchemaRegistry;
  readonly explicitPath: string | undefined;
  readonly directory: string;
  readonly artifactsRead: ArtifactRead[];
}): Promise<readonly IRepairActionCandidate[]> {
  const paths = new Set<string>();
  if (input.explicitPath !== undefined) {
    paths.add(canonicalPath(input.root, input.explicitPath, 'repair action'));
  }
  const directory = resolveInsideRoot(input.root, input.directory, 'repair actions directory');
  await assertNoSymlinkWithinRoot(input.root, directory, 'read');
  if ((await pathKind(directory)) === 'directory') {
    for (const file of (await readdir(directory)).sort()) {
      if (file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')) {
        paths.add(
          relativePathFromRoot(input.root, join(directory, file), 'repair action artifact'),
        );
      }
    }
  }

  const candidates: IRepairActionCandidate[] = [];
  for (const path of [...paths].sort()) {
    const loaded = await loadOptionalSchemaArtifact({
      root: input.root,
      path,
      label: 'repair action',
      schemaName: 'repair-action',
      schemas: input.schemas,
      artifactsRead: input.artifactsRead,
    });
    if (loaded === undefined) {
      continue;
    }
    candidates.push({
      path,
      status: loaded.status,
      ...(loaded.status === 'loaded' && loaded.document !== undefined
        ? { document: loaded.document }
        : {}),
      issues: loaded.issues,
    });
  }
  return rejectDuplicateRepairActionIds(candidates);
}

function buildScorecard(input: {
  readonly harness: ILoadedArtifact;
  readonly harnessDocument: JsonObject | undefined;
  readonly doctorResult: ILoadedArtifact | undefined;
  readonly healthResult: ILoadedArtifact | undefined;
  readonly runResults: ILoadedArtifact | undefined;
  readonly trace: ILoadedArtifact | undefined;
  readonly scoreboard: ILoadedArtifact | undefined;
  readonly report: ILoadedArtifact | undefined;
  readonly repairActions: readonly IRepairActionCandidate[];
  readonly trustedRepairActionId: string | undefined;
}): ScorecardItem[] {
  const harness = input.harnessDocument;
  const harnessLoaded = input.harness.status === 'loaded';
  const policiesPresent =
    harness !== undefined && hasString(harness, 'approval_policy') && hasString(harness, 'sandbox');
  const evalSuites = getArray(getObject(harness ?? {}, 'evals') ?? {}, 'suites') ?? [];
  const traceExamples = getArray(getObject(harness ?? {}, 'traces') ?? {}, 'examples') ?? [];
  const continuity = getObject(harness ?? {}, 'continuity');
  const doctorChecks = getArray(getObject(harness ?? {}, 'doctor') ?? {}, 'checks') ?? [];
  const validRepairActions = sortRepairActions(input.repairActions.filter(isValidRepairAction));
  const invalidRepairActions = input.repairActions.filter(
    (candidate) => candidate.status !== 'loaded',
  );
  const baseItems: ScorecardItem[] = [
    {
      id: 'harness-source',
      label: 'Harness source',
      status:
        input.harness.status === 'loaded'
          ? 'present'
          : input.harness.status === 'invalid'
            ? 'partial'
            : 'missing',
      summary:
        input.harness.status === 'loaded'
          ? 'harness.yaml is present, schema-valid, engine-compatible, and reference-complete.'
          : input.harness.issues.join('; '),
      evidence:
        input.harness.status === 'missing'
          ? []
          : [artifact(input.harness.path, 'application/yaml', 'Harness file.')],
    },
    {
      id: 'policy-sandbox',
      label: 'Approval and sandbox policy',
      status: policiesPresent ? (harnessLoaded ? 'present' : 'partial') : 'missing',
      summary: policiesPresent
        ? harnessLoaded
          ? 'Approval and sandbox policy references are configured and schema-valid.'
          : 'Approval and sandbox policy references are configured, but harness validation did not complete.'
        : 'Approval and sandbox policies are not both configured.',
      evidence: evidenceForStrings(harness, ['approval_policy', 'sandbox'], 'Policy artifact.'),
    },
    {
      id: 'eval-plans',
      label: 'Eval suites and tasks',
      status: evalSuites.length > 0 ? (harnessLoaded ? 'present' : 'partial') : 'missing',
      summary:
        evalSuites.length > 0
          ? harnessLoaded
            ? `${evalSuites.length} eval suite reference(s) are configured and schema-valid through harness validation.`
            : `${evalSuites.length} eval suite reference(s) are configured, but harness validation did not complete.`
          : 'No eval suite is configured.',
      evidence: evalSuites.flatMap((suite) =>
        isObject(suite) && getString(suite, 'tasks') !== undefined
          ? [artifact(getString(suite, 'tasks') ?? '', 'application/yaml', 'Eval task suite.')]
          : [],
      ),
    },
    {
      id: 'doctor-evidence',
      label: 'Doctor evidence',
      status: doctorScorecardStatus(input.doctorResult, doctorChecks.length),
      summary: doctorSummary(input.doctorResult, doctorChecks.length),
      evidence:
        input.doctorResult === undefined
          ? []
          : [artifact(input.doctorResult.path, 'application/json', 'Doctor result artifact.')],
    },
    {
      id: 'project-health',
      label: 'Project health evidence',
      status: healthScorecardStatus(input.healthResult, harness, input.harness.path),
      summary: healthSummary(input.healthResult, harness, input.harness.path),
      evidence:
        input.healthResult === undefined
          ? []
          : [artifact(input.healthResult.path, 'application/json', 'Health result artifact.')],
    },
    {
      id: 'run-results',
      label: 'Run-result ledger',
      status: runResultsScorecardStatus(input.runResults),
      summary: runResultsSummary(input.runResults),
      evidence:
        input.runResults === undefined
          ? []
          : [
              artifact(
                input.runResults.path,
                mediaType(input.runResults.path),
                'Run-result ledger.',
              ),
            ],
    },
    {
      id: 'trace-evidence',
      label: 'Trace evidence',
      status:
        input.trace?.status === 'invalid'
          ? 'partial'
          : input.trace?.status === 'loaded'
            ? 'present'
            : traceExamples.length > 0
              ? harnessLoaded
                ? 'present'
                : 'partial'
              : 'missing',
      summary:
        input.trace?.status === 'loaded'
          ? 'Explicit trace artifact is schema-valid.'
          : input.trace?.status === 'invalid'
            ? input.trace.issues.join('; ')
            : traceExamples.length > 0
              ? harnessLoaded
                ? `${traceExamples.length} trace example reference(s) are configured and schema-valid through harness validation.`
                : `${traceExamples.length} trace example reference(s) are configured, but harness validation did not complete.`
              : (input.trace?.issues.join('; ') ?? 'No trace evidence is available.'),
      evidence:
        input.trace === undefined
          ? traceExamples
              .filter((value): value is string => typeof value === 'string')
              .map((path) => artifact(path, 'application/json', 'Trace example.'))
          : [artifact(input.trace.path, 'application/json', 'Trace artifact.')],
    },
    {
      id: 'scoreboard-report',
      label: 'Scoreboard and report',
      status: scoreboardReportStatus(input.scoreboard, input.report),
      summary: scoreboardReportSummary(input.scoreboard, input.report),
      evidence: [
        ...(input.scoreboard === undefined
          ? []
          : [artifact(input.scoreboard.path, 'application/json', 'Scoreboard artifact.')]),
        ...(input.report === undefined
          ? []
          : [artifact(input.report.path, mediaType(input.report.path), 'Report artifact.')]),
      ],
    },
    {
      id: 'continuity-loop',
      label: 'Continuity and loop gates',
      status: continuity === undefined ? 'missing' : harnessLoaded ? 'present' : 'partial',
      summary:
        continuity === undefined
          ? 'No continuity block is configured.'
          : harnessLoaded
            ? 'Continuity state directory and startup smoke-test settings are configured.'
            : 'Continuity settings are configured, but harness validation did not complete.',
      evidence:
        continuity === undefined
          ? []
          : [
              artifact(
                `${input.harness.path}#/continuity`,
                'application/yaml',
                'Continuity configuration.',
              ),
            ],
    },
  ];
  const gapTargets = assessmentGapTargets(baseItems);
  const applicableRepairActions = validRepairActions.filter((candidate) =>
    repairActionAppliesToTargets(candidate, gapTargets),
  );
  const applicableTrustedApprovedRepairActions = applicableRepairActions.filter((candidate) =>
    isTrustedApprovedRepairAction(candidate, input.trustedRepairActionId),
  );
  return [
    ...baseItems,
    {
      id: 'repair-routing',
      label: 'Repair-action routing',
      status: repairRoutingScorecardStatus({
        invalidRepairActions,
        applicableRepairActions,
        applicableTrustedApprovedRepairActions,
      }),
      summary: repairRoutingSummary({
        invalidRepairActions,
        validRepairActions,
        applicableRepairActions,
        applicableTrustedApprovedRepairActions,
      }),
      evidence: input.repairActions.map((candidate) =>
        artifact(candidate.path, mediaType(candidate.path), 'Repair-action candidate.'),
      ),
    },
  ];
}

function healthScorecardStatus(
  healthResult: ILoadedArtifact | undefined,
  harness: JsonObject | undefined,
  harnessPath: string,
): ScorecardItem['status'] {
  if (healthResult === undefined || healthResult.status === 'missing') {
    return 'missing';
  }
  if (healthResult.status !== 'loaded') {
    return 'partial';
  }
  if (healthResultBindingIssues(healthResult, harness, harnessPath).length > 0) {
    return 'partial';
  }
  return getString(healthResult.document ?? {}, 'status') === 'passed' ? 'present' : 'partial';
}

function healthSummary(
  healthResult: ILoadedArtifact | undefined,
  harness: JsonObject | undefined,
  harnessPath: string,
): string {
  if (healthResult === undefined) {
    return 'No health-result artifact is available.';
  }
  if (healthResult.status !== 'loaded') {
    return healthResult.issues.join('; ');
  }
  const bindingIssues = healthResultBindingIssues(healthResult, harness, harnessPath);
  if (bindingIssues.length > 0) {
    return `Health result does not match the current harness: ${bindingIssues.join('; ')}`;
  }
  const status = getString(healthResult.document ?? {}, 'status') ?? 'unknown';
  const checks = (getArray(healthResult.document ?? {}, 'checks') ?? []).filter(isObject);
  return status === 'passed'
    ? `${checks.length} local project health check(s) passed.`
    : `Health result status is ${status}; local project health evidence is not passing.`;
}

function healthResultBindingIssues(
  healthResult: ILoadedArtifact,
  harness: JsonObject | undefined,
  harnessPath: string,
): readonly string[] {
  const document = healthResult.document ?? {};
  const source = getObject(document, 'source') ?? {};
  const issues: string[] = [];
  const sourceHarness = getString(source, 'harness');
  if (
    sourceHarness === undefined ||
    normalizeArtifactPath(sourceHarness) !== normalizeArtifactPath(harnessPath)
  ) {
    issues.push(`source.harness ${sourceHarness ?? '<missing>'} does not match ${harnessPath}`);
  }
  const approvalPolicy = getString(harness ?? {}, 'approval_policy');
  const sourceApprovalPolicy = getString(source, 'approval_policy');
  if (
    approvalPolicy !== undefined &&
    (sourceApprovalPolicy === undefined ||
      normalizeArtifactPath(sourceApprovalPolicy) !== normalizeArtifactPath(approvalPolicy))
  ) {
    issues.push('source.approval_policy does not match harness approval_policy');
  }
  const sandbox = getString(harness ?? {}, 'sandbox');
  const sourceSandboxPolicy = getString(source, 'sandbox_policy');
  if (
    sandbox !== undefined &&
    (sourceSandboxPolicy === undefined ||
      normalizeArtifactPath(sourceSandboxPolicy) !== normalizeArtifactPath(sandbox))
  ) {
    issues.push('source.sandbox_policy does not match harness sandbox');
  }
  const configuredChecks = (getArray(getObject(harness ?? {}, 'health') ?? {}, 'checks') ?? [])
    .filter(isObject)
    .map((check) => ({
      id: getString(check, 'id'),
      command: getObject(check, 'command'),
      trust: getObject(check, 'trust_requirements'),
      artifacts: getArray(check, 'artifacts') ?? [],
    }));
  const resultChecks = (getArray(document, 'checks') ?? []).filter(isObject);
  const configuredIds = new Set(configuredChecks.map((check) => check.id));
  const resultIds = new Set<string>();
  for (const resultCheck of resultChecks) {
    const resultId = getString(resultCheck, 'id');
    if (resultId === undefined) {
      issues.push('health result check is missing id');
      continue;
    }
    if (resultIds.has(resultId)) {
      issues.push(`health result check ${resultId} appears more than once`);
    }
    resultIds.add(resultId);
    if (!configuredIds.has(resultId)) {
      issues.push(`health result check ${resultId} is not configured in the current harness`);
    }
  }
  for (const configuredCheck of configuredChecks) {
    const resultCheck = resultChecks.find((check) => getString(check, 'id') === configuredCheck.id);
    if (resultCheck === undefined) {
      issues.push(`check ${configuredCheck.id ?? '<missing>'} is missing from health result`);
      continue;
    }
    if (!jsonEqual(getObject(resultCheck, 'command'), configuredCheck.command)) {
      issues.push(
        `check ${configuredCheck.id ?? '<missing>'} command does not match current harness`,
      );
    }
    if (!jsonEqual(getObject(resultCheck, 'trust_requirements'), configuredCheck.trust)) {
      issues.push(
        `check ${configuredCheck.id ?? '<missing>'} trust_requirements do not match current harness`,
      );
    }
    if (!jsonEqual(getArray(resultCheck, 'artifacts') ?? [], configuredCheck.artifacts)) {
      issues.push(
        `check ${configuredCheck.id ?? '<missing>'} artifacts do not match current harness`,
      );
    }
    if (getString(resultCheck, 'status') !== 'passed') {
      issues.push(`check ${configuredCheck.id ?? '<missing>'} status is not passed`);
    }
  }
  return issues;
}

function jsonEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return stableJson(left ?? null) === stableJson(right ?? null);
}

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function doctorScorecardStatus(
  doctorResult: ILoadedArtifact | undefined,
  configuredCheckCount: number,
): ScorecardItem['status'] {
  if (doctorResult === undefined) {
    return configuredCheckCount > 0 ? 'partial' : 'missing';
  }
  if (doctorResult.status !== 'loaded') {
    return doctorResult.status === 'missing' ? 'missing' : 'partial';
  }
  return getString(doctorResult.document ?? {}, 'status') === 'passed' ? 'present' : 'partial';
}

function doctorSummary(
  doctorResult: ILoadedArtifact | undefined,
  configuredCheckCount: number,
): string {
  if (doctorResult === undefined) {
    return configuredCheckCount > 0
      ? 'Doctor checks are configured, but no doctor-result artifact was supplied.'
      : 'No doctor checks or doctor-result artifact are available.';
  }
  if (doctorResult.status !== 'loaded') {
    return doctorResult.issues.join('; ');
  }
  const status = getString(doctorResult.document ?? {}, 'status') ?? 'unknown';
  return status === 'passed'
    ? 'Doctor result status is passed.'
    : `Doctor result status is ${status}; structural evidence is not passing.`;
}

function runResultsScorecardStatus(
  runResults: ILoadedArtifact | undefined,
): ScorecardItem['status'] {
  if (runResults === undefined || runResults.status === 'missing') {
    return 'missing';
  }
  if (runResults.status !== 'loaded') {
    return 'partial';
  }
  const document = runResults.document ?? {};
  const total = numberValue(document, 'total');
  const passed = numberValue(document, 'passed');
  const failed = numberValue(document, 'failed');
  const error = numberValue(document, 'error');
  const skipped = numberValue(document, 'skipped');
  return total > 0 && passed === total && failed === 0 && error === 0 && skipped === 0
    ? 'present'
    : 'partial';
}

function runResultsSummary(runResults: ILoadedArtifact | undefined): string {
  if (runResults === undefined) {
    return 'No run-result ledger is available.';
  }
  if (runResults.status !== 'loaded') {
    return runResults.issues.join('; ');
  }
  const document = runResults.document ?? {};
  const total = numberValue(document, 'total');
  const passed = numberValue(document, 'passed');
  const failed = numberValue(document, 'failed');
  const error = numberValue(document, 'error');
  const skipped = numberValue(document, 'skipped');
  const externalImportTotal = numberValue(document, 'external_import_total');
  const externalImportPassed = numberValue(document, 'external_import_passed');
  const externalImportFailed = numberValue(document, 'external_import_failed');
  const externalImportError = numberValue(document, 'external_import_error');
  const externalImportSkipped = numberValue(document, 'external_import_skipped');
  const summary = `${total} run-result record(s) counted as verifier/evaluation evidence: ${passed} passed, ${failed} failed, ${error} error, ${skipped} skipped.${externalImportTotal > 0 ? ` External-import records: ${externalImportTotal} total (${externalImportPassed} passed, ${externalImportFailed} failed, ${externalImportError} error, ${externalImportSkipped} skipped), not counted as verifier/evaluation evidence.` : ''}`;
  return total > 0 && passed === total && failed === 0 && error === 0 && skipped === 0
    ? summary
    : `${summary} At least one non-external verifier or evaluation run-result record must be passed, and all counted records must be passed, before treating run evidence as present.`;
}

function scoreboardReportStatus(
  scoreboard: ILoadedArtifact | undefined,
  report: ILoadedArtifact | undefined,
): ScorecardItem['status'] {
  if (scoreboard === undefined && report === undefined) {
    return 'missing';
  }
  if (
    scoreboard?.status === 'loaded' &&
    report?.status === 'loaded' &&
    getString(scoreboard.document ?? {}, 'status') === 'passed'
  ) {
    return 'present';
  }
  return 'partial';
}

function scoreboardReportSummary(
  scoreboard: ILoadedArtifact | undefined,
  report: ILoadedArtifact | undefined,
): string {
  if (scoreboard === undefined && report === undefined) {
    return 'Provide both scoreboard and report artifacts for reviewer-friendly assessment.';
  }
  if (scoreboard?.status === 'loaded' && report?.status === 'loaded') {
    const status = getString(scoreboard.document ?? {}, 'status') ?? 'unknown';
    return status === 'passed'
      ? 'Passing scoreboard and harness-generated report artifacts are available.'
      : `Scoreboard status is ${status}; scoreboard evidence is not passing.`;
  }
  const issues = [
    ...(scoreboard === undefined
      ? ['scoreboard artifact was not supplied']
      : scoreboard.status === 'loaded'
        ? []
        : scoreboard.issues),
    ...(report === undefined
      ? ['report artifact was not supplied']
      : report.status === 'loaded'
        ? []
        : report.issues),
  ];
  return issues.join('; ');
}

function maturityForScorecard(scorecard: readonly ScorecardItem[]): JsonObject {
  const score = scorecard.filter((item) => item.status === 'present').length;
  const maxScore = scorecard.length;
  const ratio = maxScore === 0 ? 0 : score / maxScore;
  const level = score === 0 ? 0 : score === maxScore ? 4 : ratio >= 0.65 ? 3 : ratio >= 0.4 ? 2 : 1;
  const labels = ['no harness', 'bootstrapped', 'validated', 'observable', 'agent-ready'];
  return {
    level,
    label: labels[level] ?? 'unknown',
    score,
    ['max_score']: maxScore,
  };
}

function implementationRoutingFor(
  harness: JsonObject | undefined,
  harnessPath: string,
  repairActions: readonly IRepairActionCandidate[],
  scorecard: readonly ScorecardItem[],
  trustedRepairActionId: string | undefined,
): JsonObject {
  const validRepairActions = sortRepairActions(repairActions.filter(isValidRepairAction));
  const gapTargets = assessmentGapTargets(scorecard);
  const approvedRepairAction = validRepairActions.find(
    (candidate) =>
      isTrustedApprovedRepairAction(candidate, trustedRepairActionId) &&
      repairActionAppliesToTargets(candidate, gapTargets),
  );
  const routes: JsonObject[] = [];
  for (const repairAction of validRepairActions) {
    const approvalState = getString(repairAction.document, 'approval_state') ?? 'proposed';
    const actionId = getString(repairAction.document, 'action_id') ?? repairAction.path;
    const approvalTrust = actionId === trustedRepairActionId ? 'trusted' : 'untrusted';
    const targetFiles = repairActionTargetFiles(repairAction);
    const applicability = repairActionAppliesToTargets(repairAction, gapTargets)
      ? 'applicable'
      : 'not-applicable';
    const route: JsonObject = {
      id: `repair-action:${actionId}`,
      kind: 'repair-action',
      status: repairActionRouteStatus(approvalState, applicability, approvalTrust),
      summary: repairActionRouteSummary(approvalState, applicability, approvalTrust),
      ['approval_state']: approvalState,
      ['approval_trust']: approvalTrust,
      ['risk_class']: getString(repairAction.document, 'risk_class') ?? 'critical',
      ['repair_mode']: getString(repairAction.document, 'repair_mode') ?? 'preview-backed',
      ['sandbox_requirement']:
        getString(repairAction.document, 'sandbox_requirement') ?? 'worktree',
      ['trust_requirements']: getObject(repairAction.document, 'trust_requirements') ?? {},
      ['target_files']: targetFiles,
      applicability,
      evidence: [
        artifact(repairAction.path, mediaType(repairAction.path), 'Repair-action artifact.'),
      ],
    };
    routes.push(route);
  }
  const continuity = getObject(harness ?? {}, 'continuity');
  if (continuity !== undefined) {
    routes.push({
      id: 'native-execution-loop',
      kind: 'execution-loop',
      status: 'available',
      summary:
        'Continuity configuration is present; agents can produce continuity/self-verification evidence and validate explicit artifacts with harness loop validate.',
      evidence: [
        artifact(`${harnessPath}#/continuity`, 'application/yaml', 'Continuity configuration.'),
      ],
    });
  }
  routes.push({
    id: 'external-workflow-skill',
    kind: 'external-source-material',
    status: 'unavailable',
    summary:
      'External workflow skills are not implementation routes for this repository; useful practices are mined into harness-native capability candidates instead.',
    evidence: [],
  });
  routes.push({
    id: 'cli-fallback',
    kind: 'cli-fallback',
    status: 'fallback',
    summary:
      'When no approved native repair action or execution-loop route is configured, ask for approval and run the relevant deterministic harness CLI commands directly with explicit artifact inputs.',
    evidence: [],
  });
  const selectedRoute =
    approvedRepairAction !== undefined
      ? 'repair-action'
      : continuity !== undefined
        ? 'execution-loop'
        : 'cli-fallback';
  return {
    ['selected_route']: selectedRoute,
    routes,
  };
}

function recommendationsFor(input: {
  readonly harnessDocument: JsonObject | undefined;
  readonly scorecard: readonly ScorecardItem[];
  readonly implementationRouting: JsonObject;
}): JsonObject[] {
  const recommendations: JsonObject[] = [];
  for (const item of input.scorecard) {
    if (item.status !== 'missing' && item.status !== 'partial') {
      continue;
    }
    recommendations.push({
      category: recommendationCategory(item.id),
      severity: item.status === 'missing' ? 'warning' : 'info',
      message: recommendationForPrimitive(item.id),
      evidence: item.evidence,
    });
  }
  if (getString(input.implementationRouting, 'selected_route') === 'cli-fallback') {
    recommendations.push({
      category: 'routing',
      severity: 'info',
      message:
        'Document a native repair-action or execution-loop route before asking an agent to perform writes automatically.',
      evidence: [],
    });
  }
  return recommendations;
}

function rolloutPlan(scorecard: readonly ScorecardItem[]): JsonObject[] {
  const present = new Set(
    scorecard.filter((item) => item.status === 'present').map((item) => item.id),
  );
  const steps = [
    {
      step: 'bootstrap',
      title: 'Bootstrap harness source and schema validation.',
      required: ['harness-source'],
      actions: ['Run harness init if harness.yaml is missing.', 'Run harness validate.'],
    },
    {
      step: 'policy-and-doctor',
      title: 'Add policy, sandbox, and structural doctor checks.',
      required: ['policy-sandbox', 'doctor-evidence'],
      actions: [
        'Reference approval and sandbox policy artifacts.',
        'Run harness doctor --format json.',
      ],
    },
    {
      step: 'behavioral-evidence',
      title: 'Exercise eval, trace, run-result, and scoreboard evidence.',
      required: ['eval-plans', 'run-results', 'trace-evidence', 'scoreboard-report'],
      actions: [
        'Run harness eval validate.',
        'Provide externally produced scoreboard evidence when needed.',
        'Generate harness report output.',
      ],
    },
    {
      step: 'continuity-gates',
      title: 'Gate long-running work with continuity and self-verification.',
      required: ['continuity-loop'],
      actions: [
        'Record continuity state and self-verification evidence.',
        'Run harness loop validate before completion claims.',
      ],
    },
    {
      step: 'repair-routing',
      title: 'Route agent implementation through reviewed repair or fallback paths.',
      required: ['repair-routing'],
      actions: ['Add repair-action artifacts or document CLI fallback approval flow.'],
    },
  ];
  let foundNext = false;
  return steps.map((step) => {
    const done = step.required.every((id) => present.has(id));
    const status = done ? 'done' : foundNext ? 'later' : 'next';
    if (!done && !foundNext) {
      foundNext = true;
    }
    return {
      step: step.step,
      title: step.title,
      status,
      actions: step.actions,
    };
  });
}

function statusFor(harness: ILoadedArtifact, scorecard: readonly ScorecardItem[]): string {
  if (harness.status === 'missing') {
    return 'missing-harness';
  }
  return scorecard.some((item) => item.status === 'missing' || item.status === 'partial')
    ? 'needs-work'
    : 'ready';
}

function recommendationForPrimitive(id: string): string {
  switch (id) {
    case 'harness-source':
      return 'Create or repair harness.yaml, then run harness validate.';
    case 'policy-sandbox':
      return 'Reference approval and sandbox policy artifacts from harness.yaml.';
    case 'eval-plans':
      return 'Add at least one eval suite with deterministic verifier tasks.';
    case 'doctor-evidence':
      return 'Run harness doctor --format json and provide the doctor-result artifact.';
    case 'project-health':
      return 'Review configured health commands, then run harness health --accept-unsandboxed-execution --format json and provide the health-result artifact.';
    case 'run-results':
      return 'Run harness eval validate or provide an externally produced run-result ledger.';
    case 'trace-evidence':
      return 'Provide trace examples or a trace artifact validated by harness trace validate.';
    case 'scoreboard-report':
      return 'Provide both a scoreboard and a report artifact for reviewer-facing evidence.';
    case 'continuity-loop':
      return 'Configure continuity state and validate completion evidence with harness loop validate.';
    case 'repair-routing':
      return 'Add repair-action artifacts under examples/repair-actions or pass --repair-action explicitly.';
    default:
      return 'Add substrate evidence for this primitive.';
  }
}

function recommendationCategory(id: string): string {
  switch (id) {
    case 'policy-sandbox':
      return 'policy';
    case 'eval-plans':
    case 'run-results':
    case 'scoreboard-report':
    case 'doctor-evidence':
      return 'eval';
    case 'project-health':
      return 'health';
    case 'trace-evidence':
      return 'trace';
    case 'continuity-loop':
      return 'continuity';
    default:
      return 'routing';
  }
}

function defaultRunResultsPath(harness: JsonObject | undefined): string | undefined {
  const evals = getObject(harness ?? {}, 'evals');
  return evals === undefined ? undefined : getString(evals, 'run_results');
}

function hasString(object: JsonObject, key: string): boolean {
  return getString(object, key) !== undefined;
}

function evidenceForStrings(
  object: JsonObject | undefined,
  keys: readonly string[],
  description: string,
): ArtifactRead[] {
  if (object === undefined) {
    return [];
  }
  return keys.flatMap((key) => {
    const path = getString(object, key);
    return path === undefined ? [] : [artifact(path, mediaType(path), description)];
  });
}

function assessmentGapTargets(scorecard: readonly ScorecardItem[]): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const item of scorecard) {
    if (item.id === 'repair-routing') {
      continue;
    }
    if (item.status !== 'missing' && item.status !== 'partial') {
      continue;
    }
    for (const evidence of item.evidence) {
      targets.add(normalizeArtifactPath(evidence.path));
    }
  }
  targets.delete('');
  return targets;
}

function repairActionAppliesToTargets(
  candidate: IRepairActionCandidate & { readonly document: JsonObject; readonly status: 'loaded' },
  targets: ReadonlySet<string>,
): boolean {
  if (targets.size === 0) {
    return false;
  }
  return repairActionTargetFiles(candidate).some((targetFile) =>
    targets.has(normalizeArtifactPath(targetFile)),
  );
}

function repairActionTargetFiles(
  candidate: IRepairActionCandidate & { readonly document: JsonObject; readonly status: 'loaded' },
): string[] {
  return (getArray(candidate.document, 'target_files') ?? []).filter(
    (value): value is string => typeof value === 'string',
  );
}

function normalizeArtifactPath(path: string): string {
  const withoutFragment = path.split('#', 1)[0] ?? path;
  const withForwardSlashes = withoutFragment.replaceAll('\\', '/');
  const withoutCurrentPrefix = withForwardSlashes.replace(/^(?:\.\/)+/, '');
  const normalized = posix.normalize(withoutCurrentPrefix);
  return normalized === '.' ? '' : normalized.replace(/\/$/, '');
}

function isValidRepairAction(
  candidate: IRepairActionCandidate,
): candidate is IRepairActionCandidate & {
  readonly document: JsonObject;
  readonly status: 'loaded';
} {
  return candidate.status === 'loaded' && candidate.document !== undefined;
}

function rejectDuplicateRepairActionIds(
  candidates: readonly IRepairActionCandidate[],
): IRepairActionCandidate[] {
  const pathsByActionId = new Map<string, string[]>();
  for (const candidate of candidates) {
    if (!isValidRepairAction(candidate)) {
      continue;
    }
    const actionId = getString(candidate.document, 'action_id');
    if (actionId === undefined) {
      continue;
    }
    const paths = pathsByActionId.get(actionId) ?? [];
    paths.push(candidate.path);
    pathsByActionId.set(actionId, paths);
  }
  const duplicateActionIds = new Set(
    [...pathsByActionId.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([actionId]) => actionId),
  );
  if (duplicateActionIds.size === 0) {
    return [...candidates];
  }
  return candidates.map((candidate) => {
    if (!isValidRepairAction(candidate)) {
      return candidate;
    }
    const actionId = getString(candidate.document, 'action_id');
    if (actionId === undefined || !duplicateActionIds.has(actionId)) {
      return candidate;
    }
    const paths = pathsByActionId.get(actionId) ?? [candidate.path];
    return {
      path: candidate.path,
      status: 'invalid',
      issues: [
        `duplicate action_id "${actionId}" also appears in ${paths
          .filter((path) => path !== candidate.path)
          .join(', ')}`,
      ],
    };
  });
}

function isApprovedRepairAction(
  candidate: IRepairActionCandidate & { readonly document: JsonObject; readonly status: 'loaded' },
): boolean {
  return getString(candidate.document, 'approval_state') === 'approved';
}

function isTrustedApprovedRepairAction(
  candidate: IRepairActionCandidate & { readonly document: JsonObject; readonly status: 'loaded' },
  trustedRepairActionId: string | undefined,
): boolean {
  return (
    trustedRepairActionId !== undefined &&
    isApprovedRepairAction(candidate) &&
    getString(candidate.document, 'action_id') === trustedRepairActionId
  );
}

function sortRepairActions<
  TRepairActionCandidate extends IRepairActionCandidate & {
    readonly document: JsonObject;
    readonly status: 'loaded';
  },
>(candidates: readonly TRepairActionCandidate[]): TRepairActionCandidate[] {
  return [...candidates].sort(
    (left, right) =>
      approvalRank(getString(left.document, 'approval_state')) -
        approvalRank(getString(right.document, 'approval_state')) ||
      riskRank(getString(left.document, 'risk_class')) -
        riskRank(getString(right.document, 'risk_class')) ||
      (getString(left.document, 'action_id') ?? left.path).localeCompare(
        getString(right.document, 'action_id') ?? right.path,
      ) ||
      left.path.localeCompare(right.path),
  );
}

function approvalRank(approvalState: string | undefined): number {
  switch (approvalState) {
    case 'approved':
      return 0;
    case 'proposed':
      return 1;
    case 'applied':
      return 2;
    case 'rejected':
      return 3;
    default:
      return 4;
  }
}

function riskRank(riskClass: string | undefined): number {
  switch (riskClass) {
    case 'low':
      return 0;
    case 'medium':
      return 1;
    case 'high':
      return 2;
    case 'critical':
      return 3;
    default:
      return 4;
  }
}

function repairRoutingScorecardStatus(input: {
  readonly invalidRepairActions: readonly IRepairActionCandidate[];
  readonly applicableRepairActions: readonly (IRepairActionCandidate & {
    readonly document: JsonObject;
    readonly status: 'loaded';
  })[];
  readonly applicableTrustedApprovedRepairActions: readonly (IRepairActionCandidate & {
    readonly document: JsonObject;
    readonly status: 'loaded';
  })[];
}): ScorecardItem['status'] {
  if (input.invalidRepairActions.length > 0) {
    return 'partial';
  }
  if (input.applicableTrustedApprovedRepairActions.length > 0) {
    return 'present';
  }
  if (input.applicableRepairActions.length > 0) {
    return 'partial';
  }
  return 'advisory';
}

function repairRoutingSummary(input: {
  readonly invalidRepairActions: readonly IRepairActionCandidate[];
  readonly validRepairActions: readonly (IRepairActionCandidate & {
    readonly document: JsonObject;
    readonly status: 'loaded';
  })[];
  readonly applicableRepairActions: readonly (IRepairActionCandidate & {
    readonly document: JsonObject;
    readonly status: 'loaded';
  })[];
  readonly applicableTrustedApprovedRepairActions: readonly (IRepairActionCandidate & {
    readonly document: JsonObject;
    readonly status: 'loaded';
  })[];
}): string {
  if (
    input.applicableTrustedApprovedRepairActions.length > 0 &&
    input.invalidRepairActions.length > 0
  ) {
    return `${input.applicableTrustedApprovedRepairActions.length} trusted applicable approved repair action candidate(s) discovered, but ${input.invalidRepairActions.length} candidate(s) are invalid: ${repairActionIssues(input.invalidRepairActions)}`;
  }
  if (input.applicableTrustedApprovedRepairActions.length > 0) {
    return `${input.applicableTrustedApprovedRepairActions.length} trusted applicable approved repair action candidate(s) discovered.`;
  }
  if (input.applicableRepairActions.length > 0 && input.invalidRepairActions.length > 0) {
    return `${input.applicableRepairActions.length} applicable schema-valid repair action candidate(s) discovered, but none have trusted approval for routing and ${input.invalidRepairActions.length} candidate(s) are invalid: ${repairActionIssues(input.invalidRepairActions)}`;
  }
  if (input.applicableRepairActions.length > 0) {
    return `${input.applicableRepairActions.length} applicable schema-valid repair action candidate(s) discovered, but none have trusted approval for routing.`;
  }
  if (input.validRepairActions.length > 0 && input.invalidRepairActions.length > 0) {
    return `${input.validRepairActions.length} schema-valid repair action candidate(s) discovered, but none target current missing or partial assessment evidence and ${input.invalidRepairActions.length} candidate(s) are invalid: ${repairActionIssues(input.invalidRepairActions)}`;
  }
  if (input.validRepairActions.length > 0) {
    return `${input.validRepairActions.length} schema-valid repair action candidate(s) discovered, but none target current missing or partial assessment evidence.`;
  }
  if (input.invalidRepairActions.length > 0) {
    return `${input.invalidRepairActions.length} repair action candidate(s) discovered but none are schema-valid: ${repairActionIssues(input.invalidRepairActions)}`;
  }
  return 'No repair action candidates were discovered; the adapter will emit a CLI fallback route.';
}

function repairActionRouteStatus(
  approvalState: string,
  applicability: string,
  approvalTrust: string,
): string {
  if (applicability !== 'applicable') {
    return 'unavailable';
  }
  if (approvalState === 'approved' && approvalTrust !== 'trusted') {
    return 'needs-approval';
  }
  switch (approvalState) {
    case 'approved':
      return 'available';
    case 'proposed':
      return 'needs-approval';
    default:
      return 'unavailable';
  }
}

function repairActionRouteSummary(
  approvalState: string,
  applicability: string,
  approvalTrust: string,
): string {
  if (applicability !== 'applicable') {
    return `Repair-action target files do not overlap current missing or partial assessment evidence; approval state is ${approvalState}, and the artifact is not selected for implementation routing.`;
  }
  if (approvalState === 'approved' && approvalTrust !== 'trusted') {
    return 'The repair-action artifact declares approval, but no trusted approval was provided with this assessment run, so it remains a review candidate only.';
  }
  switch (approvalState) {
    case 'approved':
      return 'An approved repair-action artifact is available for review. This assessment routes to the artifact and metadata; it does not emit or execute repair commands.';
    case 'proposed':
      return 'A schema-valid repair-action artifact exists, but it is only proposed. Review and approve it before treating it as an implementation route.';
    case 'rejected':
      return 'A schema-valid repair-action artifact exists, but it is rejected and cannot be selected.';
    case 'applied':
      return 'A schema-valid repair-action artifact exists, but it is already applied and is not selected for new implementation routing.';
    default:
      return 'A schema-valid repair-action artifact exists, but its approval state is not selectable.';
  }
}

function repairActionIssues(candidates: readonly IRepairActionCandidate[]): string {
  return candidates
    .map((candidate) => {
      const issueSummary =
        candidate.issues.length === 0 ? candidate.status : candidate.issues.join('; ');
      return `${candidate.path}: ${issueSummary}`;
    })
    .join(' | ');
}

function sortedArtifacts(artifacts: readonly ArtifactRead[]): ArtifactRead[] {
  const byPath = new Map<string, ArtifactRead>();
  for (const artifact of artifacts) {
    byPath.set(artifact.path, artifact);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function artifact(path: string, mediaTypeValue: string, description: string): ArtifactRead {
  return {
    path,
    ['media_type']: mediaTypeValue,
    description,
  };
}

function mediaType(path: string): string {
  if (path.endsWith('.json') || path.endsWith('.jsonl')) {
    return path.endsWith('.jsonl') ? 'application/jsonl' : 'application/json';
  }
  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    return 'application/yaml';
  }
  if (path.endsWith('.md')) {
    return 'text/markdown';
  }
  return 'text/plain';
}

function canonicalPath(root: string, path: string, description: string): string {
  return relativePathFromRoot(root, resolveInsideRoot(root, path, description), description);
}

function assessmentIdFor(input: {
  readonly cliVersion: string;
  readonly harnessPath: string;
  readonly scorecard: readonly ScorecardItem[];
  readonly implementationRouting: JsonObject;
  readonly artifactsRead: readonly ArtifactRead[];
}): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        ['cli_version']: input.cliVersion,
        harness: input.harnessPath,
        scorecard: input.scorecard.map((item) => ({
          id: item.id,
          status: item.status,
          summary: item.summary,
        })),
        ['selected_route']: getString(input.implementationRouting, 'selected_route'),
        ['artifacts_read']: input.artifactsRead.map((artifact) => artifact.path),
      }),
    )
    .digest('hex')
    .slice(0, 12);
  return `assessment-${digest}`;
}

function jsonObjects(values: readonly JsonValue[]): JsonObject[] {
  return values.filter(isObject);
}

function validationErrorMessage(error: unknown): string | undefined {
  return error instanceof CliError && error.exitCode === ExitCode.validationError
    ? error.message
    : undefined;
}

function numberText(object: JsonObject, key: string): string {
  return String(numberValue(object, key));
}

function numberValue(object: JsonObject, key: string): number {
  const value = object[key];
  return typeof value === 'number' ? value : 0;
}

function markdownText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
}
