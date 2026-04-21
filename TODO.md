# TODO

Follow-ups for Local.Qkview. Closed items get `[x]` with a `(Session N)` marker. Most recent additions at the top of each bucket.

## High

- [ ] (Session 1) Pre-push scrub for public origin — run `git diff origin/main..HEAD` per [CLAUDE.md](CLAUDE.md) "Secrets, credentials, and PII" before the first push to `git@github.com:JSONFnBourne/local.qkview.git`.
- [ ] (Session 1) Triage the 12 pre-existing `M` files in the working tree (`.gitignore`, `CLAUDE.md`, `README.md`, `backend/main.py`, `backend/qkview_analyzer/{extractor,reporter,xml_stats}.py`, `scripts/run.{sh,ps1}`, `webapp/app/api/analyze/route.ts`, `webapp/app/api/qkview/[id]/apps/[...path]/route.ts`, `webapp/app/qkview/page.tsx`) — commit as coherent units or revert.

## Medium

- [ ] (Session 1) Audit [v1_localhost.har](v1_localhost.har), [v2_localhost.har](v2_localhost.har), [v3_localhost.har](v3_localhost.har) for embedded customer PII the same way [v4_localhost.har](v4_localhost.har) was reviewed — confirm all are local-only.
- [ ] (Session 1) Build a HAR scrub helper that rewrites customer hostnames/IPs (e.g. `*.example.com`, `203.0.113.*`, `192.168.253.*`, `customer-dns*`, `device-*`) to RFC5737 + synthetic names so a sanitized capture can live in-tree for CI/benchmarking.
- [ ] (Session 1) Investigate the `vCMP.tgz` 77 s and `partition.tar` 64 s receive times — response payloads (1.4–1.5 MB) are not that much larger than `tmos_ve.qkview` (236 KB / 14 s). Find whether the cost is in the streaming producer (extractor / rule engine) or in tar handling for nested layouts.

## Low

- [x] (Session 1) Port the `/session-end` skill from f5.assistant.
