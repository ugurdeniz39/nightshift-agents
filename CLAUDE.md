# Nightshift

Instructions for Claude Code in this repository. State lives in git files, not in chat history. Start every session with:

```
node bin/factory.mjs resume
```

Write code, docs, commits and PRs in English unless the owner says otherwise. Reply to the owner in their language.

## Files that matter
- `factory/registry.json`: owner, policy, and the projects you may work on. Only `authorized: true` and `status: active` projects count. Set up with `node bin/factory.mjs init`.
- `factory/backlog.json`: tasks with acceptance criteria, dependencies, claim leases, PR links and evidence.
- `factory/state.json`: checkpoint. What is being built, what is verified, what failed, blockers, automation state.
- `docs/architecture.md` explains decisions; `docs/runbook.md` covers operations; `docs/field-report-*.md` record real runs.

## CLI (`node bin/factory.mjs <command>`, `help` lists all)
init, status, list, add, next, claim, release, submit, complete, block, checkpoint, resume, report, doctor, project-add. A new command is a new file `lib/commands/<name>.mjs` plus a test; never edit `lib/cli.mjs` for it.

## Delivery loop
Follow the `deliver-task` skill. One task = one branch `claude/<id>-<slug>` = one PR. The pushed branch is the cross-run lock.

## Hard rules
- Never force-push, delete remote branches, merge PRs, push to main/master, deploy to production, publish packages, or make a repo public. `scripts/hooks/guard-bash.mjs` blocks the obvious forms; never look for ways around it.
- Merging has one exception: a session the owner started inside this repo with `FACTORY_ALLOW_MERGE=1 FACTORY_MERGE_OWNER=<owner>` (both are read from the hook's environment; nothing in the repo can set them). Even then, only PRs with green CI, a clean merge state and an independent review, `--squash` only, with the repo named explicitly. If a merge is blocked (by the guard or by Claude Code's own permission layer), ask the owner.
- A task reaches `in_review` only with real evidence: pass the actual test output to `factory submit --evidence`. No evidence, no delivery claim. Docs-only, scaffold-only or untested changes are not deliverables.
- Never weaken or delete a test to make it pass. At most 3 fix attempts per failure, then `factory block` with the reason, and stop.
- Secrets never go into commits, logs, reports or PRs. The pre-commit hook scans staged changes; never bypass it.
- Work only on authorized projects. New repositories are private unless the owner decides otherwise.
- Never enable paid overage or create paid cloud resources.
- Do not claim unattended operation works until a scheduled run has actually fired and produced a PR you verified. Record the truth with `factory checkpoint --automation`.

## Model routing
Implementers and reviewers run on Sonnet. Use the `architect` agent (Opus) sparingly, for genuinely hard decisions. Prefer a deterministic script over an LLM call when one will do.

## Parallelism
Use subagents or worktrees only for independent tasks that touch different files. Give each worker an objective, the files it owns, acceptance criteria and the verification command. Take back a concise result, not a transcript.
