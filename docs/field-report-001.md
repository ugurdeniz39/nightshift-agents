# Field report #001: the first unattended run

**Date:** 2026-10-30. **Setup:** one private repository with the Nightshift files in it, a one-shot scheduled Claude Code task on Anthropic's cloud, model Sonnet, prompt as in [`examples/routine-prompt.md`](../examples/routine-prompt.md). The guard hook was active in the cloud session (project settings load from the repo root). Nobody was watching.

## Timeline

Times are relative to the scheduler firing.

| t | What happened |
|---|---|
| 0 s | Scheduler fires. Sandbox allocated, repository cloned, Claude Code started (about 7 s total). |
| ~10 s | Reads `CLAUDE.md` and the `deliver-task` skill, runs `factory resume`. |
| ~15 s | `factory next --check-remote`: four `claude/*` branches already exist on origin from earlier work, so it picks the only free task (priority 1, no dependencies). |
| ~35 s | Claims the task and pushes `claude/<id>-<slug>`. The pushed branch is the lock. |
| ~60 s | Implementation plus 6 new tests written; the suite passes, 59/59. |
| ~70-120 s | PR step. The REST create call returns **HTTP 422 "a pull request already exists"**: the platform had already opened one when the branch was pushed, with a title made from the branch name and an empty body. The agent reuses it, as the skill says. |
| 133 s | Evidence recorded with `factory submit` and pushed. Final message, status `success`, 29 turns. |

## The 7 blocks: all false positives from our own guard

| Count | Cause | What the agent did |
|---|---|---|
| 3 | `git push ... 2>&1 \| tail -1`: the redirection `2>` was read as a refspec, which is not `claude/*`, so the push was blocked. | Re-ran the push on its own line. |
| 3 | `gh api ... -f title="two words (T-002)"`: the tokenizer split the quoted value, then complained about a lone `-` flag and an extra endpoint argument. | Quoted each whole argument: `-f 'title=...'`. |
| 1 | It wanted to fix the placeholder PR title and body, but `PATCH` was not an allowed API write. | Left the PR as the platform made it. |

The agent recovered every time without human help. It still cost turns, and the PR ended up with no description. The lead session fixed the title and body afterwards.

## Independent verification

The lead session did not trust the run's own claims. It re-ran the test suite on the branch (59/59), ran the new command against real data, read the diff and confirmed CI was green before the PR was merged.

## Fixes that came out of it

- The guard's tokenizer is now a shell-like word splitter: quotes group text and are removed, and redirection words (`2>&1`, `>file`) are not arguments. A word that contained a quote is data, never a redirection.
- `PATCH` on a PR is allowed for `title` and `body` only, never `state` or `base`.
- The skill tells runs to edit an existing PR instead of opening a second one.
- New tests reproduce each blocked command.

## What this run did not prove

- **Creating a PR through REST from a cloud run.** The 422 shows the call was authorized and reached GitHub, but the PR itself was created by the platform.
- **Reliability.** n = 1. Long tasks, a reclaimed VM mid-task and permission prompts in auto mode are untested.
- **Recurring schedules.** This was a one-shot.

## Lessons

1. Run your guard against the exact commands your skill tells agents to type, before the first unattended run.
2. Hooks load only from the project root; check them in the environment that will actually run.
3. Permission `deny` rules win over hooks; a deny can silently disable a hook-based gate.
4. Assume the platform may create artifacts (PRs) on its own, and make every step idempotent.
5. Verify independently. The run's report was accurate this time, and checking it is what lets you know that.
