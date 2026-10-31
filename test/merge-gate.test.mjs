import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check } from '../lib/guard.mjs';

const closed = { env: {} };
const open = { env: { FACTORY_ALLOW_MERGE: '1' }, owner: 'acme' };

const MERGES = [
  'gh pr merge 12 --repo acme/x --squash',
  'gh pr merge 12 --repo=acme/x --squash',
  'gh pr merge 12 -s -R acme/x',
  'gh pr merge 12 -sRacme/x',
  'gh api -X PUT repos/acme/x/pulls/12/merge -f merge_method=squash',
  'for n in 1 3 2; do gh pr merge $n --repo acme/x --squash || break; done',
];

test('merging is blocked by default, including forms with flags between pr and merge', () => {
  for (const c of [...MERGES, 'gh pr -R me/x merge 12', 'gh pr merge 12 --squash --admin', 'gh pr "merge" 12 --squash']) {
    assert.ok(check(c, closed), `closed gate should block: ${c}`);
  }
});

test('an owner session (FACTORY_ALLOW_MERGE=1 in the hook environment) may merge plainly', () => {
  for (const c of MERGES) assert.equal(check(c, open), null, `open gate should allow: ${c}`);
});

test('the open gate unlocks nothing else and still polices merge flags', () => {
  const stillBlocked = [
    'gh pr merge 12 --squash',
    'gh pr merge 12 -s',
    'gh pr merge 12 -s -Rother/x',
    'gh pr merge 12 -sRother/x',
    'gh pr merge 12 --squash --repo=other/x',
    'GH_REPO=other/x gh pr merge 12 --squash --repo acme/x',
    'GH_TOKEN=x gh pr merge 12 --squash --repo acme/x',
    'gh pr merge 12 --squash --admin --repo acme/x',
    'gh pr merge 12 --adm"in" --squash --repo acme/x',
    'gh pr "merge" 12 --admin',
    'gh pr merge 12',
    'gh pr merge 12 --merge',
    'gh pr merge 12 --repo other/x --squash',
    'gh pr merge 12 --squash -R other/x',
    'gh api -X PUT repos/other/x/pulls/12/merge -f merge_method=squash',
    'gh api -X PUT repos/acme/x/pulls/12/merge',
    'gh api -X PUT repos/acme/x/pulls/12/merge -f merge_method=merge',
    'gh api -X PUT repos/acme/x/pulls/12/merge --input /tmp/body.json',
    'gh pr merge 12 --delete-branch',
    'gh pr merge 12 -sd',
    'gh pr merge 12 --auto --squash',
    'gh pr -R me/x merge 12',
    'xargs -n1 gh pr merge --squash',
    'bash -c "gh pr merge 12 --admin"',
    'git push origin main',
    'git push -f origin claude/f-001-x',
    'gh repo delete me/x --yes',
    'gh api -X DELETE repos/me/x/git/refs/heads/claude/x',
    'gh api -X PUT repos/me/x/contents/a.txt -f message=m',
    'gh api -X PUT repos/me/x/pulls/12/update-branch',
    'vercel --prod',
  ];
  for (const c of stillBlocked) assert.ok(check(c, open), `open gate should still block: ${c}`);
});

test('the gate cannot be opened from the command text and only the exact value 1 opens it', () => {
  for (const c of ['FACTORY_ALLOW_MERGE=1 gh pr merge 12 --squash', 'export FACTORY_ALLOW_MERGE=1; gh pr merge 12', 'env FACTORY_ALLOW_MERGE=1 gh pr merge 12']) {
    assert.ok(check(c, closed), `text must not open the gate: ${c}`);
  }
  for (const value of ['true', 'yes', '0', '', '1 ', 'on']) {
    assert.ok(check('gh pr merge 12 --squash', { env: { FACTORY_ALLOW_MERGE: value } }), `value ${JSON.stringify(value)} must not open the gate`);
  }
});

test('shell keywords in front of a command do not hide it from the parsers', () => {
  for (const c of ['for b in a b; do git push origin main; done', 'if true; then git push -f origin claude/x; fi', 'while true; do git push origin HEAD; done']) {
    assert.ok(check(c, closed), `should block: ${c}`);
  }
  assert.equal(check('for b in claude/f-1-a claude/f-2-b; do git push origin $b; done', closed) === null, false, 'a variable ref is not a literal claude/* branch');
  assert.equal(check('for n in 1 2; do git push origin claude/f-001-x; done', closed), null);
});

test('look-alike text is not mistaken for a merge', () => {
  for (const c of ['gh pr create --title "merge the guard" --body x', 'gh pr view 3 --json mergeStateStatus', 'git merge origin/main --no-edit', 'gh pr list --search "merge"']) {
    assert.equal(check(c, closed), null, c);
  }
});

test('the real hook script honours the gate from its own environment, not from the command', () => {
  const hook = fileURLToPath(new URL('../scripts/hooks/guard-bash.mjs', import.meta.url));
  const run = (command, env) => spawnSync('node', [hook], {
    input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
  });
  assert.equal(run('gh pr merge 12 --squash', {}).status, 2);
  assert.equal(run('gh pr merge 12 --squash --repo acme/x', { FACTORY_ALLOW_MERGE: '1', FACTORY_MERGE_OWNER: 'acme' }).status, 0);
  assert.equal(run('FACTORY_ALLOW_MERGE=1 gh pr merge 12 --squash --repo acme/x', {}).status, 2);
  assert.equal(run('gh pr merge 12 --admin --repo acme/x', { FACTORY_ALLOW_MERGE: '1', FACTORY_MERGE_OWNER: 'acme' }).status, 2);
  assert.equal(run('gh pr merge 12 --squash', { FACTORY_ALLOW_MERGE: '1', FACTORY_MERGE_OWNER: 'acme' }).status, 2, 'no explicit repo');
});

test('redirections are not arguments and quoted values with spaces stay one word (found by the first scheduled run)', () => {
  const allowed = [
    'git push -u origin claude/f-001-x 2>&1',
    'git push origin claude/f-001-x 2>&1 | tail -1',
    'git push origin claude/f-001-x 2>/dev/null',
    'git push origin claude/f-001-x > /tmp/out.txt 2>&1',
    'git push origin claude/f-001-x &> /tmp/out.txt',
    'gh api repos/acme/x/pulls -f title="feat: two words (F-002)" -f head="claude/f-002-x" -f base=main -F body=@/tmp/b.md --jq .html_url',
    "gh api repos/acme/x/pulls -f 'title=feat: two words' -f head=claude/f-002-x -f base=main",
    'gh api -X PATCH repos/acme/x/pulls/4 -f title="Real title (F-002)" -F body=@/tmp/b.md',
    'gh api "repos/acme/x/pulls?head=acme:claude/f-002-x&state=all" --jq ".[].html_url"; echo done',
  ];
  for (const c of allowed) assert.equal(check(c, closed), null, `should allow: ${c}`);
  const blocked = [
    'git push origin 2>&1 main',
    'git push origin claude/ok ">" main',
    "git push origin claude/ok '2>&1' main",
    'git push origin claude/x 2>&1 :main',
    'gh api -X PATCH repos/me/x/pulls/4 -f state=closed',
    'gh api -X PATCH repos/me/x/pulls/4 -f title=t -f base=main',
    'gh api -X PATCH repos/me/x/pulls/4 --input /tmp/x.json',
    'gh api -X PATCH repos/me/x/pulls/4',
    'gh api -X PATCH repos/me/x/issues/4 -f title=t',
  ];
  for (const c of blocked) assert.ok(check(c, closed), `should block: ${c}`);
});

test('the gate needs a valid owner: none or a malformed one keeps merges blocked', () => {
  const merge = 'gh pr merge 12 --squash --repo acme/x';
  assert.match(check(merge, { env: { FACTORY_ALLOW_MERGE: '1' }, owner: undefined }) ?? '', /no owner is configured/);
  assert.ok(check(merge, { env: { FACTORY_ALLOW_MERGE: '1' }, owner: 'acme/.*' }), 'regex-looking owner must not count');
  assert.ok(check('gh api -X PUT repos/acme/x/pulls/12/merge -f merge_method=squash', { env: { FACTORY_ALLOW_MERGE: '1' }, owner: '' }));
  assert.equal(check(merge, { env: { FACTORY_ALLOW_MERGE: '1', FACTORY_MERGE_OWNER: 'acme' } }), null, 'owner from the environment');
});
