import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

export interface IHookSafetyFinding {
  readonly path: string;
  readonly line: number;
  readonly ruleId: string;
  readonly message: string;
}

interface IHookRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly message: string;
  readonly extensions?: readonly string[];
  readonly scope?: 'line' | 'file';
}

interface IHookFile {
  readonly path: string;
  readonly symlink: boolean;
}

const executableHookExtensions = new Set(['.ts', '.js', '.mjs', '.cjs', '.sh', '.py']);
const filesystemWriteMessage = 'Hooks must not perform filesystem writes.';
const boundedCallContent = String.raw`[\s\S]{0,500}?`;
const writeModeArgument = String.raw`['"][^'"]*(?:[wax]|\+)[^'"]*['"]`;
const hookRules: readonly IHookRule[] = [
  {
    id: 'generated-output-path',
    pattern: /\.harness\/outputs\//,
    message: 'Hooks must not read or write generated evidence paths.',
  },
  {
    id: 'filesystem-write',
    pattern: new RegExp(
      String.raw`\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rename|renameSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|truncate|truncateSync|copyFile|copyFileSync|cp|cpSync|symlink|symlinkSync|link|linkSync|chmod|chmodSync|chown|chownSync|lchmod|lchmodSync|lchown|lchownSync|utimes|utimesSync|lutimes|lutimesSync|Bun\.write|Deno\.(?:writeFile|writeFileSync|writeTextFile|writeTextFileSync|remove|removeSync|rename|renameSync|mkdir|mkdirSync|makeTempFile|makeTempFileSync|makeTempDir|makeTempDirSync|copyFile|copyFileSync|create|createSync|truncate|truncateSync|symlink|symlinkSync|link|linkSync|chmod|chmodSync|chown|chownSync)|Deno\.(?:open|openSync)\(${boundedCallContent}(?:write|append|truncate)\s*:\s*true)\b`,
    ),
    message: filesystemWriteMessage,
    scope: 'file',
  },
  {
    id: 'filesystem-write',
    pattern: /\bfs(?:\.promises)?\.write(?:Sync)?\s*\(/,
    message: filesystemWriteMessage,
    scope: 'file',
  },
  {
    id: 'filesystem-write',
    pattern:
      /import\s+\{[^}]*\bwrite(?:Sync)?\b[^}]*\}\s+from\s+['"](?:node:)?fs(?:\/promises)?['"]|require\(['"](?:node:)?fs(?:\/promises)?['"]\)\.\s*write(?:Sync)?\s*\(/,
    message: filesystemWriteMessage,
    scope: 'file',
  },
  {
    id: 'filesystem-write',
    pattern:
      /\b(?:Path\([^)]*\)\.(?:write_text|write_bytes|touch|mkdir|rename|replace|symlink_to|hardlink_to|chmod|unlink|rmdir)|os\.(?:write|ftruncate|remove|unlink|makedirs|mkdir|rmdir|removedirs|rename|replace|symlink|link|chmod|chown|utime|truncate|mkfifo|mknod)|shutil\.(?:copyfile|copy|copy2|copytree|move|rmtree)|tempfile\.(?:NamedTemporaryFile|TemporaryFile|mkdtemp|mkstemp))\b|\.\s*(?:write_text|write_bytes|touch|mkdir|rename|replace|symlink_to|hardlink_to|chmod|unlink|rmdir)\s*\(/,
    message: filesystemWriteMessage,
    extensions: ['.py'],
    scope: 'file',
  },
  {
    id: 'filesystem-write',
    pattern: new RegExp(
      String.raw`\b(?:open|openSync)\(${boundedCallContent}(?:mode\s*=\s*${writeModeArgument}|flags\s*:\s*${writeModeArgument}|,\s*${writeModeArgument})`,
    ),
    message: filesystemWriteMessage,
    scope: 'file',
  },
  {
    id: 'filesystem-write',
    pattern: new RegExp(
      String.raw`(?:\.\s*open\(\s*${writeModeArgument}|\.\s*open\(${boundedCallContent}(?:mode\s*=\s*${writeModeArgument}|,\s*${writeModeArgument}))`,
    ),
    message: filesystemWriteMessage,
    extensions: ['.py'],
    scope: 'file',
  },
  {
    id: 'filesystem-write',
    pattern: new RegExp(
      String.raw`\bos\.open\(${boundedCallContent}(?:os\.)?O_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND)\b`,
    ),
    message: filesystemWriteMessage,
    extensions: ['.py'],
    scope: 'file',
  },
  {
    id: 'filesystem-write',
    pattern: new RegExp(
      String.raw`\bopen\(${boundedCallContent}(?:os\.)?O_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND)\b|from\s+os\s+import\b[^\n#]*\b(?:open|write|ftruncate)\b`,
    ),
    message: filesystemWriteMessage,
    extensions: ['.py'],
    scope: 'file',
  },
  {
    id: 'child-process',
    pattern:
      /\b(?:child_process|node:child_process|node:vm|Bun\.spawn|Deno\.Command|Deno\.run|subprocess|os\.system)\b|from\s+os\s+import\b[^\n#]*\bsystem\b|from\s+['"]vm['"]|require\(['"](?:node:)?vm['"]\)|\b(?:child_process|cp)\.(?:exec|execFile|spawn|spawnSync|fork)\b|\bBun\.\$|(?:^|[^\w.])eval\s*\(|\bnew\s+Function\b|(?:^|[^\w.])Function\s*\(|\bvm\.(?:runInNewContext|runInThisContext|runInContext|Script)\b/,
    message: 'Hooks must not execute child processes or dynamic code.',
  },
  {
    id: 'shell-write',
    pattern: /(?:^|\s)(?:\d?>|>>)\s*(?:[./\w-]|\$)|\btee\s+/,
    message: 'Hooks must not write through shell redirection or tee.',
    extensions: ['.sh'],
  },
  {
    id: 'network-command',
    pattern:
      /\b(?:curl|wget|fetch|http\.request|https\.request|http\.get|https\.get|http2\.connect|net\.connect|tls\.connect|requests\.|urllib\.request|node:https?|node:http2|node:net|node:tls)\b|from\s+requests\s+import\b|from\s+urllib\s+import\b[^\n#]*\brequest\b|from\s+['"](?:https?|http2|net|tls)['"]|require\(['"](?:node:)?(?:https?|http2|net|tls)['"]\)/,
    message: 'Hooks must not perform network calls.',
  },
];

export async function checkHookSafety(root = process.cwd()): Promise<IHookSafetyFinding[]> {
  const hookFiles = await findHookFiles(root);
  const findings: IHookSafetyFinding[] = [];
  for (const hookFile of hookFiles) {
    const { path } = hookFile;
    if (hookFile.symlink) {
      const isHookSymlink = isHookPath(path);
      findings.push({
        path,
        line: 1,
        ruleId: isHookSymlink ? 'hook-symlink' : 'plugin-symlink',
        message: isHookSymlink
          ? 'Executable hooks must be regular files, not symlinks.'
          : 'Plugin adapter entries must be regular directories or files, not symlinks.',
      });
      continue;
    }
    const text = await readFile(join(root, path), 'utf8');
    const extension = extname(path);
    for (const rule of hookRules) {
      if (rule.scope !== 'file' || !ruleAppliesToExtension(rule, extension)) {
        continue;
      }
      for (const match of findMatches(rule.pattern, text)) {
        findings.push({
          path,
          line: lineNumberAtOffset(text, match.index),
          ruleId: rule.id,
          message: rule.message,
        });
      }
    }
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      for (const rule of hookRules) {
        if (rule.scope === 'file' || !ruleAppliesToExtension(rule, extension)) {
          continue;
        }
        if (rule.pattern.test(line)) {
          findings.push({
            path,
            line: index + 1,
            ruleId: rule.id,
            message: rule.message,
          });
        }
      }
    }
  }
  return findings.sort((left, right) =>
    `${left.path}:${left.line}:${left.ruleId}`.localeCompare(
      `${right.path}:${right.line}:${right.ruleId}`,
    ),
  );
}

function ruleAppliesToExtension(rule: IHookRule, extension: string): boolean {
  return rule.extensions === undefined || rule.extensions.includes(extension);
}

function* findMatches(pattern: RegExp, text: string): Iterable<RegExpExecArray> {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null = globalPattern.exec(text);
  while (match !== null) {
    yield match;
    if (match[0].length === 0) {
      globalPattern.lastIndex += 1;
    }
    match = globalPattern.exec(text);
  }
}

function lineNumberAtOffset(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

async function findHookFiles(root: string): Promise<IHookFile[]> {
  const files: IHookFile[] = [];
  await walk(root, join(root, 'plugins'), files);
  return files.filter(
    (file) =>
      file.symlink || (isHookPath(file.path) && executableHookExtensions.has(extname(file.path))),
  );
}

function isHookPath(path: string): boolean {
  return path.endsWith('/hooks') || path.includes('/hooks/');
}

async function walk(root: string, path: string, files: IHookFile[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      files.push({ path: relative(root, child).replaceAll('\\', '/'), symlink: true });
    } else if (entry.isDirectory()) {
      await walk(root, child, files);
    } else if (entry.isFile()) {
      files.push({ path: relative(root, child).replaceAll('\\', '/'), symlink: false });
    }
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const findings = await checkHookSafety(root);
  if (findings.length > 0) {
    for (const item of findings) {
      console.error(`${item.path}:${item.line} ${item.ruleId}: ${item.message}`);
    }
    process.exit(1);
  }
}
