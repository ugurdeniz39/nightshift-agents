---
name: deliver-task
description: Take the next ready factory task from claim to an open pull request with recorded evidence. Use for scheduled development runs and whenever asked to "deliver", "ship the next task" or "work the backlog".
---

# Deliver one task

Goal: one task -> one `claude/<id>-<slug>` branch -> one PR, with real test evidence recorded. Never merge. Stop after one task unless told otherwise.

## Steps

1. Setup and orient: `git config core.hooksPath scripts/hooks` (a fresh clone has no hooks, so this turns the secret scan on; the guard allows exactly this value), then `node bin/factory.mjs resume` and `git fetch origin`.
2. Pick: `node bin/factory.mjs next --check-remote --json`.
   - Exit 3 ("nothing to do") or exit 1 (could not verify origin): stop and say why in your final message. Do not pick a task by hand and do not write any state file.
3. Branch from the default branch: `git checkout -b <branch from the json> origin/main`.
4. Claim and publish the lock immediately:
   `node bin/factory.mjs claim <ID> --by <run-name>` then commit `factory/backlog.json` ("chore: claim <ID>") and `git push -u origin <branch>`.
   The pushed branch is what stops other runs from taking the same task. If the push is rejected, stop.
5. Implement against the acceptance criteria. For anything beyond a few lines, hand it to the `implementer` agent with: task id, files it owns, acceptance criteria, the verification command (`npm test` for the factory project; the project's `test` field in `registry.json` otherwise).
6. Verify yourself: run the verification command and read the output. On failure: root cause, smallest fix, rerun - at most 3 attempts. Still failing: `factory block <ID> --reason "<what failed>"`, commit `factory/backlog.json`, push, stop.
7. Review: for changes over a few lines, run the `reviewer` agent and fix real findings (same 3-attempt bound).
8. Commit with a meaningful message and the standard Claude Code Co-Authored-By trailer. The pre-commit hook scans for secrets; never bypass it.
9. Push the branch (push right after the implementation passes, not only at the end - a cloud VM can be reclaimed). Open the PR through the REST API, because `gh pr create/view/list` hit a GraphQL 403 inside cloud runs:
   `gh api repos/<owner>/<repo>/pulls -f title="<title>" -f head="<branch>" -f base=main -F body=@<body-file> --jq .html_url`
   (`<owner>/<repo>` is the project's `repo` in `registry.json`). Write the body to a temp file first (outside the repo) with the Write tool and pass it with `-F body=@file`; never inline a multi-line body in the shell command. Body: Summary, Implementation, Test results (the real output line), Known limitations, Risks. End with the standard Claude Code attribution line.
   - Check for an existing PR first: `gh api "repos/<owner>/<repo>/pulls?head=<owner>:<branch>&state=all" --jq '.[].html_url'`. If one exists, do not open a second. The platform can open a PR by itself when a claude/* branch is pushed, with a title made from the branch name and an empty body (seen in the first scheduled run, PR #4). In that case set the real title and body on it: `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f title="<title>" -F body=@<body-file>` (the guard allows PATCH on a PR only for title and body).
   - If `gh` is unavailable or the call fails, do NOT report a delivery: `factory block <ID> --reason "PR not opened: <error>"`, commit `factory/backlog.json`, push, stop.
10. Record: `node bin/factory.mjs submit <ID> --pr <url> --evidence "<command and real result line>"`. Commit `factory/backlog.json` and push it to the same branch.
    A task PR changes only code, tests and its own entry in `factory/backlog.json`. Never edit `factory/state.json` or other tasks' entries in a task PR: that file is shared, and parallel PRs touching it conflict when merged. The lead session records checkpoints in a separate state PR.
11. Report briefly, in the owner's language if CLAUDE.md names one: task, PR link, the evidence line, anything left undone. Distinguish done / partial / blocked.

## Never
Force-push, push to main/master, merge, delete branches, publish, deploy to production, touch unauthorized projects, weaken tests, claim success without evidence.
