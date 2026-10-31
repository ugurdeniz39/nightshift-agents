import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const summary = 'Set the owner and register this repo: factory init --owner <github-user> --repo <owner>/<name> [--test "npm test"] [--visibility public|private]';
export const options = {
  owner: { type: 'string' },
  repo: { type: 'string' },
  test: { type: 'string' },
  visibility: { type: 'string' },
};

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
const PULLS_RULE = /^Bash\(gh api repos\/[^/]+\/[^/]+\/pulls \*\)$/;

// Idempotent: re-running replaces the owner, the "self" project and this repo's PR allow rule.
export function run(ctx) {
  const { owner, repo } = ctx.args;
  if (!owner || !OWNER.test(owner)) throw new Error('--owner must be a GitHub user or organization name');
  const m = REPO.exec(repo ?? '');
  if (!m) throw new Error('--repo must look like owner/name');
  if (m[1] !== owner) throw new Error('--repo must belong to --owner');
  const visibility = ctx.args.visibility ?? 'private';
  if (!['public', 'private'].includes(visibility)) throw new Error('--visibility must be public or private');

  const { registry } = ctx.load();
  const self = {
    id: 'self', prefix: 'T', repo, visibility, status: 'active', authorized: true,
    test: ctx.args.test ?? 'npm test', notes: 'This repository, registered by factory init.',
  };
  ctx.save('registry', { ...registry, owner, projects: [self, ...registry.projects.filter((p) => p.id !== 'self')] });

  // Let the PR REST calls for this repo run without a permission prompt (scheduled runs cannot answer prompts).
  const settingsPath = join(ctx.home, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const rule = `Bash(gh api repos/${repo}/pulls *)`;
  const allow = (settings.permissions?.allow ?? []).filter((r) => !PULLS_RULE.test(r));
  settings.permissions = { ...settings.permissions, allow: [...allow, rule] };
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  ctx.out(`initialized: owner ${owner}, project "self" -> ${repo} (${visibility}), allowed ${rule}`);
}
