#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { blockedFile, scanDiff } from '../../lib/secrets.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean);
const problems = [];

for (const f of staged) if (blockedFile(f)) problems.push(`${f}: file type must never be committed`);
for (const f of scanDiff(git('diff', '--cached', '-U0', '--no-color'))) problems.push(`${f.file}: looks like ${f.pattern}`);

if (problems.length) {
  const lines = [
    'secret-scan: commit blocked',
    ...problems.map((p) => `  - ${p}`),
    'If a match is a false positive, add "factory:allow-secret" to that line.',
  ];
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exit(1);
}
