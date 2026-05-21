import { spawn } from 'node:child_process';
import process from 'node:process';

export interface ShellCommandInput {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutSeconds: number;
  readonly environment: Readonly<Record<string, string>>;
  readonly processLabel?: string;
}

export interface ShellCommandResult {
  readonly exitCode?: number;
  readonly signal?: string;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

const maxCapturedOutputLength = 16_384;

export async function runShellCommand(input: ShellCommandInput): Promise<ShellCommandResult> {
  return await new Promise((resolve) => {
    const label = input.processLabel ?? 'Child process';
    const pathEnvKey = 'PATH';
    const langEnvKey = 'LANG';
    const lcAllEnvKey = 'LC_ALL';
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let forceFinishTimer: ReturnType<typeof setTimeout> | undefined;
    const detached = process.platform !== 'win32';
    const child = spawn(input.command, {
      cwd: input.cwd,
      shell: process.platform === 'win32' ? true : '/bin/sh',
      detached,
      env: {
        ...input.environment,
        PATH: input.environment[pathEnvKey] ?? '/usr/bin:/bin',
        LANG: input.environment[langEnvKey] ?? 'C',
        LC_ALL: input.environment[lcAllEnvKey] ?? 'C',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      const terminateError = signalProcess(child.pid, detached, 'SIGTERM', label);
      if (terminateError !== undefined) {
        finish({ timedOut, stdout, stderr, error: terminateError });
        return;
      }
      killTimer = setTimeout(() => {
        const killError = signalProcess(child.pid, detached, 'SIGKILL', label);
        if (killError !== undefined) {
          finish({ timedOut, stdout, stderr, error: killError });
        }
      }, 1000);
      forceFinishTimer = setTimeout(() => {
        const killError = signalProcess(child.pid, detached, 'SIGKILL', label);
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish({
          timedOut,
          stdout,
          stderr,
          error: killError ?? `${label} did not exit after timeout.`,
        });
      }, 3000);
    }, input.timeoutSeconds * 1000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendCapturedOutput(stdout, chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendCapturedOutput(stderr, chunk.toString('utf8'));
    });

    child.on('error', (error) => {
      finish({ timedOut, stdout, stderr, error: error.message });
    });
    child.on('close', (code, signal) => {
      finish({
        ...(code === null ? {} : { exitCode: code }),
        ...(signal === null ? {} : { signal }),
        timedOut,
        stdout,
        stderr,
      });
    });

    function finish(result: ShellCommandResult): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      if (forceFinishTimer !== undefined) {
        clearTimeout(forceFinishTimer);
      }
      resolve(result);
    }
  });
}

function signalProcess(
  pid: number | undefined,
  detached: boolean,
  signal: NodeJS.Signals,
  label: string,
): string | undefined {
  if (pid === undefined) {
    return `${label} did not expose a process id for timeout termination.`;
  }
  try {
    if (detached) {
      process.kill(-pid, signal);
    } else {
      process.kill(pid, signal);
    }
    return undefined;
  } catch (error) {
    if (isNoSuchProcess(error)) {
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    return `Could not send ${signal} to ${label}: ${message}`;
  }
}

function isNoSuchProcess(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ESRCH'
  );
}

function appendCapturedOutput(current: string, next: string): string {
  const combined = `${current}${next}`;
  if (combined.length <= maxCapturedOutputLength) {
    return combined;
  }
  return combined.slice(0, maxCapturedOutputLength);
}
