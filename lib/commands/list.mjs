export const summary = 'List tasks (filter with --status, --project)';
export const options = { status: { type: 'string' }, project: { type: 'string' } };

export function run(ctx) {
  const { backlog } = ctx.load();
  const tasks = backlog.tasks
    .filter((t) => !ctx.args.status || t.status === ctx.args.status)
    .filter((t) => !ctx.args.project || t.project === ctx.args.project)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  if (ctx.args.json) return ctx.out(JSON.stringify(tasks, null, 2));
  if (tasks.length === 0) return ctx.out('(no tasks)');
  for (const t of tasks) {
    const pr = t.pr ? `  ${t.pr}` : '';
    ctx.out(`${t.id.padEnd(8)} ${t.status.padEnd(10)} p${t.priority} ${t.project.padEnd(12)} ${t.title}${pr}`);
  }
}
