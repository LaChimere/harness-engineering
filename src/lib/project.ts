import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';
import { loadDocument, pathExists } from './files.ts';
import { getString, isObject } from './json.ts';

export async function packageRootFromImportMeta(importMetaUrl: string): Promise<string> {
  return findPackageRoot(dirname(fileURLToPath(importMetaUrl)));
}

export async function findPackageRoot(startDirectory: string): Promise<string> {
  let current = resolve(startDirectory);
  while (true) {
    if (
      (await pathExists(join(current, 'package.json'))) &&
      (await pathExists(join(current, 'schemas')))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new CliError(
        'Could not locate package root with package.json and schemas/.',
        ExitCode.internalError,
      );
    }
    current = parent;
  }
}

export async function readPackageVersion(packageRoot: string): Promise<string> {
  const packageJson = await loadDocument(join(packageRoot, 'package.json'));
  if (!isObject(packageJson)) {
    throw new CliError('package.json must contain a JSON object.', ExitCode.internalError);
  }
  const version = getString(packageJson, 'version');
  if (version === undefined) {
    throw new CliError('package.json is missing version.', ExitCode.internalError);
  }
  return version;
}

export async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}
