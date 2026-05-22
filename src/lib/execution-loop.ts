import { posix } from 'node:path';

import {
  getArray,
  getObject,
  getString,
  isObject,
  type JsonObject,
  type JsonValue,
} from './json.ts';

export type ExecutionLoopPhase = 'start' | 'complete';

export interface ExecutionLoopValidationInput {
  readonly phase: ExecutionLoopPhase;
  readonly harness: JsonObject;
  readonly continuity: JsonObject;
  readonly startupVerification?: JsonObject;
  readonly completionVerification?: JsonObject;
  readonly completionVerificationPath?: string;
}

export interface ExecutionLoopValidationSummary {
  readonly phase: ExecutionLoopPhase;
  readonly startupVerificationRef?: string;
  readonly completionVerificationPath?: string;
}

export interface ExecutionLoopValidationResult {
  readonly errors: readonly string[];
  readonly summary: ExecutionLoopValidationSummary;
}

const completionAcceptanceChecks = new Map([
  ['original-spec-reread', 'completion evidence must record that the original spec was reread'],
  [
    'acceptance-criteria-compared',
    'completion evidence must record acceptance-criteria comparison',
  ],
  [
    'approval-policy-followed-or-escalated',
    'completion evidence must record that approval policy decisions were followed or escalated',
  ],
  [
    'sandbox-policy-followed-or-escalated',
    'completion evidence must record that sandbox policy decisions were followed or escalated',
  ],
  [
    'startup-verification-recorded',
    'completion evidence must record the startup verification continuity update',
  ],
  ['handoff-artifact-ready', 'completion evidence must record handoff artifact readiness'],
]);

export function isExecutionLoopPhase(value: string): value is ExecutionLoopPhase {
  return value === 'start' || value === 'complete';
}

export function executionLoopError(code: string, message: string): string {
  return `[${code}] ${message}`;
}

export function validateExecutionLoopContract(
  input: ExecutionLoopValidationInput,
): ExecutionLoopValidationResult {
  const errors: string[] = [];
  const startup = getObject(input.continuity, 'startup_verification');
  const startupVerificationRef =
    startup === undefined ? undefined : getString(startup, 'self_verification_ref');

  validateStartupGate(input.harness, input.continuity, input.startupVerification, errors);

  if (input.phase === 'complete') {
    validateCompletionGate(input, errors);
  }

  return {
    errors,
    summary: {
      phase: input.phase,
      ...(startupVerificationRef === undefined ? {} : { startupVerificationRef }),
      ...(input.completionVerificationPath === undefined
        ? {}
        : { completionVerificationPath: input.completionVerificationPath }),
    },
  };
}

function validateStartupGate(
  harness: JsonObject,
  continuity: JsonObject,
  startupVerification: JsonObject | undefined,
  errors: string[],
): void {
  const harnessContinuity = getObject(harness, 'continuity');
  const expectedCommand = getObject(harnessContinuity ?? {}, 'startup_smoke_test');
  const startup = getObject(continuity, 'startup_verification');
  if (startup === undefined) {
    errors.push(
      executionLoopError(
        'LOOP_STARTUP_MISSING',
        'continuity state must include startup_verification',
      ),
    );
    return;
  }

  const status = getString(startup, 'status');
  if (status !== 'passed') {
    errors.push(
      executionLoopError(
        'LOOP_STARTUP_NOT_PASSED',
        `startup_verification.status must be passed before work starts, got ${status ?? 'missing'}`,
      ),
    );
  }

  const startupCommand = getObject(startup, 'command');
  if (startupCommand === undefined) {
    errors.push(
      executionLoopError('LOOP_STARTUP_COMMAND_MISSING', 'startup verification command is missing'),
    );
  } else if (expectedCommand !== undefined) {
    compareStartupCommand(startupCommand, expectedCommand, errors);
  }

  const evidence = evidencePaths(startup, 'evidence');
  if (evidence.length === 0) {
    errors.push(
      executionLoopError(
        'LOOP_STARTUP_EVIDENCE_MISSING',
        'startup verification must record at least one evidence link in continuity state',
      ),
    );
  }

  const startupVerificationRef = getString(startup, 'self_verification_ref');
  if (startupVerificationRef === undefined) {
    errors.push(
      executionLoopError(
        'LOOP_STARTUP_SELF_VERIFICATION_MISSING',
        'startup verification must link explicit self-verification evidence',
      ),
    );
  }

  if (startupVerification !== undefined) {
    for (const error of validateSelfVerificationEvidence(startupVerification, {
      label: 'startup self-verification',
      requireCompletionAcceptanceChecks: false,
      requireCommandKinds: [],
      requireEvidence: true,
    })) {
      errors.push(error);
    }
    if (
      startupCommand !== undefined &&
      !selfVerificationRunsCommand(startupVerification, startupCommand)
    ) {
      errors.push(
        executionLoopError(
          'LOOP_STARTUP_COMMAND_NOT_RUN',
          'startup self-verification must include a passed check for the recorded startup command',
        ),
      );
    }
  }

  if (startupVerificationRef !== undefined) {
    validateStartupProgressOrder(continuity, startupVerificationRef, evidence, errors);
  }
}

function compareStartupCommand(
  actualCommand: JsonObject,
  expectedCommand: JsonObject,
  errors: string[],
): void {
  const actual = getString(actualCommand, 'command');
  const expected = getString(expectedCommand, 'command');
  if (!commandsHaveSameTokens(actual, expected)) {
    errors.push(
      executionLoopError(
        'LOOP_STARTUP_COMMAND_MISMATCH',
        `startup verification command ${actual ?? 'missing'} must match harness continuity startup_smoke_test ${expected ?? 'missing'}`,
      ),
    );
  }

  const actualTimeout = getNumber(actualCommand, 'timeout_seconds');
  const expectedTimeout = getNumber(expectedCommand, 'timeout_seconds');
  if (
    actualTimeout !== undefined &&
    expectedTimeout !== undefined &&
    actualTimeout !== expectedTimeout
  ) {
    errors.push(
      executionLoopError(
        'LOOP_STARTUP_TIMEOUT_MISMATCH',
        `startup verification timeout ${actualTimeout} must match harness continuity startup_smoke_test timeout ${expectedTimeout}`,
      ),
    );
  }
}

function validateStartupProgressOrder(
  continuity: JsonObject,
  startupVerificationRef: string,
  startupEvidencePaths: readonly string[],
  errors: string[],
): void {
  const startupRefs = new Set(
    [startupVerificationRef, ...startupEvidencePaths].map(normalizeArtifactPath),
  );
  const progressLog = jsonObjects(getArray(continuity, 'progress_log') ?? []);
  const startupEvents = progressLog.filter((entry) =>
    evidencePaths(entry, 'refs').some((path) => startupRefs.has(normalizeArtifactPath(path))),
  );
  if (startupEvents.length === 0) {
    errors.push(
      executionLoopError(
        'LOOP_STARTUP_PROGRESS_MISSING',
        'progress_log must record the startup verification before work begins',
      ),
    );
    return;
  }

  const startupTime = Math.min(...startupEvents.map((entry) => timestampMillis(entry)));
  if (Number.isNaN(startupTime)) {
    errors.push(
      executionLoopError(
        'LOOP_STARTUP_TIMESTAMP_INVALID',
        'startup verification progress event has invalid or missing timestamp',
      ),
    );
    return;
  }
  for (const entry of progressLog) {
    const entryTime = timestampMillis(entry);
    if (Number.isNaN(entryTime)) {
      errors.push(
        executionLoopError(
          'LOOP_PROGRESS_TIMESTAMP_INVALID',
          'progress_log entry has invalid or missing timestamp',
        ),
      );
      return;
    }
    if (entryTime < startupTime) {
      errors.push(
        executionLoopError(
          'LOOP_STARTUP_PROGRESS_ORDER',
          'startup verification must be the earliest recorded progress event',
        ),
      );
      return;
    }
  }
}

function validateCompletionGate(input: ExecutionLoopValidationInput, errors: string[]): void {
  if (input.completionVerification === undefined) {
    errors.push(
      executionLoopError(
        'LOOP_COMPLETION_VERIFICATION_MISSING',
        'complete phase requires explicit self-verification evidence',
      ),
    );
  } else {
    for (const error of validateSelfVerificationEvidence(input.completionVerification, {
      label: 'completion self-verification',
      requireCompletionAcceptanceChecks: true,
      requireCommandKinds: ['validate', 'doctor'],
      requireEvidence: true,
    })) {
      errors.push(error);
    }
    validatePolicyEvidence(input.harness, input.completionVerification, errors);
  }

  const handoffArtifacts = evidencePaths(input.continuity, 'handoff_artifacts');
  if (handoffArtifacts.length === 0) {
    errors.push(
      executionLoopError(
        'LOOP_HANDOFF_MISSING',
        'complete phase requires at least one handoff artifact in continuity state',
      ),
    );
  }

  if (input.completionVerificationPath !== undefined) {
    const expectedPath = normalizeArtifactPath(input.completionVerificationPath);
    const linked = jsonObjects(getArray(input.continuity, 'progress_log') ?? []).some((entry) =>
      evidencePaths(entry, 'refs').some((path) => normalizeArtifactPath(path) === expectedPath),
    );
    if (!linked) {
      errors.push(
        executionLoopError(
          'LOOP_COMPLETION_PROGRESS_MISSING',
          'progress_log must link the completion self-verification evidence before completion can be claimed',
        ),
      );
    }
  }
}

function validateSelfVerificationEvidence(
  evidence: JsonObject,
  options: {
    readonly label: string;
    readonly requireCompletionAcceptanceChecks: boolean;
    readonly requireCommandKinds: readonly string[];
    readonly requireEvidence: boolean;
  },
): readonly string[] {
  const errors: string[] = [];
  const specReread = getObject(evidence, 'spec_reread');
  if (getString(specReread ?? {}, 'status') !== 'matched') {
    errors.push(
      executionLoopError(
        'LOOP_SPEC_REREAD_NOT_MATCHED',
        `${options.label} must record spec_reread.status matched`,
      ),
    );
  }

  const acceptanceChecks = jsonObjects(getArray(evidence, 'acceptance_checks') ?? []);
  if (acceptanceChecks.length === 0) {
    errors.push(
      executionLoopError(
        'LOOP_ACCEPTANCE_CHECKS_MISSING',
        `${options.label} must include acceptance checks`,
      ),
    );
  }
  for (const check of acceptanceChecks) {
    const status = getString(check, 'status');
    if (status !== 'passed') {
      errors.push(
        executionLoopError(
          'LOOP_ACCEPTANCE_CHECK_NOT_PASSED',
          `${options.label} acceptance check ${getString(check, 'id') ?? '<unknown>'} must be passed, got ${status ?? 'missing'}`,
        ),
      );
    }
  }

  if (options.requireCompletionAcceptanceChecks) {
    for (const [id, message] of completionAcceptanceChecks) {
      const check = acceptanceChecks.find((candidate) => getString(candidate, 'id') === id);
      if (check === undefined) {
        errors.push(executionLoopError('LOOP_COMPLETION_ACCEPTANCE_MISSING', message));
      } else if (getString(check, 'status') !== 'passed') {
        errors.push(
          executionLoopError(
            'LOOP_COMPLETION_ACCEPTANCE_NOT_PASSED',
            `${message}, got ${getString(check, 'status') ?? 'missing'}`,
          ),
        );
      }
    }
  }

  const checksRun = jsonObjects(getArray(evidence, 'checks_run') ?? []);
  if (checksRun.length === 0) {
    errors.push(
      executionLoopError('LOOP_CHECKS_RUN_MISSING', `${options.label} must record checks_run`),
    );
  }
  for (const check of checksRun) {
    const status = getString(check, 'status');
    if (status !== 'passed') {
      errors.push(
        executionLoopError(
          'LOOP_CHECK_NOT_PASSED',
          `${options.label} check ${commandText(getObject(check, 'command'))} must be passed, got ${status ?? 'missing'}`,
        ),
      );
    }
  }
  for (const kind of options.requireCommandKinds) {
    if (
      !checksRun.some((check) => commandRunsHarnessSubcommand(getObject(check, 'command'), kind))
    ) {
      errors.push(
        executionLoopError(
          'LOOP_REQUIRED_CHECK_MISSING',
          `${options.label} must include a passed harness ${kind} check`,
        ),
      );
    }
  }

  if (options.requireEvidence) {
    if (evidencePaths(evidence, 'artifacts').length === 0) {
      errors.push(
        executionLoopError('LOOP_ARTIFACTS_MISSING', `${options.label} must link output artifacts`),
      );
    }
    if (evidencePaths(evidence, 'evidence_links').length === 0) {
      errors.push(
        executionLoopError('LOOP_EVIDENCE_LINKS_MISSING', `${options.label} must link evidence`),
      );
    }
  }

  return errors;
}

function selfVerificationRunsCommand(
  verification: JsonObject,
  expectedCommand: JsonObject,
): boolean {
  const expected = getString(expectedCommand, 'command');
  if (expected === undefined) {
    return false;
  }
  return jsonObjects(getArray(verification, 'checks_run') ?? []).some((check) => {
    const command = getObject(check, 'command');
    return (
      getString(check, 'status') === 'passed' &&
      commandStartsWithRecordedCommand(commandText(command), expected)
    );
  });
}

function commandRunsHarnessSubcommand(
  command: JsonObject | undefined,
  subcommand: string,
): boolean {
  const tokens = safeCommandTokens(commandText(command));
  return allowedHarnessCommandPrefixes(subcommand).some((prefix) =>
    startsWithTokens(tokens, prefix),
  );
}

function commandText(command: JsonObject | undefined): string {
  return command === undefined ? '' : (getString(command, 'command') ?? '');
}

function commandsHaveSameTokens(left: string | undefined, right: string | undefined): boolean {
  const leftTokens = safeCommandTokens(left ?? '');
  const rightTokens = safeCommandTokens(right ?? '');
  return (
    leftTokens.length > 0 &&
    leftTokens.length === rightTokens.length &&
    startsWithTokens(leftTokens, rightTokens)
  );
}

function commandStartsWithRecordedCommand(command: string, recordedCommand: string): boolean {
  const commandTokens = safeCommandTokens(command);
  const recordedTokens = safeCommandTokens(recordedCommand);
  return recordedTokens.length > 0 && startsWithTokens(commandTokens, recordedTokens);
}

function validatePolicyEvidence(
  harness: JsonObject,
  completionVerification: JsonObject,
  errors: string[],
): void {
  const linkedEvidence = new Set(
    evidencePaths(completionVerification, 'evidence_links').map(normalizeArtifactPath),
  );
  for (const [field, label] of [
    ['approval_policy', 'approval policy'],
    ['sandbox', 'sandbox policy'],
  ] as const) {
    const path = getString(harness, field);
    if (path !== undefined && !linkedEvidence.has(normalizeArtifactPath(path))) {
      errors.push(
        executionLoopError(
          'LOOP_POLICY_EVIDENCE_MISSING',
          `completion self-verification must link the ${label} artifact ${path}`,
        ),
      );
    }
  }
}

function safeCommandTokens(command: string): readonly string[] {
  const trimmed = command.trim();
  if (trimmed.length === 0 || /[\n\r;&|`$<>]/.test(trimmed)) {
    return [];
  }
  return trimmed.split(/\s+/);
}

function allowedHarnessCommandPrefixes(subcommand: string): readonly (readonly string[])[] {
  return [
    ['harness', subcommand],
    ['./node_modules/.bin/harness', subcommand],
    ['npx', 'harness', subcommand],
    ['node', 'dist/index.js', subcommand],
    ['node', './dist/index.js', subcommand],
  ];
}

function startsWithTokens(tokens: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((token, index) => tokens[index] === token);
}

function evidencePaths(object: JsonObject, key: string): readonly string[] {
  return jsonObjects(getArray(object, key) ?? [])
    .map((link) => getString(link, 'path'))
    .filter((path): path is string => path !== undefined);
}

function jsonObjects(values: readonly JsonValue[]): readonly JsonObject[] {
  return values.filter(isObject);
}

function getNumber(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === 'number' ? value : undefined;
}

function normalizeArtifactPath(path: string): string {
  const [withoutFragment] = path.split('#', 1);
  const localPath = withoutFragment ?? '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(localPath)) {
    return localPath;
  }
  const normalized = posix.normalize(localPath);
  return normalized === '.' ? '' : normalized;
}

function timestampMillis(entry: JsonObject): number {
  const timestamp = getString(entry, 'timestamp');
  return timestamp === undefined ? Number.NaN : Date.parse(timestamp);
}
