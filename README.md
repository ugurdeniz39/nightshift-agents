# Nightshift

**Scheduled Claude Code agents that take one task from your backlog and open a pull request with real test evidence, and never merge, deploy or force-push on their own.**

[![ci](https://github.com/yuroka-studio/nightshift-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/yuroka-studio/nightshift-agents/actions/workflows/ci.yml)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen)
![node >= 22](https://img.shields.io/badge/node-%3E%3D22-informational)

> Unofficial community project. Not affiliated with or endorsed by Anthropic.

Nightshift is a small, file-based "software factory" for running [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) unattended against a backlog. It is about 1,500 lines of dependency-free Node, one skill, three agent definitions and a Bash guard hook. It was built by running real unattended agents and writing down what broke. The [field report](docs/field-report-001.md) has the numbers.

## Why

When an agent works while you sleep, the hard part is not writing the code. It is:

- picking **which** task to do, and making sure two runs never pick the same one;
- proving the work was **tested** before anything is called done;
- making sure "unattended" never turns into "merged to main" or "deployed";
- leaving a trail that the next session, or you over coffee, can pick up from.

## What you get

| Piece | What it does |
|---|---|
| `factory` CLI | Backlog with acceptance criteria, dependencies, priorities, a WIP limit and claim leases. Plain JSON in git, no database. |
| Remote-branch lock | `next --check-remote` skips any task whose `claude/<id>-*` branch already exists on origin. It fails closed if origin can't be reached. |
| Evidence gate | `submit` refuses to move a task to review without the real test or build output. |
| `report` | Daily report. A task is listed as shipped only with a PR URL and passing evidence dated that day. Secrets are redacted. |
| `doctor` | Self-check of the tools and the factory data. |
| `deliver-task` skill | The one-task loop: claim, branch, implement, verify, review, PR, record. |
| Agents | `implementer` and `reviewer` (Sonnet), `architect` (Opus, for rare hard calls). |
| Guard hook | PreToolUse hook on Bash. It blocks force-push, pushes to main, branch deletion, merges, publishing, production deploys and history-destroying commands. Merging opens only in a session the owner started with `FACTORY_ALLOW_MERGE=1 FACTORY_MERGE_OWNER=<owner>`. |
| Secret scan | Pre-commit hook over staged changes. It reports the file and the pattern, never the value. |
| CI | GitHub Actions running the test suite. |

## How a run works

```
scheduler (cron, UTC)
  └─ fresh cloud session clones the repo
       ├─ factory next --check-remote   picks the highest-priority task nobody has started
       ├─ factory claim T-007           takes a lease, pushes claude/t-007-* (that branch is the lock)
       ├─ implement + run the tests     at most 3 fix attempts, else `factory block` with the reason
       ├─ reviewer agent                independent review of the diff
       ├─ PR via REST + factory submit  real test output recorded in the backlog
       └─ stop. A human merges.
```

## Quickstart

```sh
# 1. Create a repo from this template (or clone it), then inside it:
npm test                                   # zero dependencies, no install step
git config core.hooksPath scripts/hooks    # turns on the pre-commit secret scan
node bin/factory.mjs init --owner <you> --repo <you>/<repo>
node bin/factory.mjs doctor

# 2. Add work. Every task needs at least one checkable acceptance criterion.
node bin/factory.mjs add "Add a /health endpoint" --project self \
  --accept "GET /health returns 200 with {status:'ok'}" --accept "npm test passes"
```

3. Start Claude Code **inside the repo** (`cd <repo> && claude`) and say *"deliver the next task"*.
4. Make it unattended. In Claude Code, run `/schedule` with the prompt in [`examples/routine-prompt.md`](examples/routine-prompt.md), or post [`examples/routine.json`](examples/routine.json) through the routines API. Cloud runs need GitHub connected to Claude Code on the web: the Claude GitHub App, restricted to this repo, is the narrowest option.
5. In the morning: `node bin/factory.mjs report`, review the PR, merge it yourself.

Nightshift lives **inside the repository it works on**: one repo per scheduled task. Multi-repo support is on the roadmap.

## Gotchas we hit, so you don't have to

1. **Hooks load only when Claude starts inside the repo.** Start Claude from `~` and the guard is simply not there, and nothing tells you.
2. **Permission `deny` rules beat hooks.** A `deny` on `gh pr merge` turns any hook-based merge gate into dead code.
3. **The platform may open the PR for you.** Pushing a `claude/*` branch from a cloud session opened a PR with a title made from the branch name and an empty body, so our own create call got HTTP 422. The skill now edits the title and body instead.
4. **`gh pr create/view/list` fail inside cloud runs** (GraphQL 403, per the docs). Use `gh api` REST calls.
5. **Test your guard against the exact commands your skill prescribes.** Our first unattended run was blocked 7 times by our own guard: `2>&1` read as a refspec, quoted values with spaces split into words, no way to edit a PR.
6. **Free private repos have no branch protection** (the API returns 403). Your guard and your review are all that stand between an agent and `main`.
7. **Shared state files conflict across parallel PRs.** Task PRs touch only their own backlog entry; checkpoints go in separate PRs.

## What it guarantees, and what it doesn't

**Covered by tests:** tasks without acceptance criteria are rejected; a claimed task can't be taken by another run until its lease expires; nothing reaches review without evidence; the report never lists unverified work as shipped; the guard blocks the forms of force-push, main push, branch deletion, merge, publish, deploy, reset/clean and config injection listed in [`test/`](test).

**Not guaranteed:** the guard is **accident prevention, not a security boundary**. It does not inspect scripts that run git internally, aliases from an existing global git config, `curl`, or tools other than Bash, and a hook that crashes lets the command through. It shrinks what a confused agent can break; it will not stop a determined one. Use GitHub branch protection wherever your plan allows it.

## Evidence, not vibes

[Field report #001](docs/field-report-001.md): the scheduler fired a one-shot task. It found 4 branches already in flight, took the only free task, wrote the code and 6 tests, recorded the evidence and finished in 133 seconds over 29 turns. The suite passed 59/59, and was re-run independently. One run is not a track record: more reports will follow, failures included.

## Prior art

If you only want a command guard for interactive use, there are good focused options, for example [git-guardrails-claude-code](https://openskillindex.com/skills/mattpocock-skills-git-guardrails-claude-code) and the plugins described in [this roundup](https://dev.to/luijhy_michaelguerraflo/3-claude-code-hooks-that-prevent-disasters-with-code-178b). Nightshift's guard is written for *unattended* runs:

- a merge gate tied to the owner's launch environment;
- a `gh api` write policy that only lets an agent create, comment on and retitle PRs;
- parsing that understands quotes, heredocs and command substitution.

It also ships with the backlog, lock and evidence loop around it.

## Layout

```
bin/factory.mjs                 CLI entry point (node bin/factory.mjs help)
lib/                            tasks, store, guard, secret scan; one file per command in lib/commands/
factory/                        registry.json (owner, policy, projects), backlog.json, state.json
.claude/                        settings (permissions + hook), agents, the deliver-task skill
scripts/hooks/                  guard-bash.mjs (Claude hook), pre-commit + secret-scan.mjs (git hook)
docs/                           architecture, runbook, field reports
examples/                       scheduled-task body and prompt
```

## Roadmap

- `factory reconcile`: mark tasks done when their PR merges.
- `factory reap`: release expired claims.
- Multi-repo: one scheduled task per repo with per-repo backlogs.
- A one-line installer for existing repos.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT © 2026 Yuroka Studio. "Claude" and "Claude Code" are trademarks of Anthropic.
