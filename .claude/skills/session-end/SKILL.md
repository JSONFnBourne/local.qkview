---
name: session-end
description: Wrap up the current session cleanly — summarise, flush SESSION_STATE / TODO, commit, and print a handoff.
---

Execute the following five steps in order without pausing for confirmation between them. Do not re-ask the user what to commit or whether to proceed.

1. **Summarise the current session** in three buckets: completed work, unresolved issues, and next steps. Pull from this conversation, not prior memory.
2. **Update `SESSION_STATE.md`** at the repo root — append or update a Session-N block with those three sections. Match the existing style (dated header, tables for metrics, file-path links). Bump the `Last updated:` line at the top. If the file does not yet exist, create it with a short preamble and Session-1 as the first block.
3. **Update `TODO.md`** at the repo root — mark completed items `[x]` with a `(Session N)` prefix where appropriate, and add any newly discovered follow-up items under the correct priority heading. If the file does not yet exist, create it with `## High`, `## Medium`, `## Low` sections and place new items accordingly.
4. **Stage and commit all session changes** (code, tests, scripts, and docs — not just docs). Use a descriptive commit message in the repo's `type(scope): summary` style, with a body that lists the distinct pieces of work. Author is `JSONFnBourne <jsonfnbourne@users.noreply.github.com>` per [CLAUDE.md](../../../CLAUDE.md) "GitHub" section; add `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` as a trailer. **Do not push** — origin is a public transmission boundary, so the user runs the pre-push scrub (`git diff origin/main..HEAD`) themselves.
5. **Print a short handoff summary** for the next session: commit SHA, file count, test count, and the top 2–3 items the next session should pick up first.

Skip or adapt a step only if it genuinely doesn't apply (e.g. no code changes → step 4 commits docs only; no new TODO items → step 3 is TODO marks only). Do not skip because a step "seems redundant" — SESSION_STATE and TODO are both write-through and need both updates.
