#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Exit code 2 blocks the call and feeds stderr back to Claude.
import { readFileSync } from 'node:fs';
import { check } from '../../lib/guard.mjs';

// The merge-gate owner: the launching environment wins (agents cannot change it), the registry is the fallback.
function registryOwner() {
  try {
    return JSON.parse(readFileSync(new URL('../../factory/registry.json', import.meta.url), 'utf8')).owner ?? undefined;
  } catch {
    return undefined;
  }
}

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let command = '';
try {
  command = JSON.parse(raw)?.tool_input?.command ?? '';
} catch {
  process.exit(0); // unparsable hook input must never wedge the session
}

let reason;
try {
  reason = check(command, { env: process.env, owner: process.env.FACTORY_MERGE_OWNER ?? registryOwner() });
} catch (e) {
  reason = `guard error (${e.message}); blocked to be safe`; // an internal error must not let the command through
}
if (reason) {
  process.stderr.write(`factory guard: blocked. ${reason}.\n`);
  process.exit(2);
}
