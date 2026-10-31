# Architecture

## Decisions

1. **Native Claude Code first.** Agents, a skill, a hook and scheduled cloud tasks do the orchestration. The only custom code is a zero-dependency Node CLI for the backlog, claims and checkpoints. No dashboard, no database, no agent framework.
2. **State is plain JSON in git** (`factory/*.json`). A cloud run starts from a fresh clone and sees nothing of your machine, so anything it must know lives in the repo.
3. **The pushed `claude/<id>-<slug>` branch is the cross-run lock.** `factory next --check-remote` skips any task whose branch exists on origin, and fails closed if origin can't be reached. Claims also carry a lease (default 90 minutes), so a crashed run's task becomes available again. `main` only changes when a human merges, so the backlog on `main` can lag behind in-flight branches; the remote check is what prevents duplicate work.
4. **Evidence is mandatory.** `submit` refuses an empty evidence string. `report` lists a task as shipped only when it is `in_review` or `done`, has an http(s) PR URL, and has an evidence entry dated that day whose text does not report failures.
5. **Scheduler: Claude Code scheduled tasks**, one repository per task. A multi-repo cloud session loads no repo's hooks, which would silently disable the guard. Cron is UTC; the minimum interval is one hour.
6. **Pull requests go through the REST API** (`gh api repos/<owner>/<repo>/pulls`), because `gh pr` commands fail with a GraphQL 403 inside cloud runs. The platform may already have opened a PR when the branch was pushed. In that case the skill edits its title and body (`PATCH` is allowed for those two fields only).
7. **The guard is accident prevention, not a security boundary.** It parses Bash commands (quotes, heredocs, substitutions, wrappers, redirections) and fails closed on forms it cannot classify. It does not see scripts that run git internally, aliases from a global config, `curl`, or other tools. Real enforcement belongs on the GitHub side (branch protection) where the plan allows it.
8. **Merging needs the owner present.** The gate opens only when the hook process itself was started with `FACTORY_ALLOW_MERGE=1`, so text inside a command cannot open it and scheduled runs never have it. Even then it allows only squash merges in repos under the configured owner, with the repo named explicitly. Permission `deny` rules win over hooks, so the shipped settings deny force-push and repo deletion, not merges.
9. **Task PRs never touch shared state.** `factory/state.json` is shared, and parallel PRs that edit it conflict. A task PR changes code, tests and its own backlog entry only.
10. **No Agent Teams.** They are experimental, token-hungry and unsupported in headless sessions. Plain subagents, optionally in worktrees, cover independent tasks.
11. **Model routing.** Sonnet for implementers, reviewers and scheduled runs; Opus (the `architect` agent) for rare hard decisions.

## Data model (backlog task)

```json
{
  "id": "T-007", "project": "self", "title": "Add a /health endpoint", "type": "feature", "priority": 1,
  "status": "ready | claimed | in_review | done | blocked", "deps": ["T-003"],
  "acceptance": ["GET /health returns 200", "npm test passes"],
  "claim": { "by": "nightly-run", "at": "...", "leaseUntil": "..." },
  "branch": "claude/t-007-add-a-health-endpoint", "pr": "https://github.com/...", "evidence": [{ "at": "...", "text": "npm test: 41 pass, 0 fail" }]
}
```
