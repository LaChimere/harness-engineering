import type { ExitCode } from './exit-codes.ts';

export class CliError extends Error {
  override name = 'CliError';

  constructor(
    message: string,
    readonly exitCode: ExitCode,
  ) {
    super(message);
  }
}
