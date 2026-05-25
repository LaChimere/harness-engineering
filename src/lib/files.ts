import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';

import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';
import type { JsonValue } from './json.ts';

export type PathKind = 'file' | 'directory';

export async function pathKind(path: string): Promise<PathKind | undefined> {
  try {
    const stats = await stat(path);
    if (stats.isFile()) {
      return 'file';
    }
    if (stats.isDirectory()) {
      return 'directory';
    }
    return undefined;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  return (await pathKind(path)) !== undefined;
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function ensureDirectoryInsideRoot(root: string, path: string): Promise<void> {
  await assertNoSymlinkWithinRoot(root, path);
  await ensureDirectory(path);
  await assertRealPathInsideRoot(root, path);
}

export async function copyFileNoFollowCreatingDirectories(
  root: string,
  from: string,
  to: string,
): Promise<void> {
  await writeFileNoFollowCreatingDirectories(root, to, await readFile(from));
}

export async function writeTextNoFollowCreatingDirectories(
  root: string,
  path: string,
  text: string,
): Promise<void> {
  await writeFileNoFollowCreatingDirectories(
    root,
    path,
    text,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
  );
}

export async function writeTextNoFollowNewFileCreatingDirectories(
  root: string,
  path: string,
  text: string,
): Promise<void> {
  await writeFileNoFollowCreatingDirectories(
    root,
    path,
    text,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
  );
}

export async function appendTextNoFollowCreatingDirectories(
  root: string,
  path: string,
  text: string,
): Promise<void> {
  await writeFileNoFollowCreatingDirectories(
    root,
    path,
    text,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
  );
}

async function writeFileNoFollowCreatingDirectories(
  root: string,
  path: string,
  data: string | Uint8Array,
  flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
): Promise<void> {
  await ensureDirectoryInsideRoot(root, dirname(path));
  await assertNoSymlinkWithinRoot(root, path);
  await assertRealPathInsideRoot(root, dirname(path));
  const file = await open(path, flags, 0o666);
  try {
    const stats = await file.stat();
    if (!stats.isFile()) {
      throw new CliError(`Refusing to write non-file target: ${path}`, ExitCode.usageError);
    }
    await assertRealPathInsideRoot(root, path);
    await file.writeFile(data);
  } finally {
    await file.close();
  }
}

export async function assertNoSymlinkWithinRoot(
  root: string,
  target: string,
  operation = 'write',
): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const relativeTarget = relative(resolvedRoot, resolvedTarget);
  if (relativeTarget === '') {
    return;
  }

  const segments = relativeTarget.split(sep).filter((segment) => segment.length > 0);
  let current = resolvedRoot;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new CliError(
          `Refusing to ${operation} through symlink: ${relative(resolvedRoot, current)}`,
          ExitCode.usageError,
        );
      }
    } catch (error) {
      if (isNotFound(error)) {
        continue;
      }
      throw error;
    }
  }
}

export async function loadDocument(path: string): Promise<JsonValue> {
  const text = await readFile(path, 'utf8');
  try {
    if (path.endsWith('.json')) {
      return JSON.parse(text) as JsonValue;
    }
    return parse(text) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not parse ${path}: ${message}`, ExitCode.validationError);
  }
}

export function dumpYaml(value: JsonValue): string {
  return stringify(value);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

async function assertRealPathInsideRoot(root: string, path: string): Promise<void> {
  const resolvedRoot = await realpath(root);
  const resolvedPath = await realpath(path);
  const relativePath = relative(resolvedRoot, resolvedPath);
  if (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  ) {
    return;
  }

  throw new CliError(`Resolved path escapes root: ${path}`, ExitCode.usageError);
}
