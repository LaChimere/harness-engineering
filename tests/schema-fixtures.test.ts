import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { loadDocument } from '../src/lib/files.ts';
import { getArray, getString, isObject } from '../src/lib/json.ts';
import { loadSchemaRegistry } from '../src/lib/schema-registry.ts';

interface Manifest {
  readonly invalid: readonly InvalidFixture[];
  readonly custom_invalid?: readonly CustomInvalidFixture[];
  readonly failure_taxonomy_required_codes: readonly string[];
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
  readonly expected_missing_code: string;
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

test('failure taxonomy fixture coverage checks exact starter-code drift', async () => {
  const manifest = await loadManifest();
  const requiredCodes = new Set(manifest.failure_taxonomy_required_codes);
  const canonicalMissing = missingTaxonomyCodes(
    requiredCodes,
    await loadDocument('examples/failure-taxonomy.yaml'),
  );
  expect(canonicalMissing).toEqual([]);

  for (const fixture of manifest.custom_invalid ?? []) {
    expect(fixture.check).toBe('failure_taxonomy_required_codes');
    const missing = missingTaxonomyCodes(requiredCodes, await loadDocument(fixture.path));
    expect(missing).toEqual([fixture.expected_missing_code]);
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
