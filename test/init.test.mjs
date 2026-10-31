import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeHome, readData, cli } from './helpers.mjs';

function homeWithSettings(allow = []) {
  const home = makeHome({ registry: { version: 1, owner: null, policy: { maxWip: 2, branchPrefix: 'claude/', autoMerge: false, newReposPrivate: true }, projects: [] } });
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow, deny: ['Bash(gh repo delete:*)'] } }));
  return home;
}
const settingsOf = (home) => JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));

test('init sets the owner, registers this repo as "self" and allows its PR calls', async () => {
  const home = homeWithSettings(['Bash(npm test)']);
  const r = await cli(home, ['init', '--owner', 'acme', '--repo', 'acme/app']);
  assert.equal(r.code, 0, r.err);
  const reg = readData(home, 'registry');
  assert.equal(reg.owner, 'acme');
  assert.deepEqual(reg.projects.map((p) => [p.id, p.repo, p.authorized, p.visibility]), [['self', 'acme/app', true, 'private']]);
  const s = settingsOf(home);
  assert.deepEqual(s.permissions.allow, ['Bash(npm test)', 'Bash(gh api repos/acme/app/pulls *)']);
  assert.deepEqual(s.permissions.deny, ['Bash(gh repo delete:*)'], 'deny rules are left alone');
});

test('init is idempotent and replaces the previous repo rule', async () => {
  const home = homeWithSettings();
  await cli(home, ['init', '--owner', 'acme', '--repo', 'acme/app']);
  await cli(home, ['init', '--owner', 'acme', '--repo', 'acme/other', '--visibility', 'public']);
  const reg = readData(home, 'registry');
  assert.equal(reg.projects.length, 1);
  assert.equal(reg.projects[0].repo, 'acme/other');
  assert.equal(reg.projects[0].visibility, 'public');
  assert.deepEqual(settingsOf(home).permissions.allow, ['Bash(gh api repos/acme/other/pulls *)']);
});

test('init rejects bad input and changes nothing', async () => {
  const home = homeWithSettings();
  for (const argv of [
    ['init', '--repo', 'acme/app'],
    ['init', '--owner', 'acme'],
    ['init', '--owner', 'acme', '--repo', 'other/app'],
    ['init', '--owner', 'ac me', '--repo', 'ac me/app'],
    ['init', '--owner', 'acme', '--repo', 'acme/app', '--visibility', 'internal'],
    ['init', '--owner', 'acme', '--repo', 'acme/../x'],
  ]) {
    const r = await cli(home, argv);
    assert.equal(r.code, 1, argv.join(' '));
  }
  assert.equal(readData(home, 'registry').owner, null);
  assert.deepEqual(settingsOf(home).permissions.allow, []);
});
