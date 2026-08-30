# Copilot Instructions for Ferdium

See [CLAUDE.md](../CLAUDE.md) for full architecture and command reference.

## Commit Message Conventions (enforced by commitlint)

All commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/)
and pass `@commitlint/config-conventional` (see `commitlint.config.js`). The
commit-msg hook **rejects** non-compliant messages.

Rules:

- Format: `<type>: <subject>` — e.g. `feat: add workspace reordering`
- Valid types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`,
  `perf`, `build`, `ci`, `revert`
- The subject after the colon starts **lowercase** (never sentence-case or
  Start Case) and has **no trailing period**
- Subject line ≤ 100 characters
- Every body line ≤ 100 characters — wrap long bullets
- Separate the body from the subject with a blank line

When generating a commit message, follow these rules exactly — the git hooks
will reject anything else.

## Validation Before Committing

The pre-commit hook runs `pnpm prepare-code` (typecheck + lint:fix + biome +
prettier + translations) followed by `pnpm test`. Keep these green:

```bash
pnpm typecheck
pnpm exec eslint src/ test/ --ext .ts,.tsx --max-warnings 0
pnpm exec jest --runInBand
```
