# gentle-shell-minimax-usage — agent instructions

## Commits

Commit messages are owned by the user-level skills, not by this file. Load both before composing
any message, from `~/.agents/skills/`:

- **`conventional-commits-es`** — the format. Conventional Commits with an English type
  (`feat`, `fix`, `docs`, `test`, …) and a Spanish subject: ≤50 characters when possible, hard cap
  72. Body of 1–5 short bullets wrapped at 72 that state the outcome — never prose paragraphs,
  never a file list, never AI attribution.
- **`work-unit-commits`** — the grouping. One commit per reviewable work unit, with tests and docs
  alongside the behavior they describe.

Then, for every commit: run the skill's pre-flight check, show the resolved git identity and the
proposed message, and **wait for explicit approval before running `git commit`**. No autonomous
commits.

The existing history is English prose; it does not set the convention. New commits follow the skill
above.

If a project-local commit workflow is ever added (for example `.agents/workflows/commit-workflow.md`),
it wins over the global skills when the two disagree.
