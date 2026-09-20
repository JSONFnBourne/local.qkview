# Session State

Running log of Claude Code sessions in this repo. Each session has three buckets: completed work, unresolved issues, next steps. Most recent session at the top.

Last updated: 2026-09-20 (Session 11)
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

## Session 10 — 2026-09-18

Queue pass over `qkview` (six open tickets) from blackbriar; anything needing node ran on outcome.

**Completed**

- **RT#41 — verified and closed.** `npm run lint` runs on a host with node after a fresh
  `npm ci` and reports real findings. Those 33 findings are now **RT#334**.
- **RT#38 — built and closed.** `scripts/har_scrub.py` + 20 tests; all five captures scrubbed
  into `qkview/har_scrubbed/` and verified CLEAN. Pattern note and map are gitignored.
- **RT#39 — answered and closed.** `scripts/profile_analyze.py`: producer cost, log volume
  (parse+index+scan = 83 % of partition.tar's 60 s); transport < 0.1 s. Rule-scan floor of
  ~9 s on small archives noted for later.
- **RT#36 — built, verified end to end minus the click.** List + delete endpoints, proxies,
  `RecentAnalyses` panel; backend tests, live delete, and the whole stack driven through
  the Next production server on outcome. Left open for a browser smoke.
- **RT#35 and RT#37 — measured, commented, left for the operator.** syscon.tar has no
  tenant data to aggregate (options on the ticket); the original HARs are the last copy
  of that customer's data here and deleting them is the operator's call.
- **Three findings filed:** RT#334 (lint errors), **RT#335 (the 31 integration tests had
  been skipped on every run of this fork — conftest looked in `data/qkview/`, which never
  existed; fixed, suite is 86 passed in 75 s)**, RT#336 (this checkout's `.venv` and
  `node_modules` are non-executable copies).

**Unresolved**

- RT#37's originals on disk (operator `rm`), RT#35 ruling, RT#36 browser smoke, RT#334
  lint errors (two `set-state-in-effect` are real), RT#336 rebuild of `.venv`.
- outcome has a long-running `next-server` (pid 9968) on port 3001 that is not mine and
  predates this session — probably a stale Local.Qkview dev/prod server. Left alone.

**Next steps**

- Operator: rule on RT#35 and RT#37; click through RT#36 once on a host with node.
- Fix RT#334's two hook errors before anything else in the webapp.


---

---

Older sessions (1–9, 2026-04-20 → 2026-09-14) are in
[.archived/SESSION_STATE_archive_through-2026-09-14.md](.archived/SESSION_STATE_archive_through-2026-09-14.md).
