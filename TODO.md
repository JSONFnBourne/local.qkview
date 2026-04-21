# TODO

Follow-ups for Local.Qkview. Closed items get `[x]` with a `(Session N)` marker. Most recent additions at the top of each bucket.

## High

- [ ] (Session 6) Add a PowerShell ExecutionPolicy note to the Windows install block in [README.md](README.md#L69-L94). Deferred by user. Suggested one-liner: "If `Activate.ps1` fails with an execution-policy error, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then retry."
- [ ] (Session 6) Delete the local `backup/pre-scrub` branch and `pre-scrub-backup` tag once the history rewrite is confirmed good-as-shipped. `git branch -D backup/pre-scrub && git tag -d pre-scrub-backup`. Never pushed to origin, local-only safety refs.
- [ ] (Session 2) VELOS controller tenant inventory — product decision: should `velos-controller` archives surface a read-only tenant inventory, or keep it suppressed as today? Blocks any related UI change. [webapp/app/qkview/page.tsx:944](webapp/app/qkview/page.tsx#L944)

## Medium

- [ ] (Session 4) Add a retention / orphan-cleanup pass for `backend/logs_db/`. Each analysis leaves a persistent `.db` file (40–125 MB typical); `analyses` rows can be deleted without touching the matching logs file, and vice versa. Minimum-viable: a startup sweep that removes `logs_*.db` with no matching `analyses.id`. Better: a per-row delete action in the UI.
- [ ] (Session 4) Harden `_parse_log_query` so negation-only inputs (`-foo`) return HTTP 400 with a user-facing explanation, rather than silently dropping the negation and matching everything. [backend/main.py:419-453](backend/main.py#L419-L453)
- [ ] (Session 3) Decide whether `.run_one.sh` / `.run_one_parent.sh` session-research runner scripts (currently untracked in the repo root) should be promoted to `scripts/` as reusable archive-sweep helpers or simply deleted. They drive the fork and parent backends with the seven sample archives and dump result JSONs to `/tmp/`.
- [ ] (Session 1) Audit [v1_localhost.har](v1_localhost.har), [v2_localhost.har](v2_localhost.har), [v3_localhost.har](v3_localhost.har) for embedded customer PII the same way [v4_localhost.har](v4_localhost.har) was reviewed — confirm all are local-only.
- [ ] (Session 1) Build a HAR scrub helper that rewrites customer hostnames / IP ranges / device-name prefixes observed in captured HARs to RFC5737 addresses and synthetic names, so a sanitized capture can live in-tree for CI/benchmarking. Keep the real-pattern list in a local, gitignored note — not in repo docs.
- [ ] (Session 1) Investigate the `vCMP.tgz` 77 s and `partition.tar` 64 s receive times — response payloads (1.4–1.5 MB) are not that much larger than `tmos_ve.qkview` (236 KB / 14 s). Find whether the cost is in the streaming producer (extractor / rule engine) or in tar handling for nested layouts.
- [ ] (Session 2) Add search / client-side filter / virtualization to the Configured Virtual Servers table. vCMP.tgz renders 1961 rows inside a 600px scroll block — works but doesn't scale to real operator workflows. [webapp/app/qkview/page.tsx:1081-1111](webapp/app/qkview/page.tsx#L1081-L1111)
- [ ] (Session 2) Patch [CLAUDE.md](CLAUDE.md) "What this is" table — `partition_manager` should be `partition\d*_manager` (real VELOS partition archives use `partition1_manager`, and chassis can host `partition1..N`). Detector already handles both; doc hasn't caught up.

## Low

- [x] (Session 1) Port the `/session-end` skill from f5.assistant.
- [ ] (Session 2) Replace or drop `"lint": "next lint"` in [webapp/package.json](webapp/package.json) — `next lint` is deprecated in Next.js 16 and errors out with "Invalid project directory". Either switch to `eslint .` or drop the script and rely on `next build`'s TypeScript check.

## Closed this session

- [x] (Session 6) Rebuild + restart webapp on 3001 — "QKView Analyzer" rename now live in the served HTML on both `/` and `/qkview`.
- [x] (Session 6) History rewrite to scrub the customer-identifying strings out of public git history. `git filter-repo` with a 9-pattern replacement file; all 11 commits re-SHA'd; force-pushed with `--force-with-lease` to `origin/main`. Post-rewrite grep over every blob in every commit returned zero hits on the original patterns. Old initial commit `f27edce` → new `f36c03c`.
- [x] (Session 6) Delete `.run_one.sh` / `.run_one_parent.sh` — session-research tooling carried since Session 3, no longer needed now that the seven-archive sweep isn't an active workstream.
- [x] (Session 5) Browser-smoke the log-search tile — confirmed working by user after two failure-mode fixes (stale next-server manifest → unstyled page; stale backend predating Session 4 code → no `logs_db/logs_<id>.db` → empty chip counts + "Not Found" on real phrase). Both resolved by killing + restarting each service against current source / build.
- [x] (Session 5) Session 3 reconciliation decision — Option (B): 3001 / 3000 are intentionally distinct product surfaces; fork stays a superset; parent stays untouched.
- [x] (Session 5) Relax `cluster_nodes` render gate to `f5osOverview.cluster_nodes.length > 0` — VELOS partition blade inventory + rSeries node info now render for non-controller F5OS. Commit `f98b96a`. [webapp/app/qkview/page.tsx:913](webapp/app/qkview/page.tsx#L913)
- [x] (Session 5) Pre-push scrub for public origin — ran `git diff origin/main..HEAD` + source-wide regex on PII patterns. Caught three leaks (extractor docstring, rSeries test assertion, TODO wording); scrubbed in commit `ef6a70c` before push.
- [x] (Session 5) First meaningful public push of the fork — 8 commits from `2222b83..f98b96a` landed on `origin/main`.
- [x] (Session 5) Triage of the seven Session-1 pre-existing `M` files — committed as three coherent units: `chore(ports)` port defaults (`f054e66`), `fix(xml_stats)` ca-bundle `prerem_*` filter (`2dc18ec`), plus the privacy scrub (`ef6a70c`) that swept up one of them. All pushed.
- [x] (Session 5) Global rename "QKView Log Analyzer" → "QKView Analyzer" across landing page, analyzer page, CLI docstring, package docstring.
- [x] (Session 4) Persist `LogIndexer` to disk per analysis at `backend/logs_db/logs_<id>.db` — enables interactive search after the analyze stream closes. [backend/main.py:86-107](backend/main.py#L86-L107), [backend/main.py:329-346](backend/main.py#L329-L346)
- [x] (Session 4) Add `GET /api/qkview/{id}/logs/sources` — aggregated chip counts per log family plus full source_file breakdown. [backend/main.py:455-483](backend/main.py#L455-L483)
- [x] (Session 4) Add `GET /api/qkview/{id}/logs` — FTS5-backed search with a Lucene-subset parser (phrases, AND/OR/NOT, `-word`, prefix `*`, `log:`/`severity:`/`process:` field filters). [backend/main.py:419-453](backend/main.py#L419-L453), [backend/main.py:486-575](backend/main.py#L486-L575)
- [x] (Session 4) Next.js proxies for `/logs` and `/logs/sources` mirroring the existing `/apps` pattern.
- [x] (Session 4) Relocate "Extracted Critical/Warning Logs" tile directly under the System Status + Known Issues grid; build new `LogsSearchTile` with search input, help popover, chips (dimmed when empty), severity dropdown, debounced search. [webapp/app/components/LogsSearchTile.tsx](webapp/app/components/LogsSearchTile.tsx), [webapp/app/qkview/page.tsx:858-865](webapp/app/qkview/page.tsx#L858-L865)
- [x] (Session 4) Add `backend/logs_db/` to `.gitignore` (per-analysis log files hold real customer log lines / hostnames / F5 message codes — never push).
- [x] (Session 3) Audit each of the seven sample archives end-to-end against the fork (3001 / 8001) — per-archive render-fitness report in [SESSION_STATE.md](SESSION_STATE.md) Session 3.
- [x] (Session 3) Run the seven archives against the parent (3000 / 8000) and diff payload + UI vs fork — fork is strictly a superset; no parent-only features on `page.tsx` to port across.

## Closed previous sessions

- [x] (Session 2) Fix "Configured Virtual Servers (N) but empty rows" bug on tmos_ve.qkview — `activePartition` now resets on new upload. [webapp/app/qkview/page.tsx:588-590](webapp/app/qkview/page.tsx#L588-L590)
- [x] (Session 2) Add `f5os_variant` field to `device_info` so the UI can distinguish VELOS partition from VELOS controller (`PRODUCT.Platform` says `controller` for both). [backend/qkview_analyzer/extractor.py:519-555](backend/qkview_analyzer/extractor.py#L519-L555), [webapp/app/qkview/page.tsx:392-398](webapp/app/qkview/page.tsx#L392-L398)
- [x] (Session 2) Also reset `activeCmd` and `showRawStanzas` on new upload (same stale-state family as `activePartition`). [webapp/app/qkview/page.tsx:588-590](webapp/app/qkview/page.tsx#L588-L590)
