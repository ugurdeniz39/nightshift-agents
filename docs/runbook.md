# Runbook

## Setup (once per clone)
```
npm test
git config core.hooksPath scripts/hooks
node bin/factory.mjs init --owner <you> --repo <you>/<repo>
node bin/factory.mjs doctor
```
Always start Claude Code **inside the repo**. Project settings, and with them the guard hook, only load from the project root.

## Daily use
| Want | Command |
| --- | --- |
| Where did we stop? | `node bin/factory.mjs resume` |
| Overview | `node bin/factory.mjs status` |
| Add work | `node bin/factory.mjs add "<title>" --project self --accept "<criterion>" [--accept ...] [--priority 1] [--dep T-001]` |
| The queue | `node bin/factory.mjs list --status ready` |
| Deliver one task | ask Claude: "deliver the next task" |
| What shipped today | `node bin/factory.mjs report` (`--write` saves `reports/<date>.md`) |
| Health check | `node bin/factory.mjs doctor` |

A task is *delivered* when a PR exists, its tests passed and the real output was recorded with `factory submit --evidence`. It is *done* only after a human merges it (`factory complete <id>`).

## Scheduled runs
Create a scheduled task with `/schedule` in Claude Code, or through the routines API with [`examples/routine.json`](../examples/routine.json). Use one repository source and the prompt in [`examples/routine-prompt.md`](../examples/routine-prompt.md). Cron is in UTC; pick off-minutes (e.g. `17 7 * * 1-5`).

A schedule counts as working only once a scheduled fire has produced a PR you checked: look at the run's log, re-run the tests on the branch, confirm CI. Then record it with `factory checkpoint --automation verified --automation-note "<what you checked>"`.

## Owner-only steps
- **GitHub access for cloud runs:** connect GitHub to Claude Code on the web. The Claude GitHub App restricted to this repo is the narrowest option.
- **Merging:** in the GitHub UI, or let a session you started inside the repo with `FACTORY_ALLOW_MERGE=1 FACTORY_MERGE_OWNER=<you> claude` squash-merge PRs with green CI. Unverified end to end: the environment variables open the *guard*, but Claude Code's own permission layer (for example the auto-mode classifier) can still refuse or prompt for a merge; on 2026-10-31 it refused one.
- **Production deploys, rotating keys, billing:** always yours.
- **`workflow` token scope:** if pushing `.github/workflows/*` is rejected, run `gh auth refresh -s workflow`.

## Recovery
- **Stale claim (crashed run):** the lease expires on its own and `next` offers the task again.
- **Duplicate-work worry:** `git ls-remote --heads origin 'claude/*'` shows what is in flight.
- **Blocked task:** `node bin/factory.mjs list --status blocked`, read the reason, fix it, then `factory release <id>` or re-add the task.
- **The guard blocks a legitimate command:** the message names the rule. Rephrase the command, or fix the guard with a test. Never bypass it.
