# TODO

Follow-ups for Local.Qkview. Closed items get `[x]` with a `(Session N)` marker. Most recent additions at the top of each bucket.

## High

- [ ] (Session 3) **User direction needed on 3001 ↔ 3000 reconciliation.** Bidirectional diff of fork vs parent shows the fork is strictly a superset on `page.tsx` (98 fork-only lines, 0 parent-only features). Options: (A) remove fork enhancements to match parent — undoes commit `96b597d` + related; (B) keep fork extras and pull in any parent-only feature — nothing to pull in today; (C) chase a runtime browser-side difference. No reconciliation edits until user picks a direction. See [SESSION_STATE.md](SESSION_STATE.md) Session 3 "Unresolved".
- [ ] (Session 3) Relax the `cluster_nodes` render gate so VELOS partition blade inventory (8 blades on `partition.tar`) and rSeries single-node info render for non-controller F5OS. Change `isController && f5osOverview.cluster_nodes.length > 0` → `f5osOverview.cluster_nodes.length > 0` at [webapp/app/qkview/page.tsx:906](webapp/app/qkview/page.tsx#L906). **Contingent on the (A)/(B)/(C) decision above** — under (A) this section is deleted instead.
- [ ] (Session 1) Pre-push scrub for public origin — run `git diff origin/main..HEAD` per [CLAUDE.md](CLAUDE.md) "Secrets, credentials, and PII" before the first push to `git@github.com:JSONFnBourne/local.qkview.git`.
- [ ] (Session 2) VELOS controller tenant inventory — product decision: should `velos-controller` archives surface a read-only tenant inventory, or keep it suppressed as today? Blocks any related UI change. [webapp/app/qkview/page.tsx:944](webapp/app/qkview/page.tsx#L944)
- [~] (Session 1, partially addressed by Session 2) Triage the pre-existing `M` files in the working tree. Session 2 committed [backend/qkview_analyzer/extractor.py](backend/qkview_analyzer/extractor.py), [backend/qkview_analyzer/reporter.py](backend/qkview_analyzer/reporter.py), and [webapp/app/qkview/page.tsx](webapp/app/qkview/page.tsx) as part of the f5os_variant + stale-state work. Still uncommitted (unchanged by Session 3): `.gitignore`, `CLAUDE.md`, `README.md`, `backend/main.py`, `backend/qkview_analyzer/xml_stats.py`, `scripts/run.{sh,ps1}`, `webapp/app/api/analyze/route.ts`, `webapp/app/api/qkview/[id]/apps/[...path]/route.ts`. Decide: commit as coherent units or revert.

## Medium

- [ ] (Session 3) Decide whether `.run_one.sh` / `.run_one_parent.sh` session-research runner scripts (currently untracked in the repo root) should be promoted to `scripts/` as reusable archive-sweep helpers or simply deleted. They drive the fork and parent backends with the seven sample archives and dump result JSONs to `/tmp/`.
- [ ] (Session 1) Audit [v1_localhost.har](v1_localhost.har), [v2_localhost.har](v2_localhost.har), [v3_localhost.har](v3_localhost.har) for embedded customer PII the same way [v4_localhost.har](v4_localhost.har) was reviewed — confirm all are local-only.
- [ ] (Session 1) Build a HAR scrub helper that rewrites customer hostnames/IPs (e.g. `*.example.com`, `203.0.113.*`, `192.168.253.*`, `customer-dns*`, `device-*`) to RFC5737 + synthetic names so a sanitized capture can live in-tree for CI/benchmarking.
- [ ] (Session 1) Investigate the `vCMP.tgz` 77 s and `partition.tar` 64 s receive times — response payloads (1.4–1.5 MB) are not that much larger than `tmos_ve.qkview` (236 KB / 14 s). Find whether the cost is in the streaming producer (extractor / rule engine) or in tar handling for nested layouts.
- [ ] (Session 2) Add search / client-side filter / virtualization to the Configured Virtual Servers table. vCMP.tgz renders 1961 rows inside a 600px scroll block — works but doesn't scale to real operator workflows. [webapp/app/qkview/page.tsx:1081-1111](webapp/app/qkview/page.tsx#L1081-L1111)
- [ ] (Session 2) Patch [CLAUDE.md](CLAUDE.md) "What this is" table — `partition_manager` should be `partition\d*_manager` (real VELOS partition archives use `partition1_manager`, and chassis can host `partition1..N`). Detector already handles both; doc hasn't caught up.

## Low

- [x] (Session 1) Port the `/session-end` skill from f5.assistant.
- [ ] (Session 2) Replace or drop `"lint": "next lint"` in [webapp/package.json](webapp/package.json) — `next lint` is deprecated in Next.js 16 and errors out with "Invalid project directory". Either switch to `eslint .` or drop the script and rely on `next build`'s TypeScript check.

## Closed this session

- [x] (Session 3) Audit each of the seven sample archives end-to-end against the fork (3001 / 8001) — per-archive render-fitness report in [SESSION_STATE.md](SESSION_STATE.md) Session 3.
- [x] (Session 3) Run the seven archives against the parent (3000 / 8000) and diff payload + UI vs fork — fork is strictly a superset; no parent-only features on `page.tsx` to port across.

## Closed previous sessions

- [x] (Session 2) Fix "Configured Virtual Servers (N) but empty rows" bug on tmos_ve.qkview — `activePartition` now resets on new upload. [webapp/app/qkview/page.tsx:588-590](webapp/app/qkview/page.tsx#L588-L590)
- [x] (Session 2) Add `f5os_variant` field to `device_info` so the UI can distinguish VELOS partition from VELOS controller (`PRODUCT.Platform` says `controller` for both). [backend/qkview_analyzer/extractor.py:519-555](backend/qkview_analyzer/extractor.py#L519-L555), [webapp/app/qkview/page.tsx:392-398](webapp/app/qkview/page.tsx#L392-L398)
- [x] (Session 2) Also reset `activeCmd` and `showRawStanzas` on new upload (same stale-state family as `activePartition`). [webapp/app/qkview/page.tsx:588-590](webapp/app/qkview/page.tsx#L588-L590)
