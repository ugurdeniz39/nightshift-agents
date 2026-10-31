import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8'));
const { allow = [], deny = [] } = settings.permissions ?? {};

// Permission deny rules win over hooks, so a deny on `gh pr merge` would make the guard's owner-session
// merge gate impossible to open (found on 2026-10-31).
test('settings do not deny gh pr merge: the guard gate decides', () => {
  assert.equal(deny.some((d) => /^Bash\(gh pr merge/.test(d)), false);
});

test('settings keep the irreversible operations denied', () => {
  for (const rule of ['Bash(git push --force:*)', 'Bash(git push -f:*)', 'Bash(gh repo delete:*)']) {
    assert.ok(deny.includes(rule), `missing deny rule ${rule}`);
  }
});

test('settings never auto-allow a broad gh api rule', () => {
  assert.equal(allow.some((a) => /^Bash\(gh api(\s+repos\/?)?(:\*|\s\*)?\)$/.test(a)), false);
  assert.equal(allow.some((a) => a.startsWith('Bash(gh api repos/:')), false);
});

test('the guard hook is wired to Bash', () => {
  const pre = settings.hooks?.PreToolUse ?? [];
  assert.ok(pre.some((h) => h.matcher === 'Bash' && h.hooks?.some((x) => x.command.includes('guard-bash.mjs'))));
});
