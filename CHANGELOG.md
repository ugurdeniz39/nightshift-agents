# Changelog

## 0.1.0 - 2026-10-31

First public version, extracted from a private factory that has been running real unattended Claude Code tasks.

- `factory` CLI with these commands: `init`, `status`, `list`, `add`, `next` (with `--check-remote` branch lock), `claim` (leases), `release`, `submit` (evidence required), `complete`, `block`, `checkpoint`, `resume`, `report`, `doctor`, `project-add`.
- `deliver-task` skill, plus `implementer`, `reviewer` and `architect` agents.
- Bash guard hook:
  - quote, heredoc and substitution aware;
  - an owner-session merge gate (`FACTORY_ALLOW_MERGE=1` plus `FACTORY_MERGE_OWNER`, both from the launching environment; squash only);
  - a `gh api` write policy: create a PR, comment on it, edit its title or body.
- Pre-commit secret scan.
- Field report #001: the first unattended run and the guard fixes that came out of it.
- 81 tests, zero dependencies, Node >= 22.
