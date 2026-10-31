import { release } from '../tasks.mjs';

export const summary = 'Give a claimed task back to the queue: factory release <id>';
export const options = {};

export function run(ctx) {
  const [id] = ctx.pos;
  if (!id) throw new Error('usage: factory release <id>');
  ctx.save('backlog', release(ctx.load().backlog, id));
  ctx.out(`released ${id}`);
}
