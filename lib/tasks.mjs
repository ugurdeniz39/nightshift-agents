// Pure backlog logic. Every function takes data in and returns new data (or throws).
// Time is always passed in as `now` (a Date) so behaviour is deterministic in tests.

const MINUTE = 60_000;

export const STATUSES = ['ready', 'claimed', 'in_review', 'done', 'blocked'];

const byId = (backlog, id) => backlog.tasks.find((t) => t.id === id);

function mustGet(backlog, id) {
  const task = byId(backlog, id);
  if (!task) throw new Error(`unknown task ${id}`);
  return task;
}

function update(backlog, id, patch) {
  return { ...backlog, tasks: backlog.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export const projectOf = (registry, id) => registry.projects.find((p) => p.id === id);

export function projectAuthorized(registry, id) {
  const p = projectOf(registry, id);
  return Boolean(p && p.authorized === true && p.status === 'active');
}

export function leaseActive(task, now) {
  return task.status === 'claimed' && Boolean(task.claim) && new Date(task.claim.leaseUntil) > now;
}

export function activeClaims(backlog, now) {
  return backlog.tasks.filter((t) => leaseActive(t, now));
}

export function depsDone(backlog, task) {
  return task.deps.every((d) => byId(backlog, d)?.status === 'done');
}

// A claimed task whose lease expired is treated as ready again (crashed-run recovery).
export function nextReady(backlog, registry, { project, now, excludeIds = new Set() }) {
  const wip = activeClaims(backlog, now).length;
  if (wip >= registry.policy.maxWip) {
    return { task: null, reason: `WIP limit reached (${wip}/${registry.policy.maxWip})` };
  }
  const candidates = backlog.tasks
    .filter((t) => t.status === 'ready' || (t.status === 'claimed' && !leaseActive(t, now)))
    .filter((t) => !project || t.project === project)
    .filter((t) => !excludeIds.has(t.id))
    .filter((t) => projectAuthorized(registry, t.project) && depsDone(backlog, t))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return candidates.length ? { task: candidates[0] } : { task: null, reason: 'no ready task' };
}

export function claim(backlog, registry, id, by, now, leaseMin = 90) {
  if (!by) throw new Error('claim requires --by <agent-or-run-name>');
  const task = mustGet(backlog, id);
  if (!projectAuthorized(registry, task.project)) {
    throw new Error(`project ${task.project} is not authorized for unattended work`);
  }
  if (leaseActive(task, now) && task.claim.by !== by) {
    throw new Error(`${id} is claimed by ${task.claim.by} until ${task.claim.leaseUntil}`);
  }
  if (!['ready', 'claimed'].includes(task.status)) {
    throw new Error(`${id} is ${task.status} and cannot be claimed`);
  }
  if (!depsDone(backlog, task)) throw new Error(`${id} has unfinished dependencies`);
  const others = activeClaims(backlog, now).filter((t) => t.id !== id).length;
  if (others >= registry.policy.maxWip) {
    throw new Error(`WIP limit reached (${others}/${registry.policy.maxWip})`);
  }
  const leaseUntil = new Date(now.getTime() + leaseMin * MINUTE).toISOString();
  return update(backlog, id, {
    status: 'claimed',
    branch: task.branch ?? branchFor(registry, task),
    claim: { by, at: now.toISOString(), leaseUntil },
  });
}

export function release(backlog, id) {
  const task = mustGet(backlog, id);
  if (task.status !== 'claimed') throw new Error(`${id} is ${task.status}, not claimed`);
  return update(backlog, id, { status: 'ready', claim: null });
}

// Evidence is mandatory: a task cannot reach review without a recorded verification result.
export function submit(backlog, id, { pr, evidence }, now) {
  const task = mustGet(backlog, id);
  if (task.status !== 'claimed') throw new Error(`${id} is ${task.status}; only a claimed task can be submitted`);
  if (!evidence || !evidence.trim()) {
    throw new Error('evidence is required: record the real test/build result, not a promise');
  }
  return update(backlog, id, {
    status: 'in_review',
    claim: null,
    pr: pr ?? task.pr,
    evidence: [...task.evidence, { at: now.toISOString(), text: evidence.trim() }],
  });
}

export function complete(backlog, id, now) {
  const task = mustGet(backlog, id);
  if (task.status !== 'in_review') throw new Error(`${id} is ${task.status}; only an in_review task can be completed`);
  return update(backlog, id, { status: 'done', completedAt: now.toISOString() });
}

export function block(backlog, id, reason) {
  const task = mustGet(backlog, id);
  if (!reason || !reason.trim()) throw new Error('block requires --reason');
  if (task.status === 'done') throw new Error(`${id} is already done`);
  return update(backlog, id, { status: 'blocked', claim: null, blocker: reason.trim() });
}

export function addTask(backlog, registry, input, now) {
  const { project, title, type = 'feature', priority = 3, deps = [], acceptance = [] } = input;
  const p = projectOf(registry, project);
  if (!p) throw new Error(`unknown project ${project}`);
  if (!p.authorized) throw new Error(`project ${project} is not authorized`);
  if (!title || !title.trim()) throw new Error('a title is required');
  if (acceptance.length === 0) throw new Error('at least one --accept criterion is required');
  for (const d of deps) mustGet(backlog, d);
  const used = backlog.tasks
    .filter((t) => t.id.startsWith(`${p.prefix}-`))
    .map((t) => Number(t.id.split('-').pop()));
  const id = `${p.prefix}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')}`;
  const task = {
    id, project, title: title.trim(), type, priority, status: 'ready', deps,
    acceptance, claim: null, branch: null, pr: null, evidence: [], createdAt: now.toISOString(),
  };
  return { backlog: { ...backlog, tasks: [...backlog.tasks, task] }, task };
}

// Cut at a word boundary so branch names never end in half a word.
function slug(s) {
  const full = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (full.length <= 40) return full;
  const head = full.slice(0, 40);
  const cut = head.lastIndexOf('-');
  return cut > 0 ? head.slice(0, cut) : head;
}

export function branchFor(registry, task) {
  return `${registry.policy.branchPrefix}${task.id.toLowerCase()}-${slug(task.title)}`;
}

// The remote branch is the cross-run lock: if `claude/<id>-*` exists on origin, someone already started it.
export function remoteClaimedIds(registry, backlog, remoteBranches) {
  const prefix = registry.policy.branchPrefix;
  const ids = new Set();
  for (const t of backlog.tasks) {
    const stem = `${prefix}${t.id.toLowerCase()}`;
    if (remoteBranches.some((b) => b === stem || b.startsWith(`${stem}-`))) ids.add(t.id);
  }
  return ids;
}
