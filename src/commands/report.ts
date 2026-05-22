import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { CliError } from '../lib/errors.ts';
import { ExitCode } from '../lib/exit-codes.ts';
import { assertNoSymlinkWithinRoot, loadDocument, pathKind } from '../lib/files.ts';
import { collectHarnessReferences } from '../lib/harness.ts';
import {
  getArray,
  getObject,
  getString,
  isObject,
  type JsonObject,
  type JsonValue,
} from '../lib/json.ts';
import { optionValue, parseOptions } from '../lib/options.ts';
import {
  relativePathFromRoot,
  resolveInsideRoot,
  resolveRootForInspectionCommand,
} from '../lib/paths.ts';
import {
  formatValidationIssue,
  loadSchemaRegistry,
  type SchemaRegistry,
} from '../lib/schema-registry.ts';
import type { CommandContext } from './init.ts';

const valueOptions = new Set([
  'root',
  'file',
  'verification',
  'run-result',
  'trace',
  'scoreboard',
  'doctor-result',
  'judge-policy',
  'judge-result',
]);
const flagOptions = new Set<string>();

export async function runReport(
  args: readonly string[],
  context: CommandContext,
): Promise<ExitCode> {
  const options = parseOptions(args, valueOptions, flagOptions);
  if (options.positionals.length > 1) {
    throw new CliError(
      'report accepts at most one harness file positional argument.',
      ExitCode.usageError,
    );
  }

  const root = resolveRootForInspectionCommand(context.cwd, optionValue(options, 'root') ?? '.');
  const harnessPath = optionValue(options, 'file') ?? options.positionals[0] ?? 'harness.yaml';
  const absoluteHarnessPath = resolveInsideRoot(root, harnessPath, 'Harness file');
  await assertNoSymlinkWithinRoot(root, absoluteHarnessPath, 'read');
  if ((await pathKind(absoluteHarnessPath)) !== 'file') {
    throw new CliError(`Harness file not found: ${harnessPath}`, ExitCode.notFound);
  }

  const citedPaths = new Set<string>([harnessPath]);
  const harness = await loadDocument(absoluteHarnessPath);
  context.stdout('Harness report');
  context.stdout(`- harness: ${harnessPath}`);
  if (isObject(harness)) {
    const harnessBlock = getObject(harness, 'harness');
    const name = harnessBlock === undefined ? undefined : getString(harnessBlock, 'name');
    if (name !== undefined) {
      context.stdout(`- name: ${name}`);
    }
    const references = [
      ...new Set(collectHarnessReferences(harness).map((reference) => reference.path)),
    ];
    if (references.length > 0) {
      context.stdout('- artifacts:');
      for (const reference of references) {
        citedPaths.add(reference);
        context.stdout(`  - ${reference}`);
      }
    }
  }

  await summarizeOptionalArtifact(
    root,
    options,
    'verification',
    'verification',
    citedPaths,
    context,
  );
  const schemasNeeded =
    optionValue(options, 'run-result') !== undefined ||
    optionValue(options, 'judge-policy') !== undefined ||
    optionValue(options, 'judge-result') !== undefined;
  const schemas = schemasNeeded ? await loadSchemaRegistry(context.packageRoot) : undefined;
  const runResult =
    schemas === undefined
      ? undefined
      : await summarizeRunResult(root, options, schemas, citedPaths, context);
  await summarizeOptionalArtifact(root, options, 'trace', 'trace', citedPaths, context);
  await summarizeOptionalArtifact(root, options, 'scoreboard', 'scoreboard', citedPaths, context);
  await summarizeOptionalArtifact(
    root,
    options,
    'doctor-result',
    'doctor result',
    citedPaths,
    context,
  );
  const judgePolicyPath = optionValue(options, 'judge-policy');
  const judgeResultPath = optionValue(options, 'judge-result');
  if (schemas !== undefined && (judgePolicyPath !== undefined || judgeResultPath !== undefined)) {
    if (judgePolicyPath !== undefined) {
      await summarizeJudgePolicy(root, judgePolicyPath, schemas, citedPaths, context);
    }
    if (judgeResultPath !== undefined) {
      await summarizeJudgeResult(
        root,
        judgeResultPath,
        judgePolicyPath,
        schemas,
        citedPaths,
        context,
        runResult,
      );
    }
  }

  context.stdout('- cited paths:');
  for (const path of [...citedPaths].sort()) {
    context.stdout(`  - ${path}`);
  }
  return ExitCode.ok;
}

async function summarizeRunResult(
  root: string,
  options: ReturnType<typeof parseOptions>,
  schemas: SchemaRegistry,
  citedPaths: Set<string>,
  context: CommandContext,
): Promise<JsonObject | undefined> {
  const artifactPath = optionValue(options, 'run-result');
  if (artifactPath === undefined) {
    return undefined;
  }

  const runResult = await loadValidatedArtifact(
    root,
    artifactPath,
    'run result',
    'run-result',
    schemas,
  );
  citedPaths.add(artifactPath);
  context.stdout(`- run result: ${artifactPath}`);
  const status = getString(runResult, 'status');
  if (status !== undefined) {
    context.stdout(`  status: ${status}`);
  }

  const linkedJudgeResults = await validateLinkedJudgeResults(root, runResult, schemas);
  if (linkedJudgeResults.length > 0) {
    context.stdout(`  judge results: ${linkedJudgeResults.length}`);
    for (const linked of linkedJudgeResults) {
      citedPaths.add(linked.path);
      citedPaths.add(linked.policyPath);
    }
  }
  return runResult;
}

async function summarizeOptionalArtifact(
  root: string,
  options: ReturnType<typeof parseOptions>,
  optionName: string,
  label: string,
  citedPaths: Set<string>,
  context: CommandContext,
): Promise<void> {
  const artifactPath = optionValue(options, optionName);
  if (artifactPath === undefined) {
    return;
  }
  const artifact = await loadReportArtifact(root, artifactPath, label);
  citedPaths.add(artifactPath);
  context.stdout(`- ${label}: ${artifactPath}`);
  if (isObject(artifact)) {
    const status = getString(artifact, 'status');
    if (status !== undefined) {
      context.stdout(`  status: ${status}`);
    }
    const acceptanceChecks = getArray(artifact, 'acceptance_checks');
    if (acceptanceChecks !== undefined) {
      context.stdout(`  acceptance checks: ${acceptanceChecks.length}`);
    }
  }
}

async function summarizeJudgePolicy(
  root: string,
  artifactPath: string,
  schemas: SchemaRegistry,
  citedPaths: Set<string>,
  context: CommandContext,
): Promise<JsonObject> {
  const policy = await loadValidatedArtifact(
    root,
    artifactPath,
    'judge policy',
    'judge-policy',
    schemas,
  );
  const policyIssues = validateJudgePolicyCalibrationExamples(policy);
  if (policyIssues.length > 0) {
    throw new CliError(
      `Judge policy violates calibration examples: ${policyIssues.join('; ')}`,
      ExitCode.validationError,
    );
  }
  citedPaths.add(artifactPath);
  context.stdout(`- judge policy: ${artifactPath}`);
  const policyId = getString(policy, 'policy_id');
  if (policyId !== undefined) {
    context.stdout(`  policy: ${policyId}`);
  }
  const judgeId = getString(policy, 'judge_id');
  if (judgeId !== undefined) {
    context.stdout(`  judge: ${judgeId}`);
  }
  const calibration = getObject(policy, 'calibration');
  if (calibration !== undefined) {
    const metric = getString(calibration, 'agreement_metric');
    const threshold = getNumber(calibration, 'blocking_threshold');
    const sampleMinimum = getNumber(calibration, 'labeled_sample_minimum');
    if (metric !== undefined) {
      context.stdout(`  metric: ${metric}`);
    }
    if (threshold !== undefined) {
      context.stdout(`  blocking threshold: ${threshold}`);
    }
    if (sampleMinimum !== undefined) {
      context.stdout(`  labeled sample minimum: ${sampleMinimum}`);
    }
  }
  return policy;
}

async function summarizeJudgeResult(
  root: string,
  artifactPath: string,
  explicitPolicyPath: string | undefined,
  schemas: SchemaRegistry,
  citedPaths: Set<string>,
  context: CommandContext,
  runResult?: JsonObject,
): Promise<void> {
  const result = await loadValidatedArtifact(
    root,
    artifactPath,
    'judge result',
    'judge-result',
    schemas,
  );
  const policyRef = getString(result, 'policy_ref');
  if (policyRef === undefined) {
    throw new CliError('Judge result is missing policy_ref.', ExitCode.validationError);
  }

  const policyPath = explicitPolicyPath ?? policyRef;
  if (explicitPolicyPath !== undefined) {
    const expectedPolicyPath = relativePathFromRoot(
      root,
      resolveInsideRoot(root, policyRef, 'Judge policy reference'),
      'Judge policy reference',
    );
    const actualPolicyPath = relativePathFromRoot(
      root,
      resolveInsideRoot(root, explicitPolicyPath, 'Judge policy artifact'),
      'Judge policy artifact',
    );
    if (expectedPolicyPath !== actualPolicyPath) {
      throw new CliError(
        `Judge result policy_ref ${policyRef} does not match --judge-policy ${explicitPolicyPath}.`,
        ExitCode.validationError,
      );
    }
  }

  const policy = await loadValidatedArtifact(
    root,
    policyPath,
    'judge policy',
    'judge-policy',
    schemas,
  );
  const policyIssues = [
    ...validateJudgePolicyCalibrationExamples(policy),
    ...(await validateJudgePolicyDigest(root, policyPath, result)),
    ...validateJudgeResultAgainstPolicy(policy, result),
    ...validateJudgeResultCalibrationExamples(result),
    ...validateJudgeResultRunId(result, runResult),
    ...validateExplicitJudgeResultLink(root, artifactPath, runResult),
  ];
  if (policyIssues.length > 0) {
    throw new CliError(
      `Judge result violates policy ${policyPath}: ${policyIssues.join('; ')}`,
      ExitCode.validationError,
    );
  }

  citedPaths.add(artifactPath);
  citedPaths.add(policyPath);
  context.stdout(`- judge result: ${artifactPath}`);
  context.stdout(`  policy: ${policyPath}`);
  const effect = getString(result, 'effect');
  if (effect !== undefined) {
    context.stdout(`  effect: ${effect}`);
  }
  const calibration = getObject(result, 'calibration');
  if (calibration !== undefined) {
    const status = getString(calibration, 'status');
    if (status !== undefined) {
      context.stdout(`  calibration: ${status}`);
    }
    const metric = getString(calibration, 'agreement_metric');
    const score = getNumber(calibration, 'agreement_score');
    if (metric !== undefined && score !== undefined) {
      context.stdout(`  agreement: ${score} ${metric}`);
    }
  }
}

async function validateLinkedJudgeResults(
  root: string,
  runResult: JsonObject,
  schemas: SchemaRegistry,
): Promise<readonly { readonly path: string; readonly policyPath: string }[]> {
  const linked: Array<{ path: string; policyPath: string }> = [];
  const policyCache = new Map<string, CachedJudgePolicy>();
  const judgeResults = getArray(runResult, 'judge_results') ?? [];
  for (const judgeResultLink of judgeResults) {
    if (!isObject(judgeResultLink)) {
      continue;
    }
    const judgeResultPath = getString(judgeResultLink, 'path');
    if (judgeResultPath === undefined) {
      continue;
    }
    const judgeResult = await loadValidatedArtifact(
      root,
      judgeResultPath,
      'judge result',
      'judge-result',
      schemas,
    );
    const policyPath = requiredString(judgeResult, 'policy_ref', 'Judge result policy_ref');
    const policy = await loadCachedJudgePolicy(root, policyPath, schemas, policyCache);
    const policyIssues = [
      ...policy.calibrationIssues,
      ...validateJudgePolicyDigestValue(policy.digest, judgeResult),
      ...validateJudgeResultAgainstPolicy(policy.artifact, judgeResult),
      ...validateJudgeResultCalibrationExamples(judgeResult),
      ...validateJudgeResultRunId(judgeResult, runResult),
    ];
    if (policyIssues.length > 0) {
      throw new CliError(
        `Linked judge result ${judgeResultPath} violates policy ${policyPath}: ${policyIssues.join('; ')}`,
        ExitCode.validationError,
      );
    }
    const canonicalPath = relativePathFromRoot(
      root,
      resolveInsideRoot(root, judgeResultPath, 'judge result artifact'),
      'judge result artifact',
    );
    if (linked.some((item) => item.path === canonicalPath)) {
      throw new CliError(
        `Run result links duplicate judge result: ${judgeResultPath}`,
        ExitCode.validationError,
      );
    }
    linked.push({ path: canonicalPath, policyPath: policy.path });
  }
  return linked;
}

type CachedJudgePolicy = {
  readonly path: string;
  readonly artifact: JsonObject;
  readonly digest: string;
  readonly calibrationIssues: readonly string[];
};

async function loadCachedJudgePolicy(
  root: string,
  policyPath: string,
  schemas: SchemaRegistry,
  cache: Map<string, CachedJudgePolicy>,
): Promise<CachedJudgePolicy> {
  const canonicalPath = relativePathFromRoot(
    root,
    resolveInsideRoot(root, policyPath, 'Judge policy artifact'),
    'Judge policy artifact',
  );
  const cached = cache.get(canonicalPath);
  if (cached !== undefined) {
    return cached;
  }
  const artifact = await loadValidatedArtifact(
    root,
    canonicalPath,
    'judge policy',
    'judge-policy',
    schemas,
  );
  const policy = {
    path: canonicalPath,
    artifact,
    digest: await digestFile(root, canonicalPath, 'Judge policy artifact'),
    calibrationIssues: validateJudgePolicyCalibrationExamples(artifact),
  };
  cache.set(canonicalPath, policy);
  return policy;
}

async function loadValidatedArtifact(
  root: string,
  artifactPath: string,
  label: string,
  schemaName: string,
  schemas: SchemaRegistry,
): Promise<JsonObject> {
  const artifact = await loadReportArtifact(root, artifactPath, label);
  const issues = schemas.validate(schemaName, artifact).map(formatValidationIssue);
  if (issues.length > 0) {
    throw new CliError(
      `${label} artifact failed schema validation: ${issues.join('; ')}`,
      ExitCode.validationError,
    );
  }
  if (!isObject(artifact)) {
    throw new CliError(`${label} artifact must be an object.`, ExitCode.validationError);
  }
  return artifact;
}

async function loadReportArtifact(
  root: string,
  artifactPath: string,
  label: string,
): Promise<JsonValue> {
  const absolutePath = resolveInsideRoot(root, artifactPath, `${label} artifact`);
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  if ((await pathKind(absolutePath)) !== 'file') {
    throw new CliError(`${label} artifact not found: ${artifactPath}`, ExitCode.notFound);
  }
  return await loadDocument(absolutePath);
}

function validateJudgeResultAgainstPolicy(
  policy: JsonObject,
  result: JsonObject,
): readonly string[] {
  const issues: string[] = [];
  const policyCalibration = getObject(policy, 'calibration') ?? {};
  const resultCalibration = getObject(result, 'calibration') ?? {};

  const policyId = getString(policy, 'policy_id');
  const resultPolicyId = getString(result, 'policy_id');
  if (policyId !== resultPolicyId) {
    issues.push(
      `policy_id ${resultPolicyId ?? '<missing>'} does not match ${policyId ?? '<missing>'}`,
    );
  }

  const policyJudgeId = getString(policy, 'judge_id');
  const resultJudgeId = getString(result, 'judge_id');
  if (policyJudgeId !== resultJudgeId) {
    issues.push(
      `judge_id ${resultJudgeId ?? '<missing>'} does not match ${policyJudgeId ?? '<missing>'}`,
    );
  }

  const policyMetric = getString(policyCalibration, 'agreement_metric');
  const resultMetric = getString(resultCalibration, 'agreement_metric');
  if (policyMetric !== resultMetric) {
    issues.push(
      `agreement_metric ${resultMetric ?? '<missing>'} does not match ${policyMetric ?? '<missing>'}`,
    );
  }

  const sampleMinimum = getNumber(policyCalibration, 'labeled_sample_minimum');
  const sampleCount = getNumber(resultCalibration, 'labeled_sample_count');
  const threshold = getNumber(policyCalibration, 'blocking_threshold');
  const score = getNumber(resultCalibration, 'agreement_score');
  const status = getString(resultCalibration, 'status');
  const effect = getString(result, 'effect');
  const staleAfterDays = getNumber(policyCalibration, 'stale_after_days');
  const ageDays = calibrationAgeDays(result, resultCalibration);
  const calibratedAfterProduced = ageDays !== undefined && ageDays < 0;
  const isStaleByPolicy =
    staleAfterDays !== undefined &&
    ageDays !== undefined &&
    !calibratedAfterProduced &&
    ageDays > staleAfterDays;

  if (status !== 'uncalibrated' && sampleMinimum !== undefined && sampleCount !== undefined) {
    if (sampleCount < sampleMinimum) {
      issues.push(`labeled_sample_count ${sampleCount} is below policy minimum ${sampleMinimum}`);
    }
  }

  if (status === 'passed') {
    if (threshold !== undefined && score !== undefined && score < threshold) {
      issues.push(`agreement_score ${score} is below blocking threshold ${threshold}`);
    }
  }

  if (status === 'below-threshold') {
    if (threshold !== undefined && score !== undefined && score >= threshold) {
      issues.push(`below-threshold result has agreement_score ${score} at or above ${threshold}`);
    }
  }

  if (isStaleByPolicy && status !== 'stale') {
    issues.push(
      `calibration age ${ageDays} days exceeds stale_after_days ${staleAfterDays}; status must be stale`,
    );
  }

  if (
    status === 'stale' &&
    staleAfterDays !== undefined &&
    ageDays !== undefined &&
    !calibratedAfterProduced &&
    ageDays <= staleAfterDays
  ) {
    issues.push(
      `stale calibration status requires age > stale_after_days ${staleAfterDays}, got ${formatDays(ageDays)} days`,
    );
  }

  if (calibratedAfterProduced) {
    issues.push('calibration.calibrated_at must not be after produced_at');
  }

  if (effect === 'blocking') {
    if (status !== 'passed') {
      issues.push(`blocking effect requires passed calibration, got ${status ?? '<missing>'}`);
    }
    if (sampleMinimum !== undefined && sampleCount !== undefined && sampleCount < sampleMinimum) {
      issues.push(
        `blocking effect requires at least ${sampleMinimum} labeled samples, got ${sampleCount}`,
      );
    }
    if (threshold !== undefined && score !== undefined && score < threshold) {
      issues.push(`blocking effect requires agreement_score >= ${threshold}, got ${score}`);
    }
    if (isStaleByPolicy) {
      issues.push(
        `blocking effect requires calibration age <= ${staleAfterDays} days, got ${ageDays} days`,
      );
    }
  }

  return issues;
}

function validateJudgeResultRunId(
  result: JsonObject,
  runResult: JsonObject | undefined,
): readonly string[] {
  if (runResult === undefined) {
    return [];
  }
  const resultRunId = getString(result, 'run_id');
  const expectedRunId = getString(runResult, 'run_id');
  if (resultRunId === expectedRunId) {
    return [];
  }
  return [
    `run_id ${resultRunId ?? '<missing>'} does not match run result ${expectedRunId ?? '<missing>'}`,
  ];
}

function validateExplicitJudgeResultLink(
  root: string,
  artifactPath: string,
  runResult: JsonObject | undefined,
): readonly string[] {
  if (runResult === undefined) {
    return [];
  }
  const expectedPath = relativePathFromRoot(
    root,
    resolveInsideRoot(root, artifactPath, 'judge result artifact'),
    'judge result artifact',
  );
  const linkedPaths = jsonObjects(getArray(runResult, 'judge_results')).map((link) =>
    relativePathFromRoot(
      root,
      resolveInsideRoot(
        root,
        requiredString(link, 'path', 'run result judge_results path'),
        'judge result link',
      ),
      'judge result link',
    ),
  );
  return linkedPaths.includes(expectedPath)
    ? []
    : [`judge result ${expectedPath} is not linked from run result judge_results`];
}

async function validateJudgePolicyDigest(
  root: string,
  policyPath: string,
  result: JsonObject,
): Promise<readonly string[]> {
  return validateJudgePolicyDigestValue(
    await digestFile(root, policyPath, 'Judge policy artifact'),
    result,
  );
}

function validateJudgePolicyDigestValue(
  actualDigest: string,
  result: JsonObject,
): readonly string[] {
  const expectedDigest = getString(result, 'policy_digest');
  if (expectedDigest === undefined) {
    return [];
  }
  if (expectedDigest === actualDigest) {
    return [];
  }
  return [`policy_digest ${expectedDigest} does not match ${actualDigest}`];
}

function validateJudgePolicyCalibrationExamples(policy: JsonObject): readonly string[] {
  const examples = jsonObjects(getArray(policy, 'calibration_examples'));
  if (examples.length === 0) {
    return [];
  }
  const calibration = getObject(policy, 'calibration') ?? {};
  const sampleMinimum = getNumber(calibration, 'labeled_sample_minimum');
  const threshold = getNumber(calibration, 'blocking_threshold');
  const metric = getString(calibration, 'agreement_metric');
  const issues: string[] = [];
  if (sampleMinimum !== undefined && examples.length < sampleMinimum) {
    issues.push(
      `calibration_examples count ${examples.length} is below policy minimum ${sampleMinimum}`,
    );
  }
  const score =
    metric === 'percent_agreement'
      ? percentAgreement(examples)
      : metric === 'cohen_kappa'
        ? cohenKappa(examples)
        : undefined;
  if (score === undefined) {
    issues.push(`agreement_metric ${metric ?? '<missing>'} cannot be computed from examples`);
  } else if (threshold !== undefined && score < threshold) {
    issues.push(`calibration_examples ${metric} ${score} is below blocking threshold ${threshold}`);
  }
  return issues;
}

function validateJudgeResultCalibrationExamples(result: JsonObject): readonly string[] {
  const calibration = getObject(result, 'calibration') ?? {};
  const examples = jsonObjects(getArray(calibration, 'examples'));
  if (examples.length === 0) {
    return [];
  }
  const issues: string[] = [];
  const sampleCount = getNumber(calibration, 'labeled_sample_count');
  if (sampleCount !== undefined && examples.length !== sampleCount) {
    issues.push(
      `calibration examples count ${examples.length} does not match labeled_sample_count ${sampleCount}`,
    );
  }
  const metric = getString(calibration, 'agreement_metric');
  const claimedScore = getNumber(calibration, 'agreement_score');
  const computedScore =
    metric === 'percent_agreement'
      ? percentAgreement(examples)
      : metric === 'cohen_kappa'
        ? cohenKappa(examples)
        : undefined;
  if (computedScore === undefined) {
    issues.push(
      `agreement_metric ${metric ?? '<missing>'} cannot be computed from result examples`,
    );
  } else if (claimedScore !== undefined && Math.abs(computedScore - claimedScore) > 1e-9) {
    issues.push(
      `agreement_score ${claimedScore} does not match calibration examples ${metric} ${computedScore}`,
    );
  }
  return issues;
}

function calibrationAgeDays(result: JsonObject, calibration: JsonObject): number | undefined {
  const producedAt = getTimestamp(result, 'produced_at');
  const calibratedAt = getTimestamp(calibration, 'calibrated_at');
  if (producedAt === undefined || calibratedAt === undefined) {
    return undefined;
  }
  return (producedAt - calibratedAt) / (24 * 60 * 60 * 1000);
}

function formatDays(days: number): string {
  return Number.isInteger(days)
    ? String(days)
    : days.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function getTimestamp(object: JsonObject, key: string): number | undefined {
  const value = getString(object, key);
  if (value === undefined) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function percentAgreement(examples: readonly JsonObject[]): number {
  let matches = 0;
  for (const example of examples) {
    const human = requiredString(example, 'human_label', 'calibration example human_label');
    const judge = requiredString(example, 'judge_label', 'calibration example judge_label');
    if (human === judge) {
      matches += 1;
    }
  }
  return matches / examples.length;
}

function cohenKappa(examples: readonly JsonObject[]): number {
  const labels = new Set<string>();
  const humanCounts = new Map<string, number>();
  const judgeCounts = new Map<string, number>();
  let matches = 0;
  for (const example of examples) {
    const human = requiredString(example, 'human_label', 'calibration example human_label');
    const judge = requiredString(example, 'judge_label', 'calibration example judge_label');
    labels.add(human);
    labels.add(judge);
    humanCounts.set(human, (humanCounts.get(human) ?? 0) + 1);
    judgeCounts.set(judge, (judgeCounts.get(judge) ?? 0) + 1);
    if (human === judge) {
      matches += 1;
    }
  }
  const observed = matches / examples.length;
  const expected = [...labels].reduce((sum, label) => {
    return (
      sum +
      ((humanCounts.get(label) ?? 0) / examples.length) *
        ((judgeCounts.get(label) ?? 0) / examples.length)
    );
  }, 0);
  return expected === 1 ? observed : (observed - expected) / (1 - expected);
}

function jsonObjects(values: ReturnType<typeof getArray>): JsonObject[] {
  return (values ?? []).filter(isObject);
}

function requiredString(object: JsonObject, key: string, description: string): string {
  const value = getString(object, key);
  if (value === undefined) {
    throw new CliError(`${description} is missing.`, ExitCode.validationError);
  }
  return value;
}

async function digestFile(root: string, path: string, description: string): Promise<string> {
  const absolutePath = resolveInsideRoot(root, path, description);
  await assertNoSymlinkWithinRoot(root, absolutePath, 'read');
  const bytes = await readFile(absolutePath);
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function getNumber(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
