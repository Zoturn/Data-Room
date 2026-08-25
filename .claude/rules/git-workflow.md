---
paths:
  - ".github/**"
  - ".gitignore"
  - "**/CHANGELOG.md"
---

# Git and delivery workflow

**Scope:** branches, commits, pull requests and CI. Referenced from the root `CLAUDE.md` because it governs actions rather than files.

## Rules

1. One branch per OpenSpec change, named after it: `change/add-sharing`. Work for two changes never shares a branch.
2. Conventional Commits, with the scope naming the workspace: `feat(api): resolve share access from ancestor path`. Types in use: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.
3. A commit is one coherent step — a task or a small group of tasks from `tasks.md`. Not "wip", not a day's work, not a rename mixed with a behaviour change.
4. Tick the `tasks.md` checkboxes in the commit that completes them, so progress and history agree.
5. Never commit a secret, a `.env`, a `node_modules`, a build output, or a Cypress video.
6. Never use `--no-verify`. A hook that fires is telling you something; fix the cause.
7. Rebase onto the target branch rather than merging it in, so history stays linear and a change reads as a sequence.
8. A pull request states what changed and why, links its OpenSpec change, and lists what was verified. CI must be green before merge; a red pipeline is never "unrelated".
9. Archive the OpenSpec change after merge, not before, and act on the docs-sync hook's report.
10. Migrations are additive and forward-only. Never edit a migration that has run anywhere but a local database.

## Examples

```
feat(api): add cursor pagination to folder children

Keyset pagination on (type, name, id) so listing cost is proportional to the
page rather than the folder. Offset paging degrades past a few thousand rows
and shifts under concurrent uploads.

Task 4.3 of add-data-room-tree.
```

```bash
git switch -c change/add-file-management
# ... work, commit per task group ...
git rebase main
gh pr create --fill
```

## Anti-patterns

- `fix: stuff`, `wip`, `update files`.
- A single commit containing the whole change.
- Formatting churn mixed into a behaviour commit — the format hook already keeps files clean.
- Merging with a failing pipeline and a promise to fix it after.
- Amending or force-pushing a branch someone else has pulled.
