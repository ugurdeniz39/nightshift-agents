import { complete } from '../tasks.mjs';

export const summary = 'Mark an in_review task done after its PR is merged: factory complete <id>';
export const options = {};

export function run(ctx) {
  const [id] = ctx.pos;
  if (!id) throw new Error('usage: factory complete <id>');
  ctx.save('backlog', complete(ctx.load().backlog, id, ctx.now()));
  ctx.out(`${id} is done`);
}
