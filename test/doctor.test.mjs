import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeHome, cli, task } from './helpers.mjs';

const lines = (out) => out.split('\n');
const levelOf = (out, name) => lines(out).find((l) => l.includes(name))?.slice(0, 4).trim();

test('healthy data: every line PASS and exit 0', async () => {
  const home = makeHome({ tasks: [task('A-001', { status: 'done' }), task('A-002', { deps: ['A-001'] })] });
  const r = await cli(home, ['doctor']);
  assert.equal(r.code, 0);
  assert.ok(lines(r.out).every((l) => l.startsWith('PASS')), r.out);
});

test('duplicate ids, unknown project, missing dep, bad status and missing acceptance each FAIL with exit 1', async () => {
  const home = makeHome({
    tasks: [
      task('A-001'),
      task('A-001'),
      task('A-002', { project: 'nope' }),
      task('A-003', { deps: ['A-999'] }),
      task('A-004', { status: 'weird' }),
      task('A-005', { acceptance: [] }),
    ],
  });
  const r = await cli(home, ['doctor']);
  assert.equal(r.code, 1);
  assert.equal(levelOf(r.out, 'task ids unique'), 'FAIL');
  assert.equal(levelOf(r.out, 'project exists'), 'FAIL');
  assert.equal(levelOf(r.out, 'every dep exists'), 'FAIL');
  assert.equal(levelOf(r.out, 'statuses valid'), 'FAIL');
  assert.equal(levelOf(r.out, 'acceptance criteria'), 'FAIL');
  assert.match(r.out, /A-005/);
});

test('expired lease is a WARN and still exits 0', async () => {
  const claim = { by: 'x', at: '2026-11-02T01:00:00.000Z', leaseUntil: '2026-11-02T02:00:00.000Z' };
  const home = makeHome({ tasks: [task('A-001', { status: 'claimed', claim })] });
  const r = await cli(home, ['doctor']);
  assert.equal(r.code, 0);
  assert.equal(levelOf(r.out, 'claim leases'), 'WARN');
  assert.match(r.out, /A-001/);
});

test('active lease does not warn', async () => {
  const claim = { by: 'x', at: '2026-11-02T09:00:00.000Z', leaseUntil: '2026-11-02T11:00:00.000Z' };
  const home = makeHome({ tasks: [task('A-001', { status: 'claimed', claim })] });
  const r = await cli(home, ['doctor']);
  assert.equal(levelOf(r.out, 'claim leases'), 'PASS');
});

test('unparseable data file FAILs that file and exits 1', async () => {
  const home = makeHome({ tasks: [task('A-001')] });
  writeFileSync(join(home, 'factory', 'state.json'), '{ not json');
  const r = await cli(home, ['doctor']);
  assert.equal(r.code, 1);
  assert.equal(levelOf(r.out, 'state.json parses'), 'FAIL');
  assert.equal(levelOf(r.out, 'registry.json parses'), 'PASS');
});

test('missing backlog does not crash and exits 1', async () => {
  const home = makeHome();
  writeFileSync(join(home, 'factory', 'backlog.json'), '');
  const r = await cli(home, ['doctor']);
  assert.equal(r.code, 1);
  assert.equal(levelOf(r.out, 'backlog.json parses'), 'FAIL');
});
