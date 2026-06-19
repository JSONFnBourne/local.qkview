# TODO

Follow-ups for Local.Qkview. Closed items get `[x]` with a `(Session N)` marker. Most recent additions at the top of each bucket.

## High

- [ ] (Session 7) **Decide whether VELOS *controller* archives should show an _aggregated_ chassis-wide tenant inventory synthesized from the partition subpackages.** Session 7 made the tenant table data-driven (renders for any F5OS archive carrying `show tenants`), but the only controller fixture (`syscon.tar`) carries 0 native tenants — a controller qkview doesn't emit `show tenants`; tenants live on the partitions. So the UI change is correct but invisible on syscon.tar. Surfacing a real chassis-wide inventory would require cross-subpackage aggregation in the extractor (read partition/peer-qkview tenant data from the controller bundle). Bigger backend task — confirm scope with user before building.

## Medium

- [ ] (Session 4) Add a *UI-driven* delete for `backend/logs_db/` — a per-row delete action that wipes both the `analyses` row and the matching `logs_<id>.db`. (Session 7 added the startup orphan sweep; the per-row UI action is still open.)
- [ ] (Session 1) Audit [v1_localhost.har](v1_localhost.har), [v2_localhost.har](v2_localhost.har), [v3_localhost.har](v3_localhost.har) for embedded customer PII the same way [v4_localhost.har](v4_localhost.har) was reviewed — confirm all are local-only.
- [ ] (Session 1) Build a HAR scrub helper that rewrites customer hostnames / IP ranges / device-name prefixes observed in captured HARs to RFC5737 addresses and synthetic names, so a sanitized capture can live in-tree for CI/benchmarking. Keep the real-pattern list in a local, gitignored note — not in repo docs.
- [ ] (Session 1) Investigate the `vCMP.tgz` 77 s and `partition.tar` 64 s receive times — response payloads (1.4–1.5 MB) are not that much larger than `tmos_ve.qkview` (236 KB / 14 s). Find whether the cost is in the streaming producer (extractor / rule engine) or in tar handling for nested layouts.
- [ ] (Session 2) Patch [CLAUDE.md](CLAUDE.md) "What this is" table — `partition_manager` should be `partition\d*_manager` (real VELOS partition archives use `partition1_manager`, and chassis can host `partition1..N`). Detector already handles both; doc hasn't caught up.

## Low

- [x] (Session 1) Port the `/session-end` skill from f5.assistant.
- [ ] (Session 2) Replace or drop `"lint": "next lint"` in [webapp/package.json](webapp/package.json) — `next lint` is deprecated in Next.js 16 and errors out with "Invalid project directory". Either switch to `eslint .` or drop the script and rely on `next build`'s TypeScript check.

## Closed this session

- [x] (Session 7) **VELOS controller tenant inventory** — resolved the Session-2 product question: surface it. Tenant table + caveat banner are now data-driven (gate relaxed from `!isController` to `tenants.length > 0`); controller framing relabels the table "Tenant Inventory (chassis-wide)". Data-driven, so it lights up only when the archive carries `show tenants` output. [webapp/app/qkview/page.tsx](webapp/app/qkview/page.tsx) — see new High item re: aggregated controller inventory.
- [x] (Session 7) **`logs_db/` retention sweep** — `_sweep_orphan_logs_db()` runs at startup: removes `logs_<id>.db` with no matching `analyses.id`, plus stale `.tmp_logs_*.db` leftovers past a 1 h age guard (won't race a live analysis in another worker). Dry-run against the real `logs_db/` (logs_44–47, all matched) deleted nothing. [backend/main.py](backend/main.py)
- [x] (Session 7) **Configured Virtual Servers table — search + windowing.** New dependency-free `VirtualizedVSTable` component: case-insensitive filter over name/destination/pool, "X of Y shown" counter, and fixed-row-height windowing above 100 rows (renders only viewport + overscan, spacer `<tr>`s preserve scrollbar). Replaces the inline IIFE table. Filter clears on partition switch / new upload. [webapp/app/qkview/page.tsx](webapp/app/qkview/page.tsx)
- [x] (Session 7) **Harden `_parse_log_query` negation-only → HTTP 400.** Negation-only inputs (`-foo`) now raise `NegationOnlyQuery`, caught in `search_logs` → 400 with a user-facing message, instead of silently dropping the negation and matching everything. Field-filter-only queries (`severity:error`) still legitimately return `fts=None` and work. Verified in isolation. [backend/main.py](backend/main.py)
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
