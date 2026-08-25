---
paths:
  - "openspec/**/*.md"
  - "openspec/**/*.yaml"
---

# OpenSpec workflow

**Scope:** how work enters and leaves this repository. Applies to every change, including one-line fixes to behaviour that a spec describes.

## Rules

1. Behaviour changes start as a change proposal, not as code. Run `openspec new change <kebab-name>` and fill `proposal.md` → `specs/<capability>/spec.md` → `design.md` → `tasks.md`, in that order. Each artifact is the input to the next.
2. Write the proposal about *why*, the specs about *what*, the design about *how*, and the tasks about *in what order*. A "how" in the proposal or a "why" in the tasks means the content is in the wrong file.
3. Name capabilities in kebab-case, one capability per `specs/<name>/spec.md`. Reuse an existing capability name from `openspec/specs/` when the behaviour belongs to it.
4. Format requirements exactly as `### Requirement: <name>` with SHALL or MUST, and scenarios as `#### Scenario: <name>` — **four hashtags**, with `- **WHEN**` and `- **THEN**` bullets. Three hashtags parse as prose and the scenario vanishes without an error.
5. Give every requirement at least one scenario, and cover the failure or edge case as well as the happy path. A requirement with only a happy path is an untested requirement.
6. Use `## MODIFIED Requirements` only when an existing requirement's behaviour changes, and copy the entire requirement block — heading, text and every scenario — before editing it. A partial copy silently loses the rest at archive time. When adding a new concern without changing existing behaviour, use `## ADDED Requirements`.
7. Use `## REMOVED Requirements` with both a `**Reason**` and a `**Migration**` line. Deleting the block instead leaves no record of the decision.
8. Run `openspec validate <change> --strict` before asking anyone to read a change, and `openspec validate --all --strict` before archiving.
9. Implement from `tasks.md` and tick each box as it completes. The checkbox format `- [ ] X.Y` is parsed; a task written any other way is invisible to progress tracking.
10. Archive with `openspec archive <change>` once the tasks are done and the suites are green. Archiving folds the delta into `openspec/specs/` — never edit `openspec/specs/` by hand.
11. Follow up on whatever the docs-sync hook reports after an archive. It is not advisory.

## Examples

```bash
openspec list                        # active changes and task progress
openspec list --specs                # capabilities that exist today
openspec status --change add-sharing # artifact completeness for one change
openspec show add-sharing            # rendered proposal and specs
```

A well-formed scenario:

```markdown
#### Scenario: Colliding rename is refused
- **WHEN** the new name matches a sibling after normalisation
- **THEN** the response is 409 with `code: "NAME_CONFLICT"` and the folder keeps its old name
```

## Anti-patterns

- Writing code first and back-filling a proposal to match it.
- Scenarios at `###` — they disappear silently.
- `MODIFIED` with only the changed sentence, dropping the requirement's other scenarios.
- Hand-editing `openspec/specs/**`; it is generated from archived deltas.
- Marking a task complete because the code exists, when its test does not.
