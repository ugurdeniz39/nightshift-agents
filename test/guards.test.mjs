import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../lib/guard.mjs';
import { blockedFile, scanText, scanDiff } from '../lib/secrets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('guard blocks the actions the owner reserved for approval', () => {
  const blocked = [
    'git push --force origin claude/f-001-x',
    'git push -f',
    'git push origin +claude/f-001-x',
    'git push origin main',
    'git push origin HEAD:master',
    'git push origin claude/f-001-x:main',
    'git push origin claude/f-001-x:refs/heads/main',
    'git push origin HEAD:refs/heads/main',
    'git push origin HEAD',
    'git push',
    'git push origin',
    'git push upstream claude/f-001-x',
    'git push https://example.com/x.git claude/f-001-x',
    'git push --all origin',
    'git push --tags origin',
    'git push -uf origin claude/f-001-x',
    'git push origin claude/ok claude/ok2:main',
    'echo hi && git push origin main',
    'bash -c "git push origin main"',
    'git commit --no-verify -m x',
    'git commit -n -m x',
    'gh api -XPUT repos/me/x/pulls/12/merge',
    'gh api repos/me/x/contents/a.txt -X PUT -f message=m',
    'gh api repos/me/x -X PATCH -f visibility=public',
    'gh api repos/me/x/merges -f base=main -f head=claude/x',
    'gh api graphql -f query=mutation',
    'git push origin --delete claude/old',
    'git push origin :claude/old',
    'gh pr merge 12 --squash',
    'gh api -X PUT repos/me/x/pulls/12/merge',
    'gh api repos/me/x/git/refs/heads/claude/old --method DELETE',
    'gh repo delete me/x --yes',
    'gh repo create foo --public',
    'gh repo edit me/x --visibility public',
    'vercel --prod',
    'vercel deploy --prod',
    'npm publish',
    'git reset --hard HEAD~1',
    'git clean -fd',
    'rm -rf ~',
    'claude --dangerously-skip-permissions -p hi',
    // wrapped / nested / quoted / separator tricks (F-004)
    '/usr/bin/git push origin main',
    'env GIT_X=1 git push origin main',
    'sudo git push origin main',
    'sudo -u root git push origin claude/f-001-x',
    '(git push origin main)',
    '{ git push origin main; }',
    'true & git push origin main',
    'echo $(git push origin main)',
    'echo `git push origin main`',
    "bash -c 'git push origin claude/x:main'",
    'sh -c "git push -f origin claude/x"',
    'eval "git push origin :claude/old"',
    'git push "origin" "claude/x:main"',
    'git --no-pager push origin main',
    'git -c push.default=current push origin main',
    'git push origin claude/x --force',
    'git push origin claude/x --force-with-lease=claude/x',
    'git push origin claude/x -d',
    'gh api repos/me/x/merges -fbase=main -fhead=claude/x',
    'gh api "repos/me/x/pulls/3/merge" -X "PUT"',
    'gh api repos/me/x/pulls -X"DELETE"',
    'gh api repos/me/x/pulls repos/me/y/contents -f a=b',
    'gh api --frobnicate repos/me/x/pulls',
    'xargs gh api repos/me/x/merges -f base=main',
    // bundled short flags and long-option abbreviations
    'git commit -anm "fix things"',
    'git commit -nm x',
    'git commit -am x -n',
    'git commit --no-veri -m x',
    'git commit --no-verif -m x',
    'git commit --message -- --no-verify',
    'git commit -m -- -n',
    'git commit --mess x --no-veri',
    'git commit -m "--no-verify"',
    'git --work-tree . commit -n',
    'git --git-dir .git commit -n -m x',
    'git -P commit --no-veri -m x',
    'git --no-pager commit -an -m x',
    'git push --del origin claude/x',
    'git push --forc origin claude/x',
    'git push --force-with origin claude/x',
    'git push --mir origin',
    'git push --tag origin',
    'git push --follow origin claude/x',
    'git push --frobnicate origin claude/x',
    'git push -o ci.skip origin claude/x',
    // case-insensitive file systems, aliases/config, quotes and substitutions (F-004 round 2)
    'GIT push origin main',
    '/USR/BIN/GIT push origin main',
    'Git push -f origin claude/f-001-x',
    'git -c alias.p="push origin main" p',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git config alias.pu "push --force"',
    'git config remote.origin.url https://example.com/x.git',
    'git config core.hooksPath /tmp/hooks',
    'git push origin "claude/x',
    'git push origin claude/ok ";" main',
    'gh api -X PATCH repos/me/x/issues/12/comments/5 -f body=edited',
    'gh api repos/me/x/issues/12/comments/5 -X DELETE',
    'gh api repos/me/x/issues -f title=spam',
    'echo "$(git push upstream claude/x)"',
    'echo "`git push origin :claude/old`"',
    // F-004 round 3: heredocs that are code, obfuscation, nested substitutions, config injection
    "bash <<'EOF'\ngit push origin main\nEOF",
    'sh <<EOF\ngit push -f origin claude/x\nEOF',
    "node <<'EOF'\nconsole.log(1)\nEOF",
    "cat <<'EOF' | bash\ngit push upstream claude/x\nEOF",
    "cat <<EOF | sh -s\ngit config alias.p push\nEOF",
    "cat <<'EOF' | python3\nprint(1)\nEOF",
    "cat <<'EOF' | xargs -I{} sh -c {}\ngit push upstream claude/x\nEOF",
    'g"i"t push origin main',
    "$'git' push origin main",
    'g=git; $g push origin main',
    'echo $(echo $(git push upstream claude/x))',
    'echo "$(git push upstream claude/x"',
    'sh -c "echo \\"; git push upstream claude/x"',
    'git --config-env=alias.p=PUSHCMD p',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=x git p',
    'GIT_SSH_COMMAND=x git push origin claude/x',
    'git config include.path /tmp/evil',
    'git config core.fsmonitor /tmp/evil',
    'git config core.pager "sh -c evil"',
    'git git commit -m "mentions git push origin main in prose"',
  ];
  for (const c of blocked) assert.ok(check(c, { env: {} }), `should block: ${c}`);
});

test('guard allows the normal delivery flow', () => {
  const allowed = [
    'git push -u origin claude/f-001-factory-report',
    'git push origin claude/f-002-doctor',
    'git push origin claude/f-002-a claude/f-003-b',
    'git push origin HEAD:claude/f-002-doctor',
    'git -C /tmp/x push -u origin claude/f-001-x',
    'GIT_TERMINAL_PROMPT=0 git push -u origin claude/f-001-x',
    'git commit -m "docs: explain the guard"',
    'gh api repos/me/x/pulls/3 --jq .state',
    'gh api -X GET repos/me/x/actions/runs',
    'git checkout -b claude/f-003-reap',
    'gh pr create --title "x" --body "y"',
    'gh pr view 3 --json state',
    'gh api repos/me/x/pulls -f title=t -f head=claude/f-001-x -f base=main -f body=b --jq .html_url',
    'gh api "repos/me/x/pulls?head=me:claude/f-001-x&state=open"',
    'gh repo create my-app --private --source . --push',
    'npm test',
    'rm -rf node_modules',
    'git log --oneline',
    // quoting and look-alike words must not cause false positives
    'git push origin "claude/f-009-x"',
    'git log --grep push',
    'git commit -m "explain git push rules"',
    'gh api repos/me/x/pulls -fbase=main -ftitle=t -fhead=claude/f-001-x',
    'gh api --paginate repos/me/x/pulls?state=open --jq ".[].number"',
    // normal flows must survive the stricter parser: config we need, heredoc commit/PR bodies with quotes
    'git config core.hooksPath scripts/hooks',
    'git config --get remote.origin.url',
    'git -c user.name=x -c user.email=y commit -m z',
    "git commit -F - <<'EOF'\nfix: don't break \"quoted\" things; it's fine\n\nCo-Authored-By: x\nEOF",
    'git commit -m "$(cat <<\'EOF\'\nmessage with \'single\' and "double" quotes; it is fine\nEOF\n)"',
    'gh api repos/me/x/pulls -f title=t -F body=@/tmp/body.md --jq .html_url',
    'gh api repos/me/x/issues/12/comments -F body=@/tmp/comment.md --jq .html_url',
    // legitimate commit and push forms that must survive the stricter parsing
    'git commit -am "fix: n things and no verify talk"',
    'git commit --no-edit',
    'git commit --verbose -m x',
    'git commit --amend --no-edit',
    'git log --grep commit',
    'git show HEAD~1 --stat',
    'git -P commit -m x',
    'git --git-dir .git --work-tree . commit -m x',
    'git -P push -u origin claude/f-001-x',
    'git push --set-upstream origin claude/f-001-x',
    'git push -uq origin claude/f-001-x',
    'git push --dry-run origin claude/f-001-x',
  ];
  for (const c of allowed) assert.equal(check(c, { env: {} }), null, `should allow: ${c}`);
});

test('guard hook script exits 2 on a blocked command, 0 otherwise, 0 on garbage input', () => {
  const run = (input) => spawnSync('node', [join(root, 'scripts/hooks/guard-bash.mjs')], { input, encoding: 'utf8' });
  const bad = run(JSON.stringify({ tool_input: { command: 'git push --force' } }));
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /force-push/);
  assert.equal(run(JSON.stringify({ tool_input: { command: 'npm test' } })).status, 0);
  assert.equal(run('not json').status, 0);
});

// Fake credentials are assembled at runtime so this file itself never contains a matching literal.
const fake = {
  aws: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  gh: ['ghp', '_', 'a'.repeat(36)].join(''),
  anthropic: ['sk-ant', '-', 'api03-', 'x'.repeat(30)].join(''),
  pem: ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join(''),
};

test('scanText flags known credential shapes without echoing them', () => {
  assert.deepEqual(scanText(`key = ${fake.aws}`).map((f) => f.pattern), ['aws-access-key']);
  assert.deepEqual(scanText(fake.gh).map((f) => f.pattern), ['github-token']);
  assert.deepEqual(scanText(fake.anthropic).map((f) => f.pattern), ['anthropic-key']);
  assert.deepEqual(scanText(fake.pem).map((f) => f.pattern), ['private-key-block']);
  assert.equal(scanText(`const password = "${'x'.repeat(24)}"`)[0].pattern, 'hardcoded-credential');
  assert.deepEqual(scanText('const answer = 42; // nothing secret here'), []);
  assert.deepEqual(scanText(`${fake.aws} // factory:allow-secret`), []);
});

test('blockedFile rejects env files and key material but allows .env.example', () => {
  for (const f of ['.env', 'app/.env.local', 'certs/server.pem', 'release.keystore', 'id_rsa']) assert.ok(blockedFile(f), f);
  for (const f of ['.env.example', 'src/environment.ts', 'README.md']) assert.equal(blockedFile(f), false, f);
});

test('scanDiff only inspects added lines and reports the file', () => {
  const diff = [
    'diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -1 +1 @@', `-old = ${fake.aws}`, `+new = ${fake.aws}`,
    'diff --git a/src/b.js b/src/b.js', '--- a/src/b.js', '+++ b/src/b.js', '@@ -0,0 +1 @@', '+ok = 1',
  ].join('\n');
  assert.deepEqual(scanDiff(diff), [{ file: 'src/a.js', pattern: 'aws-access-key' }]);
});

test('scanDiff still scans an added line whose content starts with ++ (it looks like a +++ header)', () => {
  const diff = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -0,0 +1,2 @@', `+++ ${fake.gh}`, '+fine'].join('\n');
  assert.deepEqual(scanDiff(diff), [{ file: 'x', pattern: 'github-token' }]);
});

test('pre-commit hook blocks a staged secret in a real throwaway repo and passes a clean one', () => {
  const repo = mkdtempSync(join(tmpdir(), 'factory-hook-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'core.hooksPath', join(root, 'scripts/hooks'));
  writeFileSync(join(repo, 'ok.txt'), 'hello\n');
  git('add', 'ok.txt');
  git('commit', '-q', '-m', 'clean commit');
  writeFileSync(join(repo, 'leak.txt'), `token ${fake.gh}\n`);
  git('add', 'leak.txt');
  const r = spawnSync('git', ['commit', '-q', '-m', 'leak'], { cwd: repo, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /secret-scan: commit blocked/);
  assert.match(r.stderr, /github-token/);
  assert.ok(!r.stderr.includes(fake.gh), 'the secret itself must never be printed');
});
