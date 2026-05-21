import { isAbsolute, relative, resolve, sep } from 'node:path';

import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';

export function resolveRootForWriteCommand(cwd: string, root: string): string {
  return resolveInsideRoot(cwd, root, '--root');
}

export function resolveRootForInspectionCommand(cwd: string, root: string): string {
  return resolve(cwd, root);
}

export function resolveInsideRoot(root: string, path: string, description: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, path);
  const relativePath = relative(resolvedRoot, resolvedPath);

  if (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  ) {
    return resolvedPath;
  }

  throw new CliError(`${description} escapes root: ${path}`, ExitCode.usageError);
}

export function relativePathFromRoot(root: string, path: string, description: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolveInsideRoot(resolvedRoot, path, description);
  const relativePath = relative(resolvedRoot, resolvedPath);
  return relativePath === '' ? '.' : relativePath.split(sep).join('/');
}
