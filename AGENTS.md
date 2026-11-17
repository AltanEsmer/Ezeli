## Agent skills

### Issue tracker

Issues live in GitHub Issues for AltanEsmer/Ezeli (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Project layout

- `src/`: the app friends use (React, TypeScript, Vite). Counted by the size cap.
- `cli/`: the owner commands, run as `pnpm ezeli <command>` (import, people and links, hiding). Node runs the TypeScript directly, with no build step, so relative imports carry the `.ts` extension. `src/` never imports from `cli/`.
- `supabase/`: local Supabase settings and migrations.
- `tests/import/`: tests at the import seam. `tests/browser/`: tests at the browser seam. `tests/fixtures/`: made-up exports, with invented names and messages only.
- `private/`: ignored by git. Real exports, the people file and secret keys live here or outside the repo, and never in a commit.

## Rules

- Every change belongs to a ticket. One PR per ticket, with the body written from the PR template (Summary, Evidence, Merge Danger) and proof attached.
- Test only at the two seams named in the spec (issue 1): the import, and the app as a friend uses it.
- This repo is public. No real names, message text, phone numbers or keys in code, tests, commits, issues or PRs.
- Delete code that is no longer used. No new screen or table without a change to the spec.
