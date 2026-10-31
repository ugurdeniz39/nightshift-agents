import { submit } from '../tasks.mjs';

export const summary = 'Move a claimed task to review: factory submit <id> --pr <url> --evidence "<real test output summary>"';
export const options = { pr: { type: 'string' }, evidence: { type: 'string' } };

export function run(ctx) {
  const [id] = ctx.pos;
  if (!id) throw new Error('usage: factory submit <id> --pr <url> --evidence "<text>"');
  ctx.save('backlog', submit(ctx.load().backlog, id, { pr: ctx.args.pr, evidence: ctx.args.evidence }, ctx.now()));
  ctx.out(`${id} is now in_review${ctx.args.pr ? ` (${ctx.args.pr})` : ''}`);
}
