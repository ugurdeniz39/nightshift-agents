#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Exit code 2 blocks the call and feeds stderr back to Claude.
import { check } from '../../lib/guard.mjs';

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
  // The merge scope comes only from the launching environment (FACTORY_MERGE_OWNER), never from a repo file.
  reason = check(command, { env: process.env });
} catch (e) {
  reason = `guard error (${e.message}); blocked to be safe`; // an internal error must not let the command through
}
if (reason) {
  process.stderr.write(`factory guard: blocked. ${reason}.\n`);
  process.exit(2);
}
