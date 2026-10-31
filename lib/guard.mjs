// Command guard for the Claude Code PreToolUse hook on Bash.
// It is accident prevention for the autonomy rules, not a security boundary: GitHub-side limits still apply.
// Fail-closed where it parses (git push, git config, gh api): anything it cannot positively classify as safe is blocked.
// Layers: (1) "belt" regexes on the raw text, (2) a quote-aware segment parser for git push / git config / gh api,
// (3) recursion into $(...), `...` and sh -c / bash -c / eval payloads. Matching is case-insensitive because macOS
// resolves `GIT` to git. Known gaps: shell variables inside scripts, aliases from a pre-existing global git config,
// and tools other than Bash.

const ENV = String.raw`(?:[A-Za-z_]\w*=\S*\s+)*`;
const WRAP = String.raw`(?:(?:env|sudo|command|nohup|time|exec)\s+(?:-\S+\s+)*)*`;
const KEYWORDS = String.raw`(?:(?:do|then|else|elif|if|while|until|!)\s+)*`; // `for ...; do git push ...; done` is still a git push
const HEAD = String.raw`^\s*${KEYWORDS}${ENV}${WRAP}${ENV}(?:\S*\/)?`;
const GIT_VALUE_OPTS = 'git-dir|work-tree|namespace|exec-path|super-prefix';
// Alternatives are mutually exclusive (a value-taking option never also matches the generic one, and values never
// start with "-"), so the pattern cannot backtrack exponentially on crafted input.
const GIT_OPTS = String.raw`(?:(?:-C|-c)\s+[^-\s]\S*\s+|--(?:${GIT_VALUE_OPTS})\s+[^-\s]\S*\s+|--(?!(?:${GIT_VALUE_OPTS})\s)[\w-]+(?:=\S+)?\s+|-[pP]\s+)*`;
const rx = (src) => new RegExp(src, 'i');

const SHELL_PAYLOAD = /\b(?:eval|(?:ba|z|da)?sh\s+(?:-\w+\s+)*-\w*c)\s+(["'])([\s\S]*?)\1/gi;
const BACKTICKS = /`([^`]*)`/g;
const HEREDOC = /(<<-?\s*(['"]?)([A-Za-z_]\w*)\2[^\n]*\n)[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g;
const HEREDOC_FULL = /^([^\n]*?)<<-?\s*(['"]?)([A-Za-z_]\w*)\2([^\n]*)\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/gm;
const SHELLS = /\b(?:ba|z|da|k)?sh\b|\beval\b|\bsource\b|\bxargs\b/i;
const INTERPRETERS = /\b(?:python\d?|node|perl|ruby|php|osascript|deno|bun)\b/i;

const PUSH = String.raw`\bgit\s+(?:\S+\s+)*?push\b[^\n;&|]*`;

const FORCE = 'force-push is never allowed';
const DELETE = 'deleting remote branches needs explicit owner approval';
const ALL_REFS = 'pushing all refs or tags is not allowed; push one claude/* branch';

// Merging is reserved for the owner. It opens only when the hook process itself was started with
// FACTORY_ALLOW_MERGE=1 (the owner launches `FACTORY_ALLOW_MERGE=1 claude`). Text inside a command cannot set it,
// and scheduled cloud runs never have it, so unattended runs can never merge.
const MERGE_REASON = 'merging PRs needs explicit owner approval (autoMerge=false); owner sessions start with FACTORY_ALLOW_MERGE=1';

const REGEX_RULES = [
  [/\bgh\s+pr\s+merge\b/, MERGE_REASON],
  [/\bgh\s+repo\s+delete\b/, 'deleting repositories needs explicit owner approval'],
  [/\bgh\s+repo\s+(?:create|edit)\b[^\n;&|]*--(?:public|visibility[=\s]+(?:public|internal))\b/, 'new or changed repos must stay private without owner approval'],
  [/\bvercel\b[^\n;&|]*(?:--prod\b|\bpromote\b)/, 'production deploys need explicit owner approval'],
  [/\bnpm\s+publish\b/, 'publishing packages needs explicit owner approval'],
  [/\bgit\s+(?:\S+\s+)*?commit\b[^\n;&|]*(?:\s--no-ve\w*|\s-[a-zA-Z]*n[a-zA-Z]*\b)/, 'never bypass the pre-commit secret scan'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard destroys work; ask the owner'],
  [/\bgit\s+clean\s+-[a-z]*f/, 'git clean -f deletes untracked files; ask the owner'],
  [/\brm\s+-[a-z]*r[a-z]*\s+(?:\/|~|\$HOME)(?:\s|$)/, 'recursive delete of / or ~ is not allowed'],
  [/--dangerously-skip-permissions/, 'permission bypass flags are not allowed'],
  // Belts: these also catch wrapped or nested forms the segment parser cannot see into.
  [rx(`${PUSH}(?:\\s--force|\\s-[a-z]*f[a-z]*\\b|\\s\\+\\S)`), FORCE],
  [rx(`${PUSH}(?:\\s--delete\\b|\\s-[a-z]*d[a-z]*\\b|\\s:\\S)`), DELETE],
  [rx(`${PUSH}\\s--(?:all|mirror|tags|follow-tags|prune)\\b`), ALL_REFS],
  [rx(`${PUSH}(?:main|master)\\b`), 'direct push to main/master is not allowed: push a claude/* branch and open a PR'],
  // Obfuscation that hides the command from the parsers.
  [/(?:^|\s)\$'/, "ANSI-C quoting ($'...') can hide commands and is not allowed"],
  [/\$\{?\w+\}?\s+(?:push|api)\b/, 'a command taken from a variable cannot be inspected'],
  [/--config-env\b/, 'git --config-env can inject aliases or remotes and is not allowed'],
  [/\bGIT_(?:CONFIG\w*|SSH\w*|DIR|WORK_TREE|EXEC_PATH|ASKPASS)=/, 'git environment overrides are not allowed'],
  [/\bGH_(?:REPO|HOST|TOKEN|ENTERPRISE_TOKEN|CONFIG_DIR)=/, 'gh environment overrides (target repo, host, token) are not allowed'],
].map(([re, reason]) => [new RegExp(re.source, 'i'), reason]);

const stripQuoted = (s) => s.replace(/"[^"]*"|'[^']*'/g, '""');
const deobfuscate = (s) => s.replace(/\\\n/g, ' ').replace(/["'\\]/g, '');
const unquote = (s) => s.replace(/["']/g, ''); // every quote character, so --adm"in" is read as --admin

// Shell-like word splitting: quotes group text and are removed, so  -f title="two words"  is ONE word.
const REDIRECT_ALONE = /^(?:\d*>>?|\d*<|&>>?|\d*[<>]&)$/; // its target is the next word
const REDIRECT_ATTACHED = /^(?:\d*>>?|\d*<|&>>?)\S|^\d*[<>]&(?:\d+|-)$/; // 2>&1, >file, 2>/dev/null, &>file, <file

function tokenize(s) {
  const words = []; // { text, quoted }: a word that contained a quote or an escape is data, never a redirection
  let cur = '';
  let inWord = false;
  let quoted = false;
  let quote = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < s.length) { cur += s[i + 1]; i += 1; } else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; inWord = true; quoted = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; i += 1; inWord = true; quoted = true; continue; }
    if (/\s/.test(c)) {
      if (inWord) { words.push({ text: cur, quoted }); cur = ''; inWord = false; quoted = false; }
      continue;
    }
    cur += c;
    inWord = true;
  }
  if (inWord) words.push({ text: cur, quoted });
  // Redirections are not arguments: `git push origin claude/x 2>&1` must not see "2>" as a refspec.
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const { text, quoted: q } = words[i];
    if (!q && REDIRECT_ALONE.test(text)) { i += 1; continue; }
    if (!q && REDIRECT_ATTACHED.test(text)) continue;
    out.push(text);
  }
  return out;
}

// Heredoc bodies are data, not commands (commit messages and PR bodies routinely contain quotes).
const stripHeredocBodies = (s) => s.replace(HEREDOC, '$1');

// Split on shell control operators outside quotes. Returns null on unbalanced quotes so the caller fails closed.
function splitSegments(command) {
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"') { cur += command[i + 1] ?? ''; i += 1; } else if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') { cur += c + (command[i + 1] ?? ''); i += 1; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '$' && command[i + 1] === '(') { segments.push(cur); cur = ''; i += 1; continue; }
    // `&` inside a redirection (2>&1, &>file, >&2) is not a command separator.
    if (c === '&' && (command[i - 1] === '>' || command[i - 1] === '<' || command[i + 1] === '>')) { cur += c; continue; }
    if ('&|;\n`(){}'.includes(c)) { segments.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (quote) return null;
  segments.push(cur);
  return segments;
}

// Git subcommands that are fine even if the word "push" appears elsewhere on the line (e.g. `git log --grep push`).
const NON_PUSH_GIT = rx(`${HEAD}git\\s+${GIT_OPTS}(?:log|show|diff|status|commit|add|checkout|switch|branch|fetch|pull|merge|rebase|stash|worktree|config|remote|tag|rev-parse|ls-remote|restore|cherry-pick|blame|grep|describe|shortlog|apply|format-patch|init|clone|help)\\b`);
// Same idea for commit: subcommands that may mention the word without being a commit.
const NON_COMMIT_GIT = rx(`${HEAD}git\\s+${GIT_OPTS}(?:log|show|diff|status|add|checkout|switch|branch|fetch|pull|merge|rebase|stash|worktree|config|remote|tag|rev-parse|ls-remote|restore|cherry-pick|revert|blame|grep|describe|shortlog|apply|format-patch|init|clone|help|push)\\b`);
const NON_API_GH = rx(`${HEAD}gh\\s+(?:pr|repo|run|issue|auth|release|workflow|search|status|browse|gist|label|cache|secret|variable|ruleset|extension|alias|config|codespace|ssh-key|gpg-key|project|org|completion|help|version|attestation)\\b`);

const PUSH_LONG_OK = new Set(['--set-upstream', '--quiet', '--verbose', '--progress', '--no-progress', '--porcelain', '--dry-run']);
const PUSH_SHORT_OK = 'uqvn';

// `git [opts] push ...` is only fine as: push [-u|-q|-v...] origin <claude/* refspec>...
function gitPushViolation(segment) {
  const plain = deobfuscate(segment);
  if (!/(?:^|[\s/])git\b/i.test(plain) || !/\bpush\b/i.test(plain)) return null;
  const m = segment.match(rx(`${HEAD}git\\s+${GIT_OPTS}push\\b([\\s\\S]*)$`));
  if (!m) {
    return NON_PUSH_GIT.test(segment) ? null : 'unrecognised git push form: use "git push [-u] origin claude/<branch>"';
  }
  const positionals = [];
  for (const t of tokenize(m[1])) {
    if (t.startsWith('--')) {
      // git accepts any unambiguous prefix of a long option (--del, --forc), so prefixes count too.
      const name = t.split('=')[0];
      const abbrev = (opt) => name.length >= 4 && opt.startsWith(name);
      if (name.startsWith('--force') || abbrev('--force-with-lease') || abbrev('--force-if-includes')) return FORCE;
      if (abbrev('--delete')) return DELETE;
      if (['--all', '--mirror', '--tags', '--follow-tags', '--prune'].some(abbrev)) return ALL_REFS;
      if (!PUSH_LONG_OK.has(name)) return `unrecognised git push option ${name} (allowed: ${[...PUSH_LONG_OK].join(', ')})`;
    } else if (t.startsWith('-') && t.length > 1) {
      for (const c of t.slice(1)) {
        if (c === 'f') return FORCE;
        if (c === 'd') return DELETE;
        if (!PUSH_SHORT_OK.includes(c)) return `unrecognised git push flag -${c} (allowed: -u -q -v -n)`;
      }
    } else {
      positionals.push(t);
    }
  }
  const [remote, ...refspecs] = positionals;
  const explicit = 'git push must name origin and an explicit claude/* branch (never main/master or other refs)';
  if (remote !== 'origin' || refspecs.length === 0) return explicit;
  for (const spec of refspecs) {
    if (spec.startsWith('+')) return FORCE;
    if (spec.startsWith(':')) return DELETE;
    const dest = (spec.includes(':') ? spec.slice(spec.lastIndexOf(':') + 1) : spec).replace(/^refs\/heads\//, '');
    if (!dest) return DELETE;
    if (!dest.startsWith('claude/')) return explicit;
  }
  return null;
}

const NO_VERIFY = 'never bypass the pre-commit secret scan';
const COMMIT_VALUE_FLAGS = 'mFCcuSt'; // in a cluster, everything after one of these is that flag's value

// git accepts bundled short flags (-anm) and unambiguous prefixes of long options (--no-veri), and a value-taking
// option can swallow the next word (--message -- --no-verify), so value positions are NOT skipped: every word is
// checked. A message that literally reads like the flag is blocked too; rephrase it.
function commitViolation(segment) {
  const plain = deobfuscate(segment);
  if (!/(?:^|[\s/])git\b/i.test(plain) || !/\bcommit\b/i.test(plain)) return null;
  const m = segment.match(rx(`${HEAD}git\\s+${GIT_OPTS}commit\\b([\\s\\S]*)$`));
  if (!m) return NON_COMMIT_GIT.test(segment) ? null : 'unrecognised git commit form: use "git commit [-a] -m <message>" or -F';
  for (const t of tokenize(m[1])) {
    if (t.startsWith('--')) {
      const name = t.split('=')[0];
      if (name.length >= 6 && '--no-verify'.startsWith(name)) return NO_VERIFY;
    } else if (t.startsWith('-') && t.length > 1) {
      for (const c of t.slice(1)) {
        if (c === 'n') return NO_VERIFY;
        if (COMMIT_VALUE_FLAGS.includes(c)) break;
      }
    }
  }
  return null;
}

// Aliases, rewritten remotes and replaced hooks can hide a push or skip the secret scan, so config that could do
// that is blocked: `git -c <key>` outside a small allowlist and writes of risky keys with `git config`.
const SAFE_C_KEYS = /^(?:user\.name|user\.email|core\.editor|commit\.gpgsign|safe\.directory|advice\.[\w.]+|color\.[\w.]+)$/;
// `git config` writes are allowlisted: anything else (aliases, remotes, include.*, fsmonitor, pagers...) is refused.
const SAFE_CONFIG_WRITE = /^(?:user\.name|user\.email|safe\.directory|commit\.gpgsign|init\.defaultbranch|pull\.rebase|core\.autocrlf|advice\.[\w.]+|color\.[\w.]+)$/;
const CONFIG_READ_FLAGS = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin']);
const HOOKS_DIR = 'scripts/hooks';

function gitConfigViolation(segment) {
  const opts = segment.match(rx(`${HEAD}git\\s+(${GIT_OPTS})`));
  if (!opts) return null;
  for (const c of opts[1].matchAll(/-c\s+(\S+)/g)) {
    const [key, ...value] = unquote(c[1]).split('=');
    const k = key.toLowerCase();
    if (k === 'core.hookspath' && value.join('=') === HOOKS_DIR) continue;
    if (!SAFE_C_KEYS.test(k)) return `git -c ${k} is not allowed: aliases, remotes and hooks can hide a push or skip the secret scan`;
  }
  const cfg = segment.match(rx(`${HEAD}git\\s+${GIT_OPTS}config\\b([\\s\\S]*)$`));
  if (!cfg) {
    const plain = deobfuscate(segment);
    const hidden = /(?:^|[\s/])git\b/i.test(plain) && /\bconfig\b/i.test(plain) && !NON_PUSH_GIT.test(segment);
    return hidden ? 'unrecognised git config form: use "git config <key> <value>"' : null;
  }
  const tokens = tokenize(cfg[1]);
  if (tokens.some((t) => CONFIG_READ_FLAGS.has(t))) return null;
  const keyIndex = tokens.findIndex((t) => !t.startsWith('-'));
  if (keyIndex === -1) return null;
  const key = tokens[keyIndex].toLowerCase();
  if (key === 'core.hookspath') {
    return tokens[keyIndex + 1] === HOOKS_DIR ? null : `git config core.hooksPath may only be set to ${HOOKS_DIR}`;
  }
  return SAFE_CONFIG_WRITE.test(key) ? null : `git config ${key} is not allowed (writes are limited to an allowlist)`;
}

// Balanced $( ... ) scanner. Returns the payloads (including nested ones) or null when a $( is never closed.
function substitutions(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '$' || s[i + 1] !== '(') continue;
    let depth = 0;
    let j = i + 1;
    for (; j < s.length; j += 1) {
      if (s[j] === '(') depth += 1;
      else if (s[j] === ')' && (depth -= 1) === 0) break;
    }
    if (depth !== 0) return null;
    out.push(s.slice(i + 2, j));
  }
  for (const m of s.matchAll(BACKTICKS)) out.push(m[1]);
  return out;
}

// A heredoc body is data for most commands, but code when it feeds a shell or an interpreter.
function heredocCodeViolation(rawCommand, opts, depth) {
  for (const m of rawCommand.matchAll(HEREDOC_FULL)) {
    const header = `${m[1]} ${m[4]}`; // both sides of the operator: `bash <<EOF` and `cat <<EOF | bash`
    if (INTERPRETERS.test(header)) return 'a heredoc fed to an interpreter cannot be inspected';
    if (SHELLS.test(header)) {
      const reason = check(m[5], opts, depth + 1);
      if (reason) return reason;
    }
  }
  return null;
}

const API_BODY_FLAGS = new Set(['-f', '-F', '--raw-field', '--field', '--input']);
const API_VALUE_FLAGS = new Set(['-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview']);
const API_BOOL_FLAGS = new Set(['--paginate', '--slurp', '--silent', '-i', '--include', '--verbose']);

// `gh pr merge` with the owner gate open may only be a plain merge: no --admin (skips protections),
// --delete-branch (deletes the head branch) or --auto (merges later, unattended).
const MERGE_BLOCKED_FLAGS = new Set(['--admin', '--delete-branch', '--auto', '--disable-auto']);
// The owner account (GitHub user or org) whose repos an owner session may merge in. It comes from
// FACTORY_MERGE_OWNER in the hook's environment, else from factory/registry.json `owner` (see guard-bash.mjs).
// Without a valid owner the gate cannot scope merges, so they stay blocked even when FACTORY_ALLOW_MERGE=1.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

// Detection also runs on a quote-free copy, so  gh pr "merge" 12  and  --adm"in"  are read as the shell reads them.
function mergeViolation(segment, mergeAllowed, owner) {
  const bare = stripQuoted(segment);
  const flat = deobfuscate(segment);
  const spread = /(?:^|[\s/])gh\b/i.test(bare) && /\bpr\b/i.test(bare) && /\bmerge\b/i.test(bare);
  const m = flat.match(rx(`${HEAD}gh\\s+pr\\s+merge\\b([\\s\\S]*)$`));
  if (!spread && !m) return null;
  if (!mergeAllowed) return MERGE_REASON;
  if (!owner) return 'the merge gate is open but no owner is configured: run "node bin/factory.mjs init"';
  if (!m) return 'unrecognised gh pr merge form: write it as "gh pr merge <n> --squash"';
  const words = tokenize(m[1]);
  let squash = false;
  let repo;
  for (let i = 0; i < words.length; i += 1) {
    const t = words[i];
    if (t.startsWith('--')) {
      const name = t.split('=')[0];
      if (MERGE_BLOCKED_FLAGS.has(name)) return `gh pr merge ${name} is not allowed even in an owner session`;
      if (name === '--squash') squash = true;
      if (name === '--repo') repo = t.includes('=') ? t.slice(t.indexOf('=') + 1) : words[i + 1];
    } else if (t.startsWith('-') && t.length > 1) {
      // Short flags the way pflag reads them: -sd is two flags, -R takes the rest of the word or the next word.
      for (let k = 1; k < t.length; k += 1) {
        if (t[k] === 'd') return 'gh pr merge -d (--delete-branch) is not allowed even in an owner session';
        if (t[k] === 's') squash = true;
        if (t[k] === 'R') { repo = t.slice(k + 1) || words[i + 1]; break; }
      }
    }
  }
  // The target repo must be named explicitly: a bare merge would use whatever repo the shell happens to be in.
  if (repo === undefined || !repo.startsWith(`${owner}/`)) {
    return `an owner session must name the repo explicitly: gh pr merge <n> --squash --repo ${owner}/<name>`;
  }
  return squash ? null : 'owner-session merges must use --squash';
}

// Reads (GET) are fine. The only writes allowed through `gh api` are creating a pull request and commenting on one.
function ghApiViolation(segment, mergeAllowed, owner) {
  const plain = deobfuscate(segment);
  if (!/(?:^|[\s/])gh\b/i.test(plain) || !/\bapi\b/i.test(plain)) return null;
  const m = segment.match(rx(`${HEAD}gh\\s+api\\b([\\s\\S]*)$`));
  if (!m) return NON_API_GH.test(segment) ? null : 'unrecognised gh api form: use "gh api <endpoint> [flags]"';
  const tokens = tokenize(m[1]);
  const positionals = [];
  let method;
  let hasBody = false;
  let usesInput = false;
  const fields = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t.startsWith('-')) { positionals.push(t); continue; }
    const eq = t.startsWith('--') ? t.indexOf('=') : -1;
    const flag = eq === -1 ? t : t.slice(0, eq);
    const inline = eq === -1 ? undefined : t.slice(eq + 1);
    if (flag === '-X' || flag === '--method') method = (inline ?? tokens[(i += 1)] ?? '').toUpperCase();
    else if (/^-X./.test(flag)) method = flag.slice(2).toUpperCase();
    else if (API_BODY_FLAGS.has(flag)) {
      hasBody = true;
      if (flag === '--input') usesInput = true; // a body we cannot see
      else fields.push(inline ?? tokens[i + 1] ?? '');
      if (inline === undefined) i += 1;
    } else if (/^-[fF]./.test(flag)) { hasBody = true; fields.push(flag.slice(2)); } // glued form such as -fbase=main
    else if (API_VALUE_FLAGS.has(flag)) { if (inline === undefined) i += 1; }
    else if (!API_BOOL_FLAGS.has(flag)) return `unrecognised gh api flag ${flag}`;
  }
  if (positionals.length !== 1) return 'gh api must have exactly one endpoint argument';
  method ??= hasBody ? 'POST' : 'GET';
  if (method === 'GET') return null;
  const path = positionals[0].split('?')[0].replace(/^\//, '');
  if (method === 'POST' && /^repos\/[^/]+\/[^/]+\/(?:pulls|issues\/\d+\/comments)$/.test(path)) return null;
  // Fixing the title/body of a PR the platform opened with a placeholder; nothing else (no state, no base).
  const keys = fields.map((f) => f.split('=')[0]);
  if (method === 'PATCH' && /^repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(path) && !usesInput
    && keys.length > 0 && keys.every((k) => k === 'title' || k === 'body')) return null;
  if (mergeAllowed && owner && method === 'PUT' && !usesInput && fields.includes('merge_method=squash')
    && new RegExp(`^repos/${owner}/[^/]+/pulls/\\d+/merge$`).test(path)) return null;
  return `gh api ${method} ${path} is blocked: writes through the API are limited to creating a PR, commenting on it and editing its title/body`;
}

export function check(rawCommand, { env = process.env, owner = env.FACTORY_MERGE_OWNER } = {}, depth = 0) {
  const mergeAllowed = env.FACTORY_ALLOW_MERGE === '1'; // exact value only; read from the hook process, never from the command
  const scope = OWNER_RE.test(owner ?? '') ? owner : null; // a malformed owner counts as none
  const opts = { env, owner: scope };
  // Belts see the raw text and a quote-free copy, so g"i"t push is read as git push. Heredoc bodies are included
  // on purpose: prose that spells out a forbidden command is blocked too (rephrase it).
  if (rawCommand.length > 100_000) return 'command too long to inspect: split it up';
  const flat = deobfuscate(rawCommand);
  for (const [re, reason] of REGEX_RULES) {
    if (mergeAllowed && reason === MERGE_REASON) continue; // the segment parser still polices the merge flags
    if (re.test(rawCommand) || re.test(flat)) return reason;
  }

  const command = stripHeredocBodies(rawCommand);
  const segments = splitSegments(command);
  if (!segments) return 'unbalanced quotes: rewrite the command so it can be inspected';
  for (const segment of segments) {
    const reason = gitConfigViolation(segment) ?? commitViolation(segment) ?? gitPushViolation(segment)
      ?? mergeViolation(segment, mergeAllowed, scope) ?? ghApiViolation(segment, mergeAllowed, scope);
    if (reason) return reason;
  }

  if (depth >= 3) return null;
  const heredoc = heredocCodeViolation(rawCommand, opts, depth);
  if (heredoc) return heredoc;
  const subs = substitutions(command);
  if (!subs) return 'unbalanced $( ... ): rewrite the command so it can be inspected';
  const shellPayloads = [...command.matchAll(SHELL_PAYLOAD)].map((m) => m[2]);
  if (shellPayloads.some((p) => p.includes('\\'))) return 'an escaped sh -c / eval payload cannot be inspected reliably';
  for (const payload of [...shellPayloads, ...subs]) {
    const reason = check(payload, opts, depth + 1);
    if (reason) return reason;
  }
  return null;
}
