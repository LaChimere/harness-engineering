import { expect, test } from 'bun:test';

import { loadDocument } from '../../src/lib/files.ts';
import { getArray, getObject, getString, isObject, type JsonValue } from '../../src/lib/json.ts';

test('GitHub Actions CI recipe stays CLI-first and evidence-backed', async () => {
  const workflow = await loadDocument('examples/ci/github-actions.yml');
  if (!isObject(workflow)) {
    throw new Error('CI workflow fixture must be an object.');
  }

  expect(Object.keys(getObject(workflow, 'on') ?? {}).sort()).toEqual([
    'pull_request',
    'workflow_dispatch',
  ]);
  expect(getObject(workflow, 'permissions')).toEqual({ contents: 'read' });

  const jobs = getObject(workflow, 'jobs') ?? {};
  const harness = getObject(jobs, 'harness') ?? {};
  const steps = (getArray(harness, 'steps') ?? []).filter(isObject);
  const commands = steps
    .map((step) => getString(step, 'run'))
    .filter((command): command is string => command !== undefined);

  for (const expected of [
    'node dist/index.js validate --file examples/harness.yaml',
    'node dist/index.js doctor --file examples/harness.yaml --format json --output .harness/doctor/ci-doctor.json',
    'node dist/index.js health --file examples/harness.yaml --accept-unsandboxed-execution --format json --output .harness/health/ci-health.json',
    'node dist/index.js gc audit --file examples/harness.yaml --format json --output .harness/gc/ci-gc.json',
    'node dist/index.js eval validate --file examples/harness.yaml --output .harness/verifier-results/ci-eval-validate.jsonl',
    'node dist/index.js trace validate --file examples/harness.yaml --format json > .harness/reports/ci-trace-validation.json',
  ]) {
    expect(commands).toContain(expected);
  }

  expect(commands.some((command) => command.includes('runner readiness'))).toBe(false);
  expect(commands.some((command) => command.includes('eval run'))).toBe(false);
  expect(commands.some((command) => command.includes('profile run'))).toBe(false);
  expect(
    commands.some((command) => command.includes('repair') || command.includes('cleanup')),
  ).toBe(false);
  expect(commands.some((command) => command.includes('secret'))).toBe(false);

  const allowedActions = new Set([
    'actions/checkout@v4',
    'oven-sh/setup-bun@v2',
    'actions/upload-artifact@v4',
  ]);
  for (const step of steps) {
    const uses = getString(step, 'uses');
    if (uses !== undefined) {
      expect(allowedActions.has(uses)).toBe(true);
    }
    expect(stringifyJson(getObject(step, 'env') ?? {}).includes('secrets.')).toBe(false);
    expect(stringifyJson(getObject(step, 'with') ?? {}).includes('secrets.')).toBe(false);
    expect(stringifyJson(step).includes('pull_request_target')).toBe(false);
  }

  const uploadStep = steps.find((step) => getString(step, 'uses') === 'actions/upload-artifact@v4');
  expect(uploadStep).toBeDefined();
  const withBlock = getObject(uploadStep ?? {}, 'with') ?? {};
  expect(getString(withBlock, 'path')).toBe('.harness/**');
});

function stringifyJson(value: JsonValue): string {
  return JSON.stringify(value);
}
