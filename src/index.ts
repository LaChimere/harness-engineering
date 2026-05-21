#!/usr/bin/env node
import process from 'node:process';

import { runCli } from './cli.ts';

const exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout(message) {
    process.stdout.write(`${message}\n`);
  },
  stderr(message) {
    process.stderr.write(`${message}\n`);
  },
});

process.exitCode = exitCode;
