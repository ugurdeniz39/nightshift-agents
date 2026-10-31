import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeHome, readData, cli, task, NOW } from './helpers.mjs';

test('help lists commands; unknown command and unknown flag fail with exit 1', async () => {
  const home = makeHome();
  const help = await cli(home, ['help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /claim\s/);
  assert.match(help.out, /resume\s/);
  assert.equal((await cli(home, ['frobnicate'])).code, 1);
  const bad = await cli(home, ['list', '--nope']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /^error:/);
});

test('every read command exits 0 with --json and with plain output (no write() return value leaks into the exit code)', async () => {
  const home = makeHome({ tasks: [task('A-001')] });
  for (const argv of [['status', '--json'], ['list', '--json'], ['list'], ['next', '--json'], ['next'], ['resume', '--json'], ['resume']]) {
    const r = await cli(home, argv);
    assert.equal(r.code, 0, argv.join(' '));
    assert.ok(r.out.length > 0, argv.join(' '));
  }
  assert.equal(JSON.parse((await cli(home, ['next', '--json'])).out).task.id, 'A-001');
  const empty = makeHome();
  assert.equal((await cli(empty, ['list'])).code, 0);
  assert.equal((await cli(empty, ['next', '--json'])).code, 3);
});

test('the real bin/factory.mjs process exits with the right codes', () => {
  const home = makeHome({ tasks: [task('A-001')] });
  const env = { ...process.env, FACTORY_HOME: home };
  const bin = fileURLToPath(new URL('../bin/factory.mjs', import.meta.url));
  const run = (...args) => spawnSync('node', [bin, ...args], { env, encoding: 'utf8' });
  const ok = run('next', '--json');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).task.id, 'A-001');
  assert.equal(run('frobnicate').status, 1);
  assert.equal(run('claim', 'A-001', '--by', 'r1').status, 0);
  assert.equal(run('claim', 'A-001', '--by', 'r2').status, 1);
  assert.equal(run('next', '--json').status, 3);
});

test('status summarises projects, WIP and automation state', async () => {
  const home = makeHome({ tasks: [task('A-001'), task('A-002', { status: 'done' })] });
  const r = await cli(home, ['status']);
  assert.equal(r.code, 0);
  assert.match(r.out, /wip 0\/2/);
  assert.match(r.out, /alpha\s+active\s+private\s+ready 1/);
  assert.match(r.out, /scheduled runs: not-configured/);
  const j = JSON.parse((await cli(home, ['status', '--json'])).out);
  assert.equal(j.projects.length, 2);
});

test('add persists a task; add without acceptance fails and leaves the backlog untouched', async () => {
  const home = makeHome();
  const ok = await cli(home, ['add', 'Build', 'the', 'thing', '--project', 'alpha', '--accept', 'tests pass', '--priority', '1']);
  assert.equal(ok.code, 0);
  assert.equal(readData(home, 'backlog').tasks[0].title, 'Build the thing');
  assert.equal(readData(home, 'backlog').tasks[0].priority, 1);
  const bad = await cli(home, ['add', 'No criteria', '--project', 'alpha']);
  assert.equal(bad.code, 1);
  assert.equal(readData(home, 'backlog').tasks.length, 1);
});

test('claim persists a lease; a second owner is refused; release frees it', async () => {
  const home = makeHome({ tasks: [task('A-001')] });
  assert.equal((await cli(home, ['claim', 'A-001', '--by', 'run-1'])).code, 0);
  assert.equal(readData(home, 'backlog').tasks[0].claim.by, 'run-1');
  const clash = await cli(home, ['claim', 'A-001', '--by', 'run-2']);
  assert.equal(clash.code, 1);
  assert.match(clash.err, /claimed by run-1/);
  assert.equal((await cli(home, ['release', 'A-001'])).code, 0);
  assert.equal(readData(home, 'backlog').tasks[0].status, 'ready');
});

test('next --check-remote skips tasks that already have a claude/<id>-* branch (exit 3 when none left)', async () => {
  const home = makeHome({ tasks: [task('A-001')] });
  const lsRemote = () => ['claude/a-001-already-started'];
  const r = await cli(home, ['next', '--check-remote'], { lsRemote });
  assert.equal(r.code, 3);
  assert.match(r.out, /nothing to do/);
  assert.equal((await cli(home, ['next'])).code, 0);
});

test('next --check-remote fails closed when origin cannot be queried', async () => {
  const home = makeHome({ tasks: [task('A-001')] });
  const r = await cli(home, ['next', '--check-remote'], { lsRemote: () => { throw new Error('no network'); } });
  assert.equal(r.code, 1);
  assert.match(r.err, /refusing to pick a task/);
});

test('submit refuses empty evidence and accepts a real one; complete finishes it', async () => {
  const home = makeHome({ tasks: [task('A-001')] });
  await cli(home, ['claim', 'A-001', '--by', 'r1']);
  const no = await cli(home, ['submit', 'A-001', '--pr', 'https://x/1']);
  assert.equal(no.code, 1);
  assert.match(no.err, /evidence is required/);
  assert.equal((await cli(home, ['submit', 'A-001', '--pr', 'https://x/1', '--evidence', 'npm test: 3 pass'])).code, 0);
  assert.equal(readData(home, 'backlog').tasks[0].status, 'in_review');
  assert.equal((await cli(home, ['complete', 'A-001'])).code, 0);
  assert.equal(readData(home, 'backlog').tasks[0].completedAt, NOW.toISOString());
});

test('checkpoint + resume round-trip: state written by one call is read back by the next', async () => {
  const home = makeHome({ tasks: [task('A-001')] });
  assert.equal((await cli(home, ['checkpoint'])).code, 1);
  assert.equal((await cli(home, ['checkpoint', '--verified', 'npm test passed (12)', '--failed', 'emulator smoke', '--automation', 'configured'])).code, 0);
  assert.equal((await cli(home, ['checkpoint', '--automation', 'bogus'])).code, 1);
  const r = await cli(home, ['resume']);
  assert.match(r.out, /npm test passed \(12\)/);
  assert.match(r.out, /emulator smoke/);
  assert.match(r.out, /scheduled runs: configured/);
  assert.match(r.out, /A-001\s+Task A-001/);
});

test('project-add registers a private project and refuses public ones and duplicates', async () => {
  const home = makeHome();
  assert.equal((await cli(home, ['project-add', '--id', 'gamma', '--prefix', 'G', '--repo', 'tester/gamma'])).code, 0);
  const p = readData(home, 'registry').projects.find((x) => x.id === 'gamma');
  assert.equal(p.visibility, 'private');
  assert.equal(p.authorized, true);
  assert.equal((await cli(home, ['project-add', '--id', 'pub', '--prefix', 'P', '--repo', 't/p', '--visibility', 'public'])).code, 1);
  assert.equal((await cli(home, ['project-add', '--id', 'gamma', '--prefix', 'Q', '--repo', 't/g'])).code, 1);
});
