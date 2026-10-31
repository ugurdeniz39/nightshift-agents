import { claim } from '../tasks.mjs';

export const summary = 'Claim a task with a lease: factory claim <id> --by <run-name> [--lease-min 90]';
export const options = { by: { type: 'string' }, 'lease-min': { type: 'string' } };

export function run(ctx) {
  const [id] = ctx.pos;
  if (!id) throw new Error('usage: factory claim <id> --by <run-name>');
  const { registry, backlog } = ctx.load();
  const leaseMin = ctx.args['lease-min'] === undefined ? 90 : Number(ctx.args['lease-min']);
  if (!Number.isFinite(leaseMin) || leaseMin <= 0) throw new Error('--lease-min must be a positive number');
  const next = claim(backlog, registry, id, ctx.args.by, ctx.now(), leaseMin);
  ctx.save('backlog', next);
  const t = next.tasks.find((x) => x.id === id);
  ctx.out(ctx.args.json ? JSON.stringify(t, null, 2) : `claimed ${id} by ${t.claim.by} until ${t.claim.leaseUntil}\nbranch: ${t.branch}`);
}
