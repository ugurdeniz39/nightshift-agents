import { activeClaims, STATUSES } from '../tasks.mjs';

export const summary = 'Projects, task counts per status, WIP and automation state';
export const options = {};

export function run(ctx) {
  const { registry, backlog, state } = ctx.load();
  const wip = activeClaims(backlog, ctx.now()).length;
  const rows = registry.projects.map((p) => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const t of backlog.tasks) if (t.project === p.id) counts[t.status] += 1;
    return { ...p, counts };
  });

  if (ctx.args.json) {
    ctx.out(JSON.stringify({ policy: registry.policy, wip, automation: state.automation, projects: rows }, null, 2));
    return;
  }
  ctx.out(`FACTORY  wip ${wip}/${registry.policy.maxWip}  branches ${registry.policy.branchPrefix}*  auto-merge=${registry.policy.autoMerge}`);
  for (const r of rows) {
    const c = STATUSES.map((s) => `${s} ${r.counts[s]}`).join(' | ');
    ctx.out(`  ${r.id.padEnd(14)} ${r.status.padEnd(12)} ${(r.visibility ?? '-').padEnd(8)} ${c}`);
  }
  ctx.out(`AUTOMATION  scheduled runs: ${state.automation.scheduled}${state.automation.note ? ` (${state.automation.note})` : ''}`);
}
