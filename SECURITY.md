# Security

## What the guard is, and is not

`scripts/hooks/guard-bash.mjs` is **accident prevention for unattended agents, not a security boundary.** It inspects Bash commands before Claude Code runs them, and blocks the forms of force-push, pushes to main, branch deletion, merges, publishing, production deploys, history-destroying commands and git config injection that the tests in `test/` describe.

Known gaps, by design or not yet covered:

- scripts or programs that run git internally (`node script.js`, `make`, ...);
- aliases or hooks already present in a global git config;
- `curl`/`wget` calls to the GitHub API with a token;
- tools other than Bash;
- a guard crash or unparsable hook input exits 0, which lets the command run;
- hooks only load when Claude Code starts inside the repository.

Known false positives (blocked although harmless): a commit message that is, or starts with, `-n` (it reads like `--no-verify`), and prose that spells out a forbidden command. Rephrase it.

Use GitHub branch protection and least-privilege tokens wherever your plan allows it. Those are the real boundary.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). Do not open a public issue for a bypass. A useful report includes the exact command, what the guard returned, and what the shell would actually run.

Bypasses of the guard that let an agent force-push, push to main, merge, delete branches or publish are in scope, and so are leaks of secret values by the secret scanner or the report command.
