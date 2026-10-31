import { branchFor, nextReady, remoteClaimedIds } from '../tasks.mjs';
import { EXIT } from '../cli.mjs';

export const summary = 'Show the next ready task (--check-remote skips tasks whose claude/<id>-* branch exists on origin)';
export const options = { project: { type: 'string' }, 'check-remote': { type: 'boolean' } };

export function run(ctx) {
  const { registry, backlog } = ctx.load();
  let excludeIds = new Set();
  if (ctx.args['check-remote']) {
    // Fail closed: if we cannot see origin, we cannot prove nobody else started the task.
    try {
      excludeIds = remoteClaimedIds(registry, backlog, ctx.lsRemote());
    } catch (e) {
      throw new Error(`cannot verify remote branches (${e.message.split('\n')[0]}); refusing to pick a task`);
    }
  }
  const { task, reason } = nextReady(backlog, registry, { project: ctx.args.project, now: ctx.now(), excludeIds });
  if (!task) {
    ctx.out(ctx.args.json ? JSON.stringify({ task: null, reason }) : `nothing to do: ${reason}`);
    return EXIT.NOTHING;
  }
  const branch = branchFor(registry, task);
  if (ctx.args.json) return ctx.out(JSON.stringify({ task, branch }, null, 2));
  ctx.out(`${task.id}  ${task.title}`);
  ctx.out(`project: ${task.project}   branch: ${branch}`);
  ctx.out('acceptance:');
  for (const a of task.acceptance) ctx.out(`  - ${a}`);
}
