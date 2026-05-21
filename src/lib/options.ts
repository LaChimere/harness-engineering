import { CliError } from './errors.ts';
import { ExitCode } from './exit-codes.ts';

export interface ParsedOptions {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
  readonly positionals: readonly string[];
}

export function parseOptions(
  args: readonly string[],
  valueOptions: ReadonlySet<string>,
  flagOptions: ReadonlySet<string>,
): ParsedOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === '--') {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = splitOption(arg);
    if (flagOptions.has(rawName)) {
      if (inlineValue !== undefined) {
        throw new CliError(`Option --${rawName} does not take a value.`, ExitCode.usageError);
      }
      flags.add(rawName);
      continue;
    }
    if (valueOptions.has(rawName)) {
      if (inlineValue !== undefined) {
        values.set(rawName, inlineValue);
        continue;
      }
      const next = args[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new CliError(`Option --${rawName} requires a value.`, ExitCode.usageError);
      }
      values.set(rawName, next);
      index += 1;
      continue;
    }

    throw new CliError(`Unknown option --${rawName}.`, ExitCode.usageError);
  }

  return { values, flags, positionals };
}

export function optionValue(options: ParsedOptions, name: string): string | undefined {
  return options.values.get(name);
}

export function hasFlag(options: ParsedOptions, name: string): boolean {
  return options.flags.has(name);
}

function splitOption(arg: string): [string, string | undefined] {
  const withoutPrefix = arg.slice(2);
  const equalsIndex = withoutPrefix.indexOf('=');
  if (equalsIndex === -1) {
    return [withoutPrefix, undefined];
  }
  return [withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1)];
}
