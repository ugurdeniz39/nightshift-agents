import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { STATUSES, activeClaims, leaseActive, nextReady } from '../tasks.mjs';
import { scanText } from '../secrets.mjs';

export const summary = 'Daily delivery report: shipped (PR + same-day evidence only), in flight, blocked, next ready (--date, --write; writing a day other than today needs --allow-past)';
export const options = { date: { type: 'string' }, write: { type: 'boolean' }, 'allow-past': { type: 'boolean' } };

const NEXT_LIMIT = 3;
const TEXT_MAX = 200;

const hasText = (s) => typeof s === 'string' && s.trim() !== '';
const byId = (a, b) => a.id.localeCompare(b.id);

const PR_URL = /^https?:\/\/\S+$/;
// A zone designator is mandatory so the UTC day never depends on the machine's TZ.
const ISO_AT = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
// Evidence that reports failures ("3 fail, 0 pass", "fail: 2") must never back a delivery claim; "41 pass, 0 fail" is fine.
const FAILURE = [/\bfail(?:ed|ing|ures?|s)?\s*[:=]?\s*[1-9]\d*\b/i, /\b[1-9]\d*\s+(?:fail(?:ed|ing|ures?)?|errors?)\b/i];

// Real calendar day, not just the right shape (rejects 2026-02-30).
function realDay(y, mo, d) {
  const check = new Date(Date.UTC(y, mo - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d;
}

function parseDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m && realDay(Number(m[1]), Number(m[2]), Number(m[3]))) return raw;
  throw new Error(`--date must be a real calendar day as YYYY-MM-DD, got "${raw}"`);
}

// UTC calendar day of an evidence timestamp, or null when it is not a real ISO-8601 timestamp.
function utcDay(at) {
  const m = typeof at === 'string' ? ISO_AT.exec(at) : null;
  if (!m || !realDay(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// Every free-text field lands in a git-tracked report: one short line (so it cannot forge a list item or heading),
// and never anything that looks like a secret. The factory:allow-secret opt-out is deliberately NOT honoured here.
function safeLine(value, max = TEXT_MAX) {
  const line = String(value ?? '').replace(/[\s\p{Cc}]+/gu, ' ').trim();
  const hit = scanText(line, { honorAllowMarker: false })[0];
  if (hit) return `[redacted: text matched secret pattern ${hit.pattern}]`;
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

const safeOrNull = (v) => (typeof v === 'string' && v !== '' ? safeLine(v) : null);

// Minimum shape the report (and nextReady) relies on; anything else is skipped and counted, never crashes the report.
const wellFormed = (t) => Boolean(t) && typeof t === 'object' && hasText(t.id) && typeof t.title === 'string'
  && typeof t.project === 'string' && STATUSES.includes(t.status) && Array.isArray(t.deps) && Array.isArray(t.evidence);

// Shipped = in_review/done AND a PR URL AND at least one non-blank, failure-free evidence entry dated the UTC report day.
// A task that is in_review/done but misses a piece comes back as { shipped: false, reasons } so it is flagged, not hidden.
function classify(t, date) {
  const pr = typeof t.pr === 'string' ? t.pr.trim() : '';
  const prOk = PR_URL.test(pr);
  const dated = t.evidence.filter((e) => hasText(e?.text) && utcDay(e.at) !== null);
  const clean = dated.filter((e) => !FAILURE.some((re) => re.test(e.text)));
  const today = clean.filter((e) => utcDay(e.at) === date);
  if (prOk && today.length) return { shipped: true, pr, evidence: today };

  const reasons = [];
  if (!prOk) reasons.push('missing PR URL');
  if (!today.length) reasons.push(dated.some((e) => utcDay(e.at) === date) ? 'evidence reports failures' : 'no evidence dated that day');
  // Flag only what is about this day or can never ship (a task properly shipped on another day is not an exclusion).
  const touchesDay = t.evidence.some((e) => typeof e?.at === 'string' && (e.at.startsWith(date) || utcDay(e.at) === date))
    || utcDay(t.completedAt) === date;
  return { shipped: false, flag: !prOk || clean.length === 0 || touchesDay, reasons };
}

function collect({ registry, backlog }, date, now) {
  const skipped = [];
  const tasks = backlog.tasks.filter((t, i) => {
    if (wellFormed(t)) return true;
    skipped.push(safeOrNull(t?.id) ?? `#${i + 1}`);
    return false;
  });
  const clean = { ...backlog, tasks };

  const shipped = [];
  const notCounted = [];
  for (const t of tasks.filter((x) => ['in_review', 'done'].includes(x.status))) {
    const c = classify(t, date);
    if (c.shipped) {
      shipped.push({
        id: safeLine(t.id), title: safeLine(t.title), project: safeLine(t.project), status: t.status, pr: safeLine(c.pr, Infinity),
        evidence: c.evidence.map((e) => ({ at: safeLine(e.at), text: safeLine(e.text) })),
      });
    } else if (c.flag) {
      notCounted.push({ id: safeLine(t.id), reasons: c.reasons });
    }
  }

  const inFlight = tasks.filter((t) => t.status === 'claimed').map((t) => ({
    id: safeLine(t.id), title: safeLine(t.title), project: safeLine(t.project), branch: safeOrNull(t.branch),
    claimedBy: safeOrNull(t.claim?.by), leaseUntil: safeOrNull(t.claim?.leaseUntil), leaseActive: leaseActive(t, now),
  }));

  const blocked = tasks.filter((t) => t.status === 'blocked').map((t) => ({
    id: safeLine(t.id), title: safeLine(t.title), project: safeLine(t.project),
    reason: hasText(t.blocker) ? safeLine(t.blocker) : '(no reason recorded)',
  }));

  // Preview the queue even when WIP is full (nextReady alone would answer "none"); `wip.full` says whether it is claimable now.
  const unlimited = { ...registry, policy: { ...registry.policy, maxWip: Infinity } };
  const ready = [];
  const excludeIds = new Set();
  while (ready.length < NEXT_LIMIT) {
    const { task } = nextReady(clean, unlimited, { now, excludeIds });
    if (!task) break;
    ready.push({ id: safeLine(task.id), title: safeLine(task.title), project: safeLine(task.project), priority: Number.isFinite(task.priority) ? task.priority : null });
    excludeIds.add(task.id);
  }
  const active = activeClaims(clean, now).length;

  return {
    date, snapshotAt: now.toISOString(), skipped,
    shipped: shipped.sort(byId), notCounted: notCounted.sort(byId), inFlight: inFlight.sort(byId), blocked: blocked.sort(byId),
    nextReady: ready, wip: { active, max: registry.policy.maxWip, full: active >= registry.policy.maxWip },
  };
}

function render(r) {
  const lines = [
    `# Factory delivery report - ${r.date}`,
    '',
    `Shipped is scoped to ${r.date} (UTC). In flight, Blocked and Next ready are a snapshot taken at ${r.snapshotAt}.`,
  ];
  if (r.skipped.length) lines.push('', `Warning: skipped ${r.skipped.length} malformed task(s): ${r.skipped.join(', ')}`);
  const section = (title, items, fmt, empty) => {
    lines.push('', `## ${title}`, ...(items.length ? items.flatMap(fmt) : [`- ${empty}`]));
  };

  section('Shipped', r.shipped, (t) => [
    `- ${t.id} ${t.title} (${t.project}, ${t.status})`,
    `  - PR: ${t.pr}`,
    ...t.evidence.map((e) => `  - Evidence [${e.at}]: ${e.text}`),
  ], `nothing shipped on ${r.date} (no task had both a PR and evidence dated that day)`);
  if (r.notCounted.length) {
    lines.push(`- ${r.notCounted.length} in_review/done task(s) not counted: missing PR URL, evidence dated that day, or evidence reports failures`);
  }

  section('In flight', r.inFlight, (t) => [
    `- ${t.id} ${t.title} (${t.project}) - branch ${t.branch ?? '-'}, claimed by ${t.claimedBy ?? '-'}, ${t.leaseActive ? `lease until ${t.leaseUntil}` : 'no active lease'}`,
  ], 'none');

  section('Blocked', r.blocked, (t) => [`- ${t.id} ${t.title} (${t.project}) - ${t.reason}`], 'none');

  section('Next ready', r.nextReady, (t) => [`- ${t.id} ${t.title} (${t.project}, p${t.priority ?? '?'})`], 'none (no ready task)');
  if (r.wip.full) lines.push(`- note: WIP limit reached (${r.wip.active}/${r.wip.max}), so none of these can be claimed yet`);

  return lines.join('\n');
}

export function run(ctx) {
  if (ctx.pos.length) throw new Error('usage: factory report [--date YYYY-MM-DD] [--write] [--allow-past]');
  const now = ctx.now();
  const today = now.toISOString().slice(0, 10);
  const date = ctx.args.date === undefined ? today : parseDate(ctx.args.date);
  // In flight / Blocked / Next ready describe now, so a saved report for another day would rewrite history with today's state.
  if (ctx.args.write && date !== today && !ctx.args['allow-past']) {
    throw new Error(`refusing to write reports/${date}.md: ${date} is not today (${today}, UTC) and In flight, Blocked and Next ready are a snapshot of now; pass --allow-past to write it anyway`);
  }
  const report = collect(ctx.load(), date, now);
  const markdown = render(report);

  let written = null;
  if (ctx.args.write) {
    written = join('reports', `${date}.md`);
    mkdirSync(join(ctx.home, 'reports'), { recursive: true });
    const target = join(ctx.home, written);
    // Write-then-rename, same as the store, so an interrupted run never leaves half a report.
    writeFileSync(`${target}.tmp`, `${markdown}\n`);
    renameSync(`${target}.tmp`, target);
  }

  ctx.out(ctx.args.json ? JSON.stringify(report, null, 2) : markdown);
  // Confirmation goes to stderr so stdout stays exactly the report.
  if (written) ctx.err(`wrote ${written}`);
}
