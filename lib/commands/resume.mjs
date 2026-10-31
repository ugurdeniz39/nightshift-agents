import { nextReady } from '../tasks.mjs';

export const summary = 'Answer: what were we building, what works, what failed, what is next';
export const options = {};

const day = (iso) => iso.slice(0, 10);

export function run(ctx) {
  const { registry, backlog, state } = ctx.load();
  const now = ctx.now();
  const lines = [];
  const section = (title, items, fmt = (i) => `- [${day(i.at)}] ${i.text}`) => {
    lines.push('', title);
    lines.push(...(items.length ? items.map(fmt) : ['  (none)']));
  };

  lines.push('BUILDING', `  ${state.building}`);
  section('VERIFIED (real evidence only)', state.verified);
  section('FAILED', state.failed);
  section('BLOCKERS', state.blockers);

  const inFlight = backlog.tasks.filter((t) => ['claimed', 'in_review'].includes(t.status));
  section('IN FLIGHT', inFlight, (t) => `- ${t.id} ${t.status}  ${t.title}  branch=${t.branch ?? '-'}  pr=${t.pr ?? '-'}`);

  lines.push('', 'AUTOMATION', `  scheduled runs: ${state.automation.scheduled}${state.automation.note ? ` - ${state.automation.note}` : ''}`);

  const { task, reason } = nextReady(backlog, registry, { now });
  lines.push('', 'NEXT', task ? `  ${task.id}  ${task.title}` : `  ${reason}`);

  ctx.out(ctx.args.json ? JSON.stringify({ state, inFlight, next: task ?? null }, null, 2) : lines.join('\n'));
}
