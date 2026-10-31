import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../lib/cli.mjs';

export const NOW = new Date('2026-11-02T10:00:00.000Z');

export const baseRegistry = () => ({
  version: 1,
  owner: 'tester',
  policy: { maxWip: 2, branchPrefix: 'claude/', autoMerge: false, forcePush: false, productionDeploy: 'requires-approval', newReposPrivate: true },
  projects: [
    { id: 'alpha', prefix: 'A', repo: 'tester/alpha', visibility: 'private', status: 'active', authorized: true, test: 'npm test', notes: '' },
    { id: 'beta', prefix: 'B', repo: null, visibility: null, status: 'out-of-scope', authorized: false, test: null, notes: '' },
  ],
});

export const task = (id, extra = {}) => ({
  id, project: 'alpha', title: `Task ${id}`, type: 'feature', priority: 3, status: 'ready', deps: [],
  acceptance: ['it works'], claim: null, branch: null, pr: null, evidence: [], createdAt: NOW.toISOString(), ...extra,
});

export const baseState = () => ({
  version: 1, updated: NOW.toISOString(), building: 'test factory',
  automation: { scheduled: 'not-configured', note: '' }, verified: [], failed: [], blockers: [], notes: [],
});

// Creates a temp FACTORY_HOME with factory/{registry,backlog,state}.json.
export function makeHome({ registry = baseRegistry(), tasks = [], state = baseState() } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'factory-test-'));
  mkdirSync(join(home, 'factory'));
  const put = (name, data) => writeFileSync(join(home, 'factory', `${name}.json`), JSON.stringify(data, null, 2));
  put('registry', registry);
  put('backlog', { version: 1, tasks });
  put('state', state);
  return home;
}

export const readData = (home, name) => JSON.parse(readFileSync(join(home, 'factory', `${name}.json`), 'utf8'));

export async function cli(home, argv, { now = NOW, lsRemote } = {}) {
  const out = [];
  const err = [];
  const code = await run(argv, {
    home, now: () => now, out: (s) => out.push(s), err: (s) => err.push(s), ...(lsRemote ? { lsRemote } : {}),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
