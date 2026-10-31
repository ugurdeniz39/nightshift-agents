import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../lib/tasks.mjs';
import { NOW, baseRegistry, task } from './helpers.mjs';

const reg = baseRegistry();
const minutes = (n) => new Date(NOW.getTime() + n * 60_000);

test('addTask assigns sequential ids per project prefix and requires acceptance criteria', () => {
  const b0 = { version: 1, tasks: [task('A-001'), task('A-004')] };
  const { backlog, task: t } = T.addTask(b0, reg, { project: 'alpha', title: ' New thing ', acceptance: ['done'] }, NOW);
  assert.equal(t.id, 'A-005');
  assert.equal(t.title, 'New thing');
  assert.equal(backlog.tasks.length, 3);
  assert.throws(() => T.addTask(b0, reg, { project: 'alpha', title: 'x', acceptance: [] }, NOW), /at least one --accept criterion/);
});

test('addTask rejects unknown, unauthorized projects and unknown deps', () => {
  const b0 = { version: 1, tasks: [] };
  assert.throws(() => T.addTask(b0, reg, { project: 'nope', title: 'x', acceptance: ['a'] }, NOW), /unknown project/);
  assert.throws(() => T.addTask(b0, reg, { project: 'beta', title: 'x', acceptance: ['a'] }, NOW), /not authorized/);
  assert.throws(() => T.addTask(b0, reg, { project: 'alpha', title: 'x', acceptance: ['a'], deps: ['A-009'] }, NOW), /unknown task/);
});

test('claim sets a lease and branch; same owner renews, other owner is refused until expiry', () => {
  const b0 = { version: 1, tasks: [task('A-001', { title: 'Fix the Login Bug!' })] };
  const b1 = T.claim(b0, reg, 'A-001', 'run-1', NOW, 60);
  const t1 = b1.tasks[0];
  assert.equal(t1.status, 'claimed');
  assert.equal(t1.claim.leaseUntil, minutes(60).toISOString());
  assert.equal(t1.branch, 'claude/a-001-fix-the-login-bug');
  assert.throws(() => T.claim(b1, reg, 'A-001', 'run-2', minutes(30)), /claimed by run-1/);
  assert.equal(T.claim(b1, reg, 'A-001', 'run-1', minutes(30), 60).tasks[0].claim.leaseUntil, minutes(90).toISOString());
  assert.equal(T.claim(b1, reg, 'A-001', 'run-2', minutes(61)).tasks[0].claim.by, 'run-2');
});

test('claim enforces WIP limit, dependencies and project authorization', () => {
  const tasks = [task('A-001'), task('A-002'), task('A-003'), task('A-004', { deps: ['A-001'] }), task('B-001', { project: 'beta' })];
  let b = { version: 1, tasks };
  b = T.claim(b, reg, 'A-001', 'r1', NOW);
  b = T.claim(b, reg, 'A-002', 'r2', NOW);
  assert.throws(() => T.claim(b, reg, 'A-003', 'r3', NOW), /WIP limit/);
  assert.throws(() => T.claim(b, reg, 'A-004', 'r3', NOW), /dependencies/);
  assert.throws(() => T.claim(b, reg, 'B-001', 'r3', NOW), /not authorized/);
});

test('an expired claim no longer counts toward WIP and is offered again', () => {
  const stale = task('A-001', { status: 'claimed', claim: { by: 'old', at: NOW.toISOString(), leaseUntil: minutes(-5).toISOString() } });
  const b = { version: 1, tasks: [stale] };
  assert.equal(T.activeClaims(b, NOW).length, 0);
  assert.equal(T.nextReady(b, reg, { now: NOW }).task.id, 'A-001');
});

test('nextReady orders by priority then id, honours deps, project filter and excludeIds', () => {
  const b = { version: 1, tasks: [
    task('A-003', { priority: 2 }), task('A-001', { priority: 3 }), task('A-002', { priority: 2, deps: ['A-001'] }),
  ] };
  assert.equal(T.nextReady(b, reg, { now: NOW }).task.id, 'A-003');
  assert.equal(T.nextReady(b, reg, { now: NOW, excludeIds: new Set(['A-003']) }).task.id, 'A-001');
  assert.equal(T.nextReady(b, reg, { now: NOW, project: 'beta' }).task, null);
  const done = { version: 1, tasks: [task('A-001', { status: 'done' }), task('A-002', { deps: ['A-001'] })] };
  assert.equal(T.nextReady(done, reg, { now: NOW }).task.id, 'A-002');
});

test('nextReady reports WIP exhaustion', () => {
  const live = (id) => task(id, { status: 'claimed', claim: { by: id, at: NOW.toISOString(), leaseUntil: minutes(30).toISOString() } });
  const b = { version: 1, tasks: [live('A-001'), live('A-002'), task('A-003')] };
  const r = T.nextReady(b, reg, { now: NOW });
  assert.equal(r.task, null);
  assert.match(r.reason, /WIP limit/);
});

test('submit requires a claim and non-empty evidence, then complete requires in_review', () => {
  const claimed = T.claim({ version: 1, tasks: [task('A-001')] }, reg, 'A-001', 'r1', NOW);
  assert.throws(() => T.submit(claimed, 'A-001', { pr: 'u', evidence: '   ' }, NOW), /evidence is required/);
  assert.throws(() => T.submit({ version: 1, tasks: [task('A-001')] }, 'A-001', { evidence: 'x' }, NOW), /only a claimed task/);
  const review = T.submit(claimed, 'A-001', { pr: 'https://example/pr/1', evidence: 'npm test: 12 pass' }, NOW);
  const t = review.tasks[0];
  assert.equal(t.status, 'in_review');
  assert.equal(t.claim, null);
  assert.equal(t.evidence[0].text, 'npm test: 12 pass');
  assert.throws(() => T.complete(claimed, 'A-001', NOW), /only an in_review/);
  assert.equal(T.complete(review, 'A-001', NOW).tasks[0].status, 'done');
});

test('release and block', () => {
  const claimed = T.claim({ version: 1, tasks: [task('A-001')] }, reg, 'A-001', 'r1', NOW);
  assert.equal(T.release(claimed, 'A-001').tasks[0].status, 'ready');
  assert.throws(() => T.release({ version: 1, tasks: [task('A-001')] }, 'A-001'), /not claimed/);
  assert.throws(() => T.block(claimed, 'A-001', ''), /--reason/);
  const blocked = T.block(claimed, 'A-001', 'needs API key').tasks[0];
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.blocker, 'needs API key');
});

test('branchFor cuts long titles at a word boundary', () => {
  const t = task('F-001', { title: 'factory report: truthful daily delivery report' });
  assert.equal(T.branchFor(reg, t), 'claude/f-001-factory-report-truthful-daily-delivery');
  assert.equal(T.branchFor(reg, task('F-002', { title: 'Short one' })), 'claude/f-002-short-one');
});

test('remoteClaimedIds matches claude/<id> and claude/<id>-slug but not other ids', () => {
  const b = { version: 1, tasks: [task('A-001'), task('A-010'), task('A-002')] };
  const ids = T.remoteClaimedIds(reg, b, ['claude/a-001-something', 'claude/a-010', 'main', 'feature/a-002']);
  assert.deepEqual([...ids].sort(), ['A-001', 'A-010']);
});
