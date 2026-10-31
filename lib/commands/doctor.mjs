import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { STATUSES } from '../tasks.mjs';

export const summary = 'Self-check of tools and factory data (PASS/WARN/FAIL per check, exit 1 on any FAIL)';
export const options = {};

const MIN_NODE = 22;
const FILES = ['registry', 'backlog', 'state'];

function gitOnPath() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export function run(ctx) {
  const results = [];
  const add = (level, name, detail = '') => results.push({ level, name, detail });
  const check = (ok, name, detail = '') => add(ok ? 'PASS' : 'FAIL', name, ok ? '' : detail);

  const nodeVersion = ctx.nodeVersion ?? process.versions.node;
  check(Number.parseInt(nodeVersion, 10) >= MIN_NODE, `node >= ${MIN_NODE}`, `found ${nodeVersion}`);
  check((ctx.gitOnPath ?? gitOnPath)(), 'git on PATH', 'git --version failed');

  const data = {};
  for (const key of FILES) {
    try {
      data[key] = JSON.parse(readFileSync(join(ctx.home, 'factory', `${key}.json`), 'utf8'));
      add('PASS', `${key}.json parses`);
    } catch (e) {
      add('FAIL', `${key}.json parses`, e.message);
    }
  }

  if (data.registry) {
    if (data.registry.owner) add('PASS', 'owner configured');
    else add('WARN', 'owner configured', 'run: node bin/factory.mjs init --owner <you> --repo <you>/<repo>');
  }

  const { registry, backlog } = data;
  const tasks = Array.isArray(backlog?.tasks) ? backlog.tasks : null;
  if (backlog && !tasks) add('FAIL', 'backlog has a tasks array');
  if (tasks) {
    const ids = tasks.map((t) => t?.id);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    check(dupes.length === 0, 'task ids unique', `duplicates: ${dupes.join(', ')}`);

    const known = new Set(ids);
    const badStatus = tasks.filter((t) => !STATUSES.includes(t?.status)).map((t) => `${t?.id}=${t?.status}`);
    check(badStatus.length === 0, 'task statuses valid', badStatus.join(', '));

    const missingDeps = tasks.flatMap((t) => (Array.isArray(t?.deps) ? t.deps : []).filter((d) => !known.has(d)).map((d) => `${t.id}->${d}`));
    check(missingDeps.length === 0, 'every dep exists', missingDeps.join(', '));

    if (Array.isArray(registry?.projects)) {
      const projects = new Set(registry.projects.map((p) => p.id));
      const orphans = tasks.filter((t) => !projects.has(t?.project)).map((t) => `${t?.id}:${t?.project}`);
      check(orphans.length === 0, 'every task project exists in registry', orphans.join(', '));
    } else {
      add('FAIL', 'every task project exists in registry', 'registry has no projects array');
    }

    const noAcceptance = tasks
      .filter((t) => t?.status === 'ready' && !(Array.isArray(t.acceptance) && t.acceptance.some((a) => typeof a === 'string' && a.trim())))
      .map((t) => t.id);
    check(noAcceptance.length === 0, 'ready tasks have acceptance criteria', noAcceptance.join(', '));

    const now = ctx.now();
    const expired = tasks
      .filter((t) => t?.status === 'claimed' && !(t.claim && new Date(t.claim.leaseUntil) > now))
      .map((t) => t.id);
    if (expired.length) add('WARN', 'no expired claim leases', `expired: ${expired.join(', ')}`);
    else add('PASS', 'no expired claim leases');
  }

  for (const r of results) ctx.out(`${r.level.padEnd(4)}  ${r.name}${r.detail ? ` - ${r.detail}` : ''}`);
  return results.some((r) => r.level === 'FAIL') ? 1 : 0;
}
