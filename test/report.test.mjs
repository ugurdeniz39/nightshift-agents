import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeHome, readData, cli, task, NOW } from './helpers.mjs';
import { scanText } from '../lib/secrets.mjs';

const DAY = '2026-11-02';
const FRESH = `${DAY}T09:00:00.000Z`;
const LEAK = ['ghp', 'x'.repeat(36)].join('_'); // built at runtime so this file never contains a literal token
const NOT_COUNTED_WHY = 'missing PR URL, evidence dated that day, or evidence reports failures';
const at = (iso) => ({ at: iso, text: `npm test: 12 pass, 0 fail (${iso})` });

// Body of one "## <title>" section of the markdown report.
function section(out, title) {
  const part = out.split(/^## /m).find((s) => s.startsWith(`${title}\n`));
  assert.ok(part, `missing section "${title}"`);
  return part;
}

// A delivered task: in_review/done, with a PR and evidence recorded at `evidenceAt`.
const delivered = (id, evidenceAt, extra = {}) => task(id, {
  status: 'in_review', pr: `https://example.test/pr/${id}`, evidence: [at(evidenceAt)], ...extra,
});

test('Shipped lists only tasks with evidence dated on the report day (default day = today, UTC)', async () => {
  const home = makeHome({
    tasks: [
      delivered('A-001', '2026-11-02T08:30:00.000Z'),
      delivered('A-002', '2026-11-01T23:59:59.999Z'),
      delivered('A-003', '2026-11-03T00:00:00.000Z'),
      delivered('A-004', '2026-11-02T09:00:00.000Z', { status: 'done' }),
    ],
  });
  const today = await cli(home, ['report']);
  assert.equal(today.code, 0);
  const shipped = section(today.out, 'Shipped');
  assert.match(shipped, /A-001/);
  assert.match(shipped, /A-004 .*done/);
  assert.doesNotMatch(shipped, /A-002|A-003/);
  assert.match(shipped, /PR: https:\/\/example\.test\/pr\/A-001/);
  assert.match(shipped, /Evidence \[2026-11-02T08:30:00\.000Z\]: npm test: 12 pass, 0 fail/);

  const yesterday = section((await cli(home, ['report', '--date', '2026-11-01'])).out, 'Shipped');
  assert.match(yesterday, /A-002/);
  assert.doesNotMatch(yesterday, /A-001|A-003|A-004/);
  assert.match((await cli(home, ['report', '--date', '2026-11-03'])).out, /# Factory delivery report - 2026-11-03/);
});

test('the default day is the UTC day of ctx.now(), not the local one', async () => {
  const home = makeHome({ tasks: [delivered('A-001', '2026-11-02T23:30:00.000Z'), delivered('A-002', '2026-11-03T00:30:00.000Z')] });
  const late = await cli(home, ['report'], { now: new Date('2026-11-02T23:59:59.000Z') });
  assert.match(late.out, /# Factory delivery report - 2026-11-02/);
  assert.match(section(late.out, 'Shipped'), /A-001/);
  const after = await cli(home, ['report'], { now: new Date('2026-11-03T00:00:00.000Z') });
  assert.match(after.out, /# Factory delivery report - 2026-11-03/);
  assert.doesNotMatch(section(after.out, 'Shipped'), /A-001/);
  assert.match(section(after.out, 'Shipped'), /A-002/);
});

test('a task without a PR or without evidence is never listed under Shipped', async () => {
  const fresh = `${DAY}T09:00:00.000Z`;
  const home = makeHome({
    tasks: [
      delivered('A-001', fresh),
      delivered('A-002', fresh, { pr: null }),
      delivered('A-003', fresh, { pr: '' }),
      delivered('A-004', fresh, { pr: '   ' }),
      delivered('A-005', fresh, { pr: undefined }),
      task('A-006', { status: 'in_review', pr: 'https://example.test/pr/6', evidence: [] }),
      task('A-007', { status: 'done', pr: 'https://example.test/pr/7' }),
      delivered('A-008', '2026-10-31T09:00:00.000Z', { status: 'done' }),
      delivered('A-009', fresh, { evidence: [{ at: fresh, text: '   ' }] }),
      delivered('A-010', fresh, { evidence: [{ text: 'no timestamp' }, null, { at: 42, text: 'bad at' }] }),
      delivered('A-011', fresh, { status: 'claimed' }),
      delivered('A-012', fresh, { status: 'blocked', blocker: 'waiting' }),
      delivered('A-013', fresh, { status: 'ready' }),
    ],
  });
  const r = await cli(home, ['report']);
  assert.equal(r.code, 0);
  const shipped = section(r.out, 'Shipped');
  assert.match(shipped, /A-001/);
  for (let n = 2; n <= 13; n += 1) {
    const id = `A-${String(n).padStart(3, '0')}`;
    assert.doesNotMatch(shipped, new RegExp(id), `${id} must not be shipped`);
  }
  const j = JSON.parse((await cli(home, ['report', '--json'])).out);
  assert.deepEqual(j.shipped.map((t) => t.id), ['A-001']);
  // The 8 excluded in_review/done tasks are counted, not hidden; A-008 shipped on another day and is not an exclusion.
  assert.match(shipped, new RegExp(`- 8 in_review/done task\\(s\\) not counted: ${NOT_COUNTED_WHY}`));
  assert.deepEqual(j.notCounted.map((t) => t.id), ['A-002', 'A-003', 'A-004', 'A-005', 'A-006', 'A-007', 'A-009', 'A-010']);
});

test('a task with several evidence entries is listed once, with only that day\'s entries', async () => {
  const home = makeHome({
    tasks: [task('A-001', {
      status: 'done', pr: 'https://example.test/pr/1',
      evidence: [at('2026-11-01T10:00:00.000Z'), at(`${DAY}T10:00:00.000Z`), at(`${DAY}T11:00:00.000Z`)],
    })],
  });
  const shipped = section((await cli(home, ['report'])).out, 'Shipped');
  assert.equal(shipped.match(/^- A-001 /gm).length, 1);
  assert.match(shipped, /T10:00:00\.000Z/);
  assert.match(shipped, /T11:00:00\.000Z/);
  assert.doesNotMatch(shipped, /2026-11-01/);
});

test('an empty day renders an explicit "nothing shipped" line and every other section', async () => {
  for (const tasks of [[], [delivered('A-001', '2026-10-30T09:00:00.000Z')]]) {
    const home = makeHome({ tasks });
    const r = await cli(home, ['report']);
    assert.equal(r.code, 0);
    assert.match(section(r.out, 'Shipped'), /nothing shipped on 2026-11-02/);
    for (const title of ['In flight', 'Blocked', 'Next ready']) section(r.out, title);
    assert.doesNotMatch(r.out, /A-001 .*PR:/);
  }
  const quiet = await cli(makeHome(), ['report', '--date', '2026-01-15']);
  assert.match(quiet.out, /nothing shipped on 2026-01-15/);
  assert.match(section(quiet.out, 'Next ready'), /none \(no ready task\)/);
});

test('In flight lists claimed tasks, Blocked shows the reason, Next ready is the top 3 by priority', async () => {
  const claim = { by: 'run-1', at: NOW.toISOString(), leaseUntil: '2026-11-02T11:30:00.000Z' };
  const stale = { by: 'run-0', at: '2026-11-02T01:00:00.000Z', leaseUntil: '2026-11-02T02:30:00.000Z' };
  const home = makeHome({
    tasks: [
      task('A-001', { status: 'claimed', claim, branch: 'claude/a-001-live' }),
      task('A-002', { status: 'claimed', claim: stale, branch: 'claude/a-002-stale' }),
      task('A-003', { status: 'blocked', blocker: 'needs the\nowner to approve the repo' }),
      task('A-004', { status: 'blocked' }),
      task('A-005', { priority: 3 }),
      task('A-006', { priority: 1 }),
      task('A-007', { priority: 2 }),
      task('A-008', { priority: 5 }),
      task('A-009', { priority: 1, deps: ['A-005'] }),
      task('A-010', { priority: 1, project: 'beta' }),
      task('A-011', { priority: 4, status: 'done' }),
    ],
  });
  const r = await cli(home, ['report']);
  assert.equal(r.code, 0);

  const flight = section(r.out, 'In flight');
  assert.match(flight, /A-001 .*branch claude\/a-001-live, claimed by run-1, lease until 2026-11-02T11:30:00\.000Z/);
  assert.match(flight, /A-002 .*claimed by run-0, no active lease/);
  assert.doesNotMatch(flight, /A-005|A-003/);

  const blocked = section(r.out, 'Blocked');
  assert.match(blocked, /A-003 .* - needs the owner to approve the repo/);
  assert.match(blocked, /A-004 .* - \(no reason recorded\)/);

  const next = section(r.out, 'Next ready');
  const ids = [...next.matchAll(/^- (A-\d+)/gm)].map((m) => m[1]);
  // Priority then id, like `factory next`: A-002 (expired lease, p3) is re-pickable and beats A-005 (p3) on id;
  // A-009 has an unfinished dep, A-010 is unauthorized, A-008 is p5.
  assert.deepEqual(ids, ['A-006', 'A-007', 'A-002']);
  assert.match(next, /A-006 Task A-006 \(alpha, p1\)/);
  assert.doesNotMatch(next, /A-009|A-010|A-011|A-008/);
  assert.doesNotMatch(next, /WIP limit/);
});

test('Next ready still previews the queue when WIP is full, and says it cannot be claimed yet', async () => {
  const lease = (by) => ({ by, at: NOW.toISOString(), leaseUntil: '2026-11-02T11:30:00.000Z' });
  const home = makeHome({
    tasks: [
      task('A-001', { status: 'claimed', claim: lease('r1') }),
      task('A-002', { status: 'claimed', claim: lease('r2') }),
      task('A-003', { priority: 1 }),
    ],
  });
  const next = section((await cli(home, ['report'])).out, 'Next ready');
  assert.match(next, /A-003/);
  assert.match(next, /WIP limit reached \(2\/2\)/);
  assert.equal(JSON.parse((await cli(home, ['report', '--json'])).out).wip.full, true);
});

test('--json prints the same data as structured JSON', async () => {
  const home = makeHome({ tasks: [delivered('A-001', `${DAY}T09:00:00.000Z`), delivered('A-002', `${DAY}T09:00:00.000Z`, { pr: null }), task('A-003')] });
  const r = await cli(home, ['report', '--json']);
  assert.equal(r.code, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.date, DAY);
  assert.equal(j.snapshotAt, NOW.toISOString());
  assert.deepEqual(j.shipped.map((t) => [t.id, t.pr]), [['A-001', 'https://example.test/pr/A-001']]);
  assert.deepEqual(j.nextReady.map((t) => t.id), ['A-003']);
});

test('--write saves reports/<date>.md (creating reports/), prints the same markdown and changes nothing else', async () => {
  const home = makeHome({ tasks: [delivered('A-001', `${DAY}T09:00:00.000Z`)] });
  const backlogBefore = readFileSync(join(home, 'factory', 'backlog.json'), 'utf8');
  assert.equal(existsSync(join(home, 'reports')), false);

  const plain = await cli(home, ['report']);
  assert.equal(existsSync(join(home, 'reports')), false, 'no --write, no file');

  const r = await cli(home, ['report', '--write']);
  assert.equal(r.code, 0);
  const file = join(home, 'reports', `${DAY}.md`);
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, 'utf8'), `${r.out}\n`);
  assert.equal(r.out, plain.out);
  assert.match(r.out, /A-001/);
  assert.match(r.err, /wrote reports\/2026-11-02\.md/);
  assert.equal(existsSync(`${file}.tmp`), false);
  assert.equal(readFileSync(join(home, 'factory', 'backlog.json'), 'utf8'), backlogBefore);
  assert.deepEqual(readData(home, 'backlog').tasks.map((t) => t.status), ['in_review']);

  // An explicit (past) date goes to its own file, an existing reports/ is fine, and re-running overwrites instead of appending.
  const old = await cli(home, ['report', '--date', '2026-10-01', '--write', '--allow-past']);
  assert.equal(old.code, 0);
  assert.match(readFileSync(join(home, 'reports', '2026-10-01.md'), 'utf8'), /nothing shipped on 2026-10-01/);
  await cli(home, ['report', '--write']);
  assert.equal(readFileSync(file, 'utf8'), `${r.out}\n`);

  // --json + --write: stdout is JSON, the file is still the markdown report.
  const both = await cli(home, ['report', '--json', '--write']);
  assert.equal(JSON.parse(both.out).date, DAY);
  assert.equal(readFileSync(file, 'utf8'), `${r.out}\n`);
});

test('a malformed --date is rejected with a clear error and --write writes nothing', async () => {
  const home = makeHome({ tasks: [delivered('A-001', `${DAY}T09:00:00.000Z`)] });
  for (const bad of ['tomorrow', '2026-1-5', '2026-13-01', '2026-02-30', '2026-11-02T10:00:00Z', '02-11-2026', '20261102', '']) {
    const r = await cli(home, ['report', '--date', bad, '--write']);
    assert.equal(r.code, 1, `--date "${bad}"`);
    assert.match(r.err, /^error: --date must be a real calendar day as YYYY-MM-DD/);
    assert.equal(r.out, '');
  }
  assert.equal(existsSync(join(home, 'reports')), false);
  assert.equal((await cli(home, ['report', '--date'])).code, 1, 'missing value');
  assert.equal((await cli(home, ['report', '2026-11-02'])).code, 1, 'date must be passed with --date');
  assert.equal((await cli(home, ['report', '--date', '2024-02-29'])).code, 0, 'leap day is valid');
  assert.equal((await cli(home, ['report', '--nope'])).code, 1);
});

test('evidence and blocker text is flattened, shortened and never leaks anything that looks like a secret', async () => {
  const token = ['ghp', 'x'.repeat(36)].join('_'); // built at runtime so this file never contains a literal token
  const home = makeHome({
    tasks: [
      delivered('A-001', `${DAY}T09:00:00.000Z`, { evidence: [{ at: `${DAY}T09:00:00.000Z`, text: `ran with GH_TOKEN=${token}\nall green` }] }),
      delivered('A-002', `${DAY}T09:00:00.000Z`, { evidence: [{ at: `${DAY}T09:00:00.000Z`, text: `line one\n\n  line   two ${'x'.repeat(400)}` }] }),
      task('A-003', { status: 'blocked', blocker: `push failed using ${token}` }),
    ],
  });
  for (const argv of [['report'], ['report', '--json']]) {
    const r = await cli(home, argv);
    assert.equal(r.code, 0);
    assert.equal(r.out.includes(token), false, argv.join(' '));
  }
  const r = await cli(home, ['report']);
  assert.match(section(r.out, 'Shipped'), /A-001[\s\S]*Evidence \[.*\]: \[redacted: text matched secret pattern github-token\]/);
  assert.match(section(r.out, 'Blocked'), /A-003 .* - \[redacted: text matched secret pattern github-token\]/);
  const long = section(r.out, 'Shipped').split('\n').find((l) => l.includes('line one line two'));
  assert.ok(long, 'newlines and runs of spaces collapse to a single line');
  assert.ok(long.endsWith('...') && long.length < 300);
});

test('report is listed by help', async () => {
  const help = await cli(makeHome(), ['help']);
  assert.match(help.out, /report\s+Daily delivery report/);
});

test('a secret in any rendered field (pr, title, branch, claimed-by, blocker, evidence) never reaches the report', async () => {
  const claim = { by: `run-${LEAK}`, at: NOW.toISOString(), leaseUntil: '2026-11-02T11:30:00.000Z' };
  const home = makeHome({
    tasks: [
      delivered('A-001', FRESH, { pr: `https://user:${LEAK}@github.com/x/y/pull/1`, title: `fix ${LEAK}` }),
      task('A-002', { status: 'claimed', claim, branch: `claude/a-002-${LEAK}` }),
      task('A-003', { status: 'blocked', blocker: `stuck, token ${LEAK}` }),
      task('A-004', { title: `ready ${LEAK}` }),
    ],
  });
  const md = (await cli(home, ['report'])).out;
  const json = (await cli(home, ['report', '--json'])).out;
  assert.equal(md.includes(LEAK), false);
  assert.equal(json.includes(LEAK), false);
  const redacted = '\\[redacted: text matched secret pattern github-token\\]';
  assert.match(section(md, 'Shipped'), new RegExp(`- A-001 ${redacted}`), 'title');
  assert.match(section(md, 'Shipped'), new RegExp(`PR: ${redacted}`), 'pr');
  assert.match(section(md, 'In flight'), /A-002 .*branch \[redacted: .*claimed by \[redacted: /, 'branch + claimed-by');
  assert.match(section(md, 'Blocked'), /A-003 .* - \[redacted: /, 'blocker');
  assert.match(section(md, 'Next ready'), /A-004 \[redacted: /, 'next ready title');
});

test('a newline in any field cannot forge a list item or a heading', async () => {
  const claim = { by: 'x\n- A-993 Forged (alpha, done)', at: NOW.toISOString(), leaseUntil: '2026-11-02T11:30:00.000Z\n## Blocked' };
  const home = makeHome({
    tasks: [
      delivered('A-001', FRESH, { title: 't\n## Blocked\n- A-999 Forged (alpha, done)' }),
      delivered('A-002', FRESH, { pr: 'x\n- A-999 Forged (alpha, done)' }),
      delivered('A-003', FRESH, { pr: 'https://example.test/pr/3\n- A-998 Forged (alpha, done)' }),
      delivered('A-004', `${FRESH}\n- A-997 Forged (alpha, done)`),
      delivered('A-005', FRESH, { evidence: [{ at: FRESH, text: '1 pass, 0 fail\r\n## Next ready\r\n- A-996 Forged (alpha, done)' }] }),
      task('A-006', { status: 'blocked', blocker: 'why\n## In flight\n- A-995 Forged (alpha, done)' }),
      task('A-007', { status: 'claimed', title: 'c\u2028- A-994 Forged', branch: 'b\n## Shipped', claim }),
    ],
  });
  const r = await cli(home, ['report']);
  assert.equal(r.code, 0);
  const lines = r.out.split('\n');
  assert.deepEqual(
    lines.filter((l) => l.startsWith('#')),
    ['# Factory delivery report - 2026-11-02', '## Shipped', '## In flight', '## Blocked', '## Next ready'],
  );
  assert.equal(lines.some((l) => /^\s*- A-99\d/.test(l)), false, 'no forged list item');
  assert.equal(/[\r\u2028]/.test(r.out), false);
  assert.ok(lines.some((l) => l.startsWith('- A-001 t ## Blocked - A-999 Forged (alpha, done) (alpha, in_review)')), 'flattened onto one line');
  assert.ok(lines.some((l) => l.includes('1 pass, 0 fail ## Next ready - A-996 Forged')));
  // A PR or timestamp that is not exactly a URL / ISO string is not accepted, so those tasks are not shipped at all.
  const json = (await cli(home, ['report', '--json'])).out;
  assert.deepEqual(JSON.parse(json).shipped.map((t) => t.id), ['A-001', 'A-005']);
  assert.equal(/\\[nru]/.test(json), false, 'no escaped newline survives in any JSON string');
});

test('the factory:allow-secret opt-out is not honoured in reports, but scanText keeps honouring it by default', async () => {
  const text = `GH_TOKEN=${LEAK} factory:allow-secret`;
  const home = makeHome({
    tasks: [
      delivered('A-001', FRESH, { evidence: [{ at: FRESH, text }], title: text }),
      task('A-002', { status: 'blocked', blocker: text }),
    ],
  });
  for (const argv of [['report'], ['report', '--json']]) {
    const r = await cli(home, argv);
    assert.equal(r.out.includes(LEAK), false, argv.join(' '));
    assert.equal(r.out.includes('allow-secret'), false, 'the whole line is replaced, marker included');
  }
  assert.match((await cli(home, ['report'])).out, /\[redacted: text matched secret pattern github-token\]/);
  const line = `x ${LEAK} factory:allow-secret`;
  assert.deepEqual(scanText(line), [], 'default behaviour (pre-commit hook) is unchanged');
  assert.deepEqual(scanText(line, { honorAllowMarker: false }), [{ line: 1, pattern: 'github-token' }]);
  assert.deepEqual(scanText(line, { honorAllowMarker: true }), []);
});

test('evidence is dated by its real UTC day: offsets convert, non-timestamps and zone-less times do not count', async () => {
  const withAt = (id, when) => delivered(id, FRESH, { evidence: [{ at: when, text: '12 pass, 0 fail' }] });
  const home = makeHome({
    tasks: [
      withAt('A-001', '2026-11-02T01:00:00+02:00'), // 2026-11-01T23:00Z
      withAt('A-002', '2026-11-02T23:30:00-05:00'), // 2026-11-03T04:30Z
      withAt('A-003', '2026-11-03T01:00:00+02:00'), // 2026-11-02T23:00Z
      withAt('A-004', '2026-11-02 totally not a timestamp'),
      withAt('A-005', '2026-11-02T10:00:00'), // no zone: ambiguous, so never counted
      withAt('A-006', '2026-02-30T10:00:00Z'), // not a real day
      withAt('A-007', DAY), // a bare date is UTC
      withAt('A-008', 'yesterday'),
    ],
  });
  const ids = async (date) => JSON.parse((await cli(home, ['report', '--json', '--date', date])).out).shipped.map((t) => t.id);
  assert.deepEqual(await ids(DAY), ['A-003', 'A-007']);
  assert.deepEqual(await ids('2026-11-01'), ['A-001']);
  assert.deepEqual(await ids('2026-11-03'), ['A-002']);
  assert.deepEqual(await ids('2026-03-02'), [], 'a rolled-over impossible date does not count either');
  // Anything that mentions the report day but does not count is flagged instead of silently dropped.
  const j = JSON.parse((await cli(home, ['report', '--json'])).out);
  assert.deepEqual(j.notCounted.map((t) => t.id), ['A-001', 'A-002', 'A-004', 'A-005', 'A-006', 'A-008']);
  assert.match((await cli(home, ['report'])).out, new RegExp(`- 6 in_review/done task\\(s\\) not counted: ${NOT_COUNTED_WHY}`));
});

test('only a real PR URL counts: TBD, n/a, other schemes and embedded spaces do not; surrounding whitespace is trimmed', async () => {
  const withPr = (id, pr) => delivered(id, FRESH, { pr });
  const home = makeHome({
    tasks: [
      withPr('A-001', 'TBD'), withPr('A-002', 'n/a'), withPr('A-003', 'ftp://example.test/3'), withPr('A-004', 'https://'),
      withPr('A-005', 'https://example.test/a b'), withPr('A-006', 'example.test/pr/6'), withPr('A-007', 42),
      withPr('A-008', '  https://example.test/pr/8  '), withPr('A-009', 'http://example.test/pr/9'),
    ],
  });
  const r = await cli(home, ['report']);
  const j = JSON.parse((await cli(home, ['report', '--json'])).out);
  assert.deepEqual(j.shipped.map((t) => t.id), ['A-008', 'A-009']);
  assert.deepEqual(j.notCounted.map((t) => t.id), ['A-001', 'A-002', 'A-003', 'A-004', 'A-005', 'A-006', 'A-007']);
  assert.ok(r.out.split('\n').includes('  - PR: https://example.test/pr/8'), 'rendered trimmed');
  assert.equal(j.shipped[0].pr, 'https://example.test/pr/8');
  assert.match(r.out, new RegExp(`- 7 in_review/done task\\(s\\) not counted: ${NOT_COUNTED_WHY}`));
});

test('evidence that reports failures never counts as shipped; passing summaries do', async () => {
  const withText = (id, text) => delivered(id, FRESH, { evidence: [{ at: FRESH, text }] });
  const good = ['pass 41, fail 0', '41 pass, 0 fail', 'ℹ tests 41\nℹ pass 41\nℹ fail 0', 'all green', 'npm test: 12 pass, 0 fail', 'failures: 0, errors: 0'];
  const bad = ['3 fail, 0 pass', 'fail: 2', 'fail=1', 'tests failed 4', '12 failing', '2 failures', '1 error', 'FAILURES 3', 'fails: 7'];
  const home = makeHome({
    tasks: [
      ...good.map((t, i) => withText(`A-${100 + i}`, t)),
      ...bad.map((t, i) => withText(`A-${200 + i}`, t)),
      // One failing and one clean entry on the day: shipped, but only the clean entry is listed.
      delivered('A-300', FRESH, { evidence: [{ at: FRESH, text: '2 fail, 5 pass' }, { at: '2026-11-02T10:00:00.000Z', text: 'rerun: 7 pass, 0 fail' }] }),
    ],
  });
  const j = JSON.parse((await cli(home, ['report', '--json'])).out);
  assert.deepEqual(j.shipped.map((t) => t.id), [...good.map((_, i) => `A-${100 + i}`), 'A-300']);
  assert.deepEqual(j.notCounted.map((t) => t.id), bad.map((_, i) => `A-${200 + i}`));
  assert.ok(j.notCounted.every((t) => t.reasons.join() === 'evidence reports failures'));
  assert.deepEqual(j.shipped.at(-1).evidence.map((e) => e.text), ['rerun: 7 pass, 0 fail']);
  const md = (await cli(home, ['report'])).out;
  assert.match(section(md, 'Shipped'), new RegExp(`- ${bad.length} in_review/done task\\(s\\) not counted: ${NOT_COUNTED_WHY}`));
  assert.doesNotMatch(section(md, 'Shipped'), /A-2\d\d/);
});

test('the "not counted" line only appears when something was actually excluded', async () => {
  const clean = makeHome({ tasks: [delivered('A-001', FRESH), delivered('A-002', '2026-10-30T09:00:00.000Z', { status: 'done' }), task('A-003')] });
  assert.doesNotMatch((await cli(clean, ['report'])).out, /not counted/);
  assert.doesNotMatch((await cli(makeHome(), ['report'])).out, /not counted/);
  assert.deepEqual(JSON.parse((await cli(clean, ['report', '--json'])).out).notCounted, []);
  // Done today without same-day evidence is exactly what must be flagged.
  const doneToday = makeHome({ tasks: [delivered('A-001', '2026-10-30T09:00:00.000Z', { status: 'done', completedAt: FRESH })] });
  const r = await cli(doneToday, ['report']);
  assert.match(section(r.out, 'Shipped'), /nothing shipped on 2026-11-02/);
  assert.match(section(r.out, 'Shipped'), /1 in_review\/done task\(s\) not counted/);
});

test('malformed tasks are skipped and counted instead of crashing the report', async () => {
  const noArrays = { id: 'A-020', title: 'no arrays', project: 'alpha', status: 'ready' };
  const home = makeHome({
    tasks: [
      delivered('A-001', FRESH), null, 42, {}, noArrays,
      task('A-021', { evidence: 'oops' }), task('A-022', { deps: null }), task('A-023', { status: 'bogus' }),
      { ...task('A-024'), id: 24 },
      task('A-025', { status: 'in_review', pr: 'https://example.test/pr/25', evidence: { at: FRESH, text: 'x' } }),
      task('A-002', { priority: 1 }),
    ],
  });
  const r = await cli(home, ['report']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /skipped 9 malformed task\(s\): #2, #3, #4, A-020, A-021, A-022, A-023, #9, A-025/);
  assert.deepEqual(section(r.out, 'Shipped').match(/^- A-\d+/gm), ['- A-001']);
  assert.deepEqual([...section(r.out, 'Next ready').matchAll(/^- (A-\d+)/gm)].map((m) => m[1]), ['A-002']);
  const j = JSON.parse((await cli(home, ['report', '--json'])).out);
  assert.deepEqual(j.skipped, ['#2', '#3', '#4', 'A-020', 'A-021', 'A-022', 'A-023', '#9', 'A-025']);
  const ok = await cli(makeHome({ tasks: [task('A-001')] }), ['report']);
  assert.doesNotMatch(ok.out, /malformed/);
});

test('--write for a day other than today is refused unless --allow-past; reading any day is always fine', async () => {
  const home = makeHome({ tasks: [delivered('A-001', '2026-11-01T09:00:00.000Z')] });
  for (const date of ['2026-11-01', '2026-11-03']) {
    for (const extra of [[], ['--json']]) {
      const r = await cli(home, ['report', '--date', date, '--write', ...extra]);
      assert.equal(r.code, 1, `${date} ${extra}`);
      assert.match(r.err, new RegExp(`^error: refusing to write reports/${date}\\.md: ${date} is not today \\(2026-11-02, UTC\\).*--allow-past`));
      assert.equal(r.out, '');
    }
  }
  assert.equal(existsSync(join(home, 'reports')), false, 'nothing was written');

  const read = await cli(home, ['report', '--date', '2026-11-01']);
  assert.equal(read.code, 0);
  assert.equal(existsSync(join(home, 'reports')), false, 'plain read writes nothing');

  const ok = await cli(home, ['report', '--date', '2026-11-01', '--write', '--allow-past']);
  assert.equal(ok.code, 0);
  assert.match(ok.err, /wrote reports\/2026-11-01\.md/);
  assert.match(readFileSync(join(home, 'reports', '2026-11-01.md'), 'utf8'), /A-001/);
  assert.equal((await cli(home, ['report', '--write', '--allow-past'])).code, 0, 'harmless for today');
  assert.match((await cli(home, ['help'])).out, /report\s+.*--allow-past/);
});

test('path-like --date values are rejected and nothing is written outside reports/', async () => {
  const home = makeHome({ tasks: [delivered('A-001', FRESH)] });
  for (const bad of ['../2026-11-02', 'x/2026-11-02', '../../2026-11-02', '2026-11-02/..', '2026-11-02/x', '/tmp/2026-11-02']) {
    for (const extra of [[], ['--allow-past']]) {
      const r = await cli(home, ['report', '--date', bad, '--write', ...extra]);
      assert.equal(r.code, 1, bad);
      assert.match(r.err, /^error: --date must be a real calendar day as YYYY-MM-DD/);
      assert.equal(r.out, '');
    }
  }
  assert.deepEqual(readdirSync(home), ['factory']);
  assert.equal(existsSync(join(home, '..', '2026-11-02.md')), false);
  assert.equal(existsSync(join(home, '2026-11-02.md')), false);
});

test('the default day, the written file name and evidence days are UTC even when the process runs in a far-off timezone', async () => {
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14: the local date is already the next day
    assert.equal(new Date('2026-11-02T23:30:00.000Z').getDate(), 3, 'sanity: the zone switch took effect');
    const home = makeHome({ tasks: [delivered('A-001', '2026-11-02T23:00:00.000Z'), delivered('A-002', '2026-11-03T00:30:00.000Z')] });
    const east = await cli(home, ['report', '--write'], { now: new Date('2026-11-02T23:30:00.000Z') });
    assert.match(east.out, /# Factory delivery report - 2026-11-02/);
    assert.match(section(east.out, 'Shipped'), /A-001/);
    assert.doesNotMatch(section(east.out, 'Shipped'), /A-002/);
    assert.deepEqual(readdirSync(join(home, 'reports')), ['2026-11-02.md']);

    process.env.TZ = 'Pacific/Pago_Pago'; // UTC-11: the local date is still the previous day
    assert.equal(new Date('2026-11-03T00:30:00.000Z').getDate(), 2, 'sanity: the zone switch took effect');
    const west = await cli(home, ['report'], { now: new Date('2026-11-03T00:30:00.000Z') });
    assert.match(west.out, /# Factory delivery report - 2026-11-03/);
    assert.match(section(west.out, 'Shipped'), /A-002/);
    assert.doesNotMatch(section(west.out, 'Shipped'), /A-001/);
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test('Shipped is sorted by id regardless of backlog order', async () => {
  const home = makeHome({ tasks: [delivered('A-010', FRESH), delivered('A-002', FRESH), delivered('A-001', FRESH, { status: 'done' })] });
  const md = (await cli(home, ['report'])).out;
  assert.deepEqual(section(md, 'Shipped').match(/^- A-\d+/gm), ['- A-001', '- A-002', '- A-010']);
  assert.deepEqual(JSON.parse((await cli(home, ['report', '--json'])).out).shipped.map((t) => t.id), ['A-001', 'A-002', 'A-010']);
});
