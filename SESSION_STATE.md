# Session State

Running log of Claude Code sessions in this repo. Each session has three buckets: completed work, unresolved issues, next steps. Most recent session at the top.

Last updated: 2026-10-04 (Session 12)
---

## Session 12 — 2026-10-04

Worked RT#375 (stale analyzer tree after the blackbriar /home restore) and what turned up
underneath it.

**Completed**

- **RT#375 resolved.** The 3 analyzer files were byte-identical to `15bf4d1`, missing exactly
  the `603fe50` + `e929cc8` additions. Restored with `git checkout`. **The ticket's "not the
  RT#373 mechanism" was wrong:** the home mirror's unanchored `qkview_*/` matched
  `backend/qkview_analyzer/` and had frozen it at 07-17 since 07-24. Fixed on the mirror side
  (home.arpa RT#559, below).
- **RT#560 resolved.** `.venv` was built for Python 3.14, but the rebuilt host is 3.13.5. It was
  recreated from the pinned requirements. The 4 fixture archives were copied back from outcome;
  sha256 matched outcome, elitebook and the copy. `qkview/README.md` was recreated (untracked).
  **Full suite: 99 passed, 0 skipped.** CLAUDE.md count updated: 80 → 99.
- **home.arpa RT#559 resolved** (operator option a): blackbriar's exclude now has
  `+ /Projects/qkview/backend/qkview_analyzer/` above `qkview_*/`. The frozen NAS copy was
  removed. The mirror now equals local, and the customer fixtures stay off the NAS.
- Pushed: qkview `b3ea82a` → GitHub; home.arpa `357f93a` → jarvis.

**Unresolved**

- **home.arpa RT#563 (High, CANDIDATE INCIDENT, not declared):** elitebook's mirror put
  `partition.tar`, `rSeries.tar`, `syscon.tar` and **`vCMP.tgz`** (customer) on the NAS, which
  is in the B2 set. `vCMP.tgz` still exists on elitebook's disk despite RT#203. Nothing deleted.
- **home.arpa RT#562:** the same freeze on elitebook, the jarvis snapshot question, and the
  elitebook non-interactive-ssh sudo lecture. Handoff notes are on the ticket.
- **RT#561 (Low):** `extractor.py:477` `tar.extract` without `filter=`.

**Next steps**

- RT#563 before RT#562: capture what B2 holds, then exclude and delete. All of it is operator-gated.
- RT#561: set `filter='data'` explicitly, then re-run the F5OS integration tests.

**Gotchas learned**

- `/tmp` on blackbriar is **2.7 GB**. The full suite extracts the big F5OS archives, so for
  manual runs set `TMPDIR` to a dir inside `qkview/` (gitignored and mirror-excluded). A
  scratch venv filled `/tmp` once this session.
- The VS Code terminal here auto-activates `qkview/.venv`, and that `VIRTUAL_ENV` breaks
  home.arpa's pre-push lint (wrong Python, so missing jinja2, requests and ansible).
  `deactivate` before pushing home.arpa.

**GOVERNANCE §8:** no host added, destroyed or rebuilt. One mirror scope change (RT#559). One
candidate incident (RT#563) is recorded on RT#482 for the operator to decide.

---

## Session 11 — 2026-09-19 → 09-20

Cleared the five items left open by Session 10, and found something bigger on the way.

**Completed**

- **RT#338 (new, High) — the archive store is not what its documentation says.** While
  browser-testing the RT#35 table, the UI displayed the uploaded archive's hostname and
  it carried the customer domain. **Every archive in `qkview/` is gzip-compressed**,
  including the three named `.tar`, so RT#203's closing re-sweep — a plain grep — could
  only ever return zero. Decompressed: **partition.tar 3,474,104 / syscon.tar 1,964,106 /
  rSeries.tar 1,212,538** hits; the four TMOS `.qkview` files are clean. All three F5OS
  archives are the same customer's chassis. `CLAUDE.md` and the archive README are
  corrected. The customer's **partition name is already in the public repo**
  (`parser.py`, `test_parser.py`) — the domain is not, verified over every blob of every
  ref.
- **RT#35 — built** (operator chose caveat + partitions table). Parser refuses unknown
  headers instead of guessing; 9 tests; rendered correctly in a browser.
- **RT#36 — verified by clicking it.** `scripts/browser_smoke.mjs` drives Chrome over the
  DevTools Protocol with node's built-in WebSocket — no new dependency.
- **RT#334 — 33 lint problems → 0**, and the build typechecks. The two
  `set-state-in-effect` errors were real: replaced with React's documented render-phase
  adjustment. Typing `cm_redundancy` off the backend source exposed an unguarded
  `g.devices.length` and corrected two fields I had guessed wrong.
- **RT#336 — venv rebuilt** (`.venv.broken-20260919/` set aside, not deleted); node stays
  on outcome by operator ruling.
- **RT#37 — the scrub was too narrow and is now complete.** The first pass left
  customer-derived *object* names — profile, VLAN, node and iRule prefixes that the
  hostname and address rules never touched. The rewritten pattern note clears all of
  them, verified by census. The prefixes themselves stay in the gitignored note and on
  the ticket; naming them here would put them in a public repo, which is the whole
  point of the exercise.

- **RT#37 — closed.** The operator deleted the five original captures; verified gone.
- **RT#338 — closed.** Retention ruled KEEP: the three customer F5OS archives stay,
  because they are the only F5OS fixtures and removing them costs 31 integration tests.
  The documentation is corrected and the working sweep command recorded. Leg (b), the
  partition name in the public repo, was **withdrawn** — the operator challenged it and
  was right: the identifier is the domain, the domain is absent from every blob of every
  ref, and a bare four-character syslog hostname leads nowhere. Floating a history
  rewrite beside it was an overstatement and is retracted on the ticket.
- **RT#339 — closed: do NOT commit the scrubbed captures.** Reading one by eye — the
  step the ticket called for — found the customer's internal subdomain labels still
  present in a cert-key-chain name, plus 12 embedded certificate serials. Both the
  tool's verification pass and a token census had called those files clean, and neither
  was lying: one proves only that it removed what it found, the other only looks for
  tokens already on a list. Two other reasons stand independently: 35 of 35
  `/api/analyze` bodies are empty (Chrome does not retain streamed NDJSON), and the
  webapp has no test stack, so nothing could consume the fixtures without new
  dependencies. **har_scrub is fixed** (trailing boundary now admits `-`; new cert-serial
  rule) and now flags 4 of the 5 captures it previously passed. **Scrubbing is one-way**:
  a partially-scrubbed name is allow-listed and cannot be repaired by a second pass.

**Unresolved**

- **Nothing. The `qkview` queue is empty** for the first time since it was created —
  11 tickets resolved (RT#35, 36, 37, 38, 39, 41, 334, 335, 336, 338, 339), 5 opened.
- Two near-misses of my own, both caught by the pre-push privacy gate and both worth the
  next session's attention because neither was caught by a tool that was supposed to:
  I put the customer's **real 46-digit certificate serial** into the very test that
  asserts serials must not leak, having just read it on screen; and I wrote the
  customer's object-name prefixes into prose bound for a public repo. Nothing was
  pushed in either case. **The eyeball step that makes a scrub trustworthy is the same
  step that loads customer data into working memory, and the next thing written after
  it is where that data lands.** Read by eye, then synthesise every value carried out.
- **RT#350** filed against `home.arpa`: `tools/todo_archive.py` leaves two wrong pointers
  (it re-archives an existing pointer and repoints it at itself, and it lists every RT id
  mentioned in a bullet rather than the bullet's own). Both hand-corrected here, so the
  defects are invisible in this repo now — which is the argument for the ticket.

**Next steps**

- **Nothing is outstanding here.** The recommended cleanup was run by the operator:
  `qkview/har_scrubbed/` and `.har_scrub_map.json` are gone, verified. `.har_scrub_patterns.txt`
  is kept deliberately (gitignored) — it is what makes the next capture cheap to scrub properly.
- `.venv.broken-20260919/` (103 MB) is still on disk. Safe to delete; nothing references it.
- If a HAR is ever captured again: scrub it, then **read it by eye**, then synthesise any
  value you carry out of that reading into a test or a note.

---


Older sessions are archived: Session 10 (2026-09-18) in
[.archived/SESSION_STATE_archive_through-2026-09-18.md](.archived/SESSION_STATE_archive_through-2026-09-18.md);
Sessions 1–9 (2026-04-20 → 2026-09-14) in
[.archived/SESSION_STATE_archive_through-2026-09-14.md](.archived/SESSION_STATE_archive_through-2026-09-14.md).
