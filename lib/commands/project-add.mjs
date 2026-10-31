export const summary = 'Register a new project: factory project-add --id x --prefix X --repo owner/name [--test "cmd"]';
export const options = {
  id: { type: 'string' },
  prefix: { type: 'string' },
  repo: { type: 'string' },
  visibility: { type: 'string' },
  test: { type: 'string' },
  notes: { type: 'string' },
};

export function run(ctx) {
  const a = ctx.args;
  const { registry } = ctx.load();
  if (!a.id || !a.prefix || !a.repo) throw new Error('--id, --prefix and --repo are required');
  if (!/^[a-z][a-z0-9-]*$/.test(a.id)) throw new Error('--id must be lowercase letters, digits and dashes');
  if (!/^[A-Z]{1,5}$/.test(a.prefix)) throw new Error('--prefix must be 1-5 capital letters');
  if (registry.projects.some((p) => p.id === a.id || p.prefix === a.prefix)) {
    throw new Error('a project with that id or prefix already exists');
  }
  const visibility = a.visibility ?? 'private';
  if (registry.policy.newReposPrivate && visibility !== 'private') {
    throw new Error('policy.newReposPrivate is on: new projects must be private');
  }
  const project = {
    id: a.id, prefix: a.prefix, repo: a.repo, visibility, status: 'active', authorized: true,
    test: a.test ?? null, notes: a.notes ?? 'created by the factory',
  };
  ctx.save('registry', { ...registry, projects: [...registry.projects, project] });
  ctx.out(`registered ${a.id} (${a.prefix}-NNN) -> ${a.repo} [${visibility}]`);
}
