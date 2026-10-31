# Contributing

Thanks for helping. Nightshift stays small on purpose: zero runtime dependencies, plain JSON state, one file per command.

## Setup
```
git clone https://github.com/yuroka-studio/nightshift-agents && cd nightshift-agents
npm test                                   # Node >= 22, no install step
git config core.hooksPath scripts/hooks    # pre-commit secret scan
```

## Conventions
- **A new command** is `lib/commands/<name>.mjs` exporting `summary`, `options` (util.parseArgs shape) and `run(ctx)`, plus `test/<name>.test.mjs`. Do not edit `lib/cli.mjs` for it.
- **Time** comes from `ctx.now()`, never `new Date()`, so tests are deterministic.
- **Business logic** in `lib/tasks.mjs` stays pure: data in, new data out, or a thrown `Error` with a message a human can act on.
- **Guard changes** come with tests in `test/guards.test.mjs` or `test/merge-gate.test.mjs`: one assertion for the case that must be blocked, one for the closest legitimate command that must still pass.
- Never weaken or delete a test to make a change pass.

## Pull requests
- Keep each PR to one concern.
- Say in the PR body what you ran and the real result line (`tests N / pass N / fail 0`).
- Mention anything you could not verify.

Unofficial project, not affiliated with Anthropic.
