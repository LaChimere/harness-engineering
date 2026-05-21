export const ExitCode = {
  ok: 0,
  validationError: 1,
  usageError: 2,
  notFound: 3,
  incompatibleEngines: 4,
  internalError: 70,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export const exitCodeDescriptions: ReadonlyArray<{
  code: ExitCode;
  name: string;
  meaning: string;
}> = [
  {
    code: ExitCode.ok,
    name: 'ok',
    meaning: 'The command completed successfully.',
  },
  {
    code: ExitCode.validationError,
    name: 'validation-error',
    meaning:
      'Input was found, but schema validation, doctor status, or explicit verification status failed.',
  },
  {
    code: ExitCode.usageError,
    name: 'usage-error',
    meaning: 'The command line arguments are invalid or required arguments are missing.',
  },
  {
    code: ExitCode.notFound,
    name: 'not-found',
    meaning: 'A required input file or directory does not exist.',
  },
  {
    code: ExitCode.incompatibleEngines,
    name: 'incompatible-engines',
    meaning: 'The harness declares CLI or schema engine ranges that this CLI cannot satisfy.',
  },
  {
    code: ExitCode.internalError,
    name: 'internal-error',
    meaning: 'The CLI hit an unexpected internal failure.',
  },
];
