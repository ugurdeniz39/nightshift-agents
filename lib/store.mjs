import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = { registry: 'registry.json', backlog: 'backlog.json', state: 'state.json' };

export function factoryHome() {
  return process.env.FACTORY_HOME ?? fileURLToPath(new URL('..', import.meta.url));
}

const pathOf = (home, key) => join(home, 'factory', FILES[key]);

export function load(home) {
  const out = {};
  for (const key of Object.keys(FILES)) {
    try {
      out[key] = JSON.parse(readFileSync(pathOf(home, key), 'utf8'));
    } catch (e) {
      throw new Error(`cannot read factory/${FILES[key]}: ${e.message}`);
    }
  }
  return out;
}

// Write-then-rename so an interrupted run never leaves a half-written state file.
export function save(home, key, data) {
  const target = pathOf(home, key);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, target);
}
