import { addTask } from '../tasks.mjs';

export const summary = 'Add a task: factory add "<title>" --project <id> --accept "<criterion>" [...]';
export const options = {
  project: { type: 'string' },
  type: { type: 'string' },
  priority: { type: 'string' },
  dep: { type: 'string', multiple: true },
  accept: { type: 'string', multiple: true },
};

export function run(ctx) {
  const { registry, backlog } = ctx.load();
  const { backlog: next, task } = addTask(backlog, registry, {
    project: ctx.args.project,
    title: ctx.pos.join(' '),
    type: ctx.args.type,
    priority: ctx.args.priority === undefined ? undefined : Number(ctx.args.priority),
    deps: ctx.args.dep ?? [],
    acceptance: ctx.args.accept ?? [],
  }, ctx.now());
  ctx.save('backlog', next);
  ctx.out(ctx.args.json ? JSON.stringify(task, null, 2) : `added ${task.id}: ${task.title}`);
}
