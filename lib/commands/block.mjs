import { block } from '../tasks.mjs';

export const summary = 'Record a real blocker: factory block <id> --reason "<why>"';
export const options = { reason: { type: 'string' } };

export function run(ctx) {
  const [id] = ctx.pos;
  if (!id) throw new Error('usage: factory block <id> --reason "<why>"');
  ctx.save('backlog', block(ctx.load().backlog, id, ctx.args.reason));
  ctx.out(`${id} is blocked: ${ctx.args.reason}`);
}
