import { parseArgs } from 'node:util';
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { factoryHome, load, save } from './store.mjs';

const COMMANDS_DIR = new URL('./commands/', import.meta.url);
const GLOBAL_OPTIONS = { json: { type: 'boolean' } };

// Exit codes: 0 ok, 1 error, 3 "nothing to do" (e.g. `next` with an empty queue).
export const EXIT = { OK: 0, ERROR: 1, NOTHING: 3 };

export function listRemoteBranches(home) {
  const out = execFileSync('git', ['ls-remote', '--heads', 'origin', 'claude/*'], {
    cwd: home, encoding: 'utf8', timeout: 20_000,
  });
  return out.split('\n').filter(Boolean).map((l) => l.split('\t')[1].replace('refs/heads/', ''));
}

function helpText() {
  const dir = fileURLToPath(COMMANDS_DIR);
  const names = readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();
  return Promise.all(names.map(async (n) => {
    const mod = await import(new URL(`${n}.mjs`, COMMANDS_DIR).href);
    return `  ${n.padEnd(12)} ${mod.summary ?? ''}`;
  })).then((lines) => ['usage: factory <command> [options]', '', 'commands:', ...lines].join('\n'));
}

// Each command is lib/commands/<name>.mjs exporting `summary`, `options` (util.parseArgs shape) and `run(ctx)`.
export async function run(argv, env = {}) {
  const home = env.home ?? factoryHome();
  // Wrapped so a command that does `return ctx.out(...)` can never leak a write()'s return value as its exit code.
  const rawOut = env.out ?? ((s) => process.stdout.write(`${s}\n`));
  const rawErr = env.err ?? ((s) => process.stderr.write(`${s}\n`));
  const out = (s) => { rawOut(s); };
  const err = (s) => { rawErr(s); };
  const [name, ...rest] = argv;

  if (!name || name === 'help' || name === '--help') {
    out(await helpText());
    return EXIT.OK;
  }
  if (!/^[a-z][a-z-]*$/.test(name) || !existsSync(new URL(`${name}.mjs`, COMMANDS_DIR))) {
    err(`error: unknown command "${name}". Run "factory help".`);
    return EXIT.ERROR;
  }

  try {
    const mod = await import(new URL(`${name}.mjs`, COMMANDS_DIR).href);
    const { values, positionals } = parseArgs({
      args: rest, options: { ...GLOBAL_OPTIONS, ...(mod.options ?? {}) }, allowPositionals: true, strict: true,
    });
    const ctx = {
      args: values, pos: positionals, home, out, err,
      now: env.now ?? (() => new Date()),
      lsRemote: env.lsRemote ?? (() => listRemoteBranches(home)),
      load: () => load(home),
      save: (key, data) => save(home, key, data),
    };
    return (await mod.run(ctx)) ?? EXIT.OK;
  } catch (e) {
    err(`error: ${e.message}`);
    return EXIT.ERROR;
  }
}
