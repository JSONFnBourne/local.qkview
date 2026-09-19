# CLAUDE.md

Guidance for Claude Code when working in the Local.Qkview repository.

## What this is

Local.Qkview is a standalone, GPU-free, offline QKView archive analyzer for F5 BIG-IP (TMOS), F5OS rSeries, and VELOS. Two cooperating processes — a FastAPI backend and a Next.js webapp — packaged for Linux / macOS / Windows, distributed via GitHub as freeware for F5 field engineers.

It is a fork of the QKView subsystem from the F5 Assistant project. The parent (`f5.assistant/`) is actively maintained but **lives on the `outcome` host, not on this workstation** — reach it via VS Code Remote-SSH to `outcome` (path `~/projects/f5.assistant/` there). It must not be modified from here; treat it as read-only reference material.

## Starting / running things

No systemd. Two plain processes. After a one-time install (see [README.md](README.md)):

```bash
# Launcher — Linux / macOS
./scripts/run.sh

# Launcher — Windows (PowerShell)
./scripts/run.ps1
```

Hand-run per component (for dev loops):

```bash
# Backend — Python 3.10+ (tested on 3.12), venv at repo root
source .venv/bin/activate
cd backend && uvicorn main:app --host 127.0.0.1 --port 8001 --reload

# Frontend — Node 20.9+ (Next.js 16 requirement)
cd webapp && npm run dev            # HMR
cd webapp && npm run build && npm run start    # prod mirror
```

**Important**: `npm run start` serves the compiled `.next/` build. After editing webapp source you must rebuild before `npm run start` will pick up changes.

| Component | URL                          | Source                           |
| --------- | ---------------------------- | -------------------------------- |
| backend   | http://127.0.0.1:8001        | [backend/](backend/)             |
| webapp    | http://127.0.0.1:3001        | [webapp/](webapp/)               |

Defaults are 3001/8001 to coexist with the parent `f5.assistant` systemd services (which bind 3000/8000) — those run on `outcome`, so on a host where both are checked out / port-forwarded the two won't collide. Override via `FRONTEND_PORT` / `BACKEND_PORT` env vars before invoking `scripts/run.{sh,ps1}`.

## Tests and lint

```bash
# Backend (pytest)
source .venv/bin/activate
cd backend && pytest

# Frontend — needs node >= 20.9; blackbriar has NO node runtime, run it on outcome
cd webapp && npm run lint        # `eslint .` with webapp/eslint.config.mjs (RT#41); `next lint` was REMOVED in Next.js 16
```

Extra scripts under `scripts/`: `har_scrub.py` (RT#38 — rewrites customer hostnames / addresses / literal patterns out of a browser HAR so it can be shared; the pattern note and the map it writes are gitignored), `profile_analyze.py` (RT#39 — per-stage timing of the analyze pipeline, in-process or against a running backend) and `browser_smoke.mjs` (end-to-end UI check: uploads an archive through the real file input, asserts a section rendered, then exercises the per-row delete. Drives Chrome over the DevTools Protocol with node 22's built-in WebSocket, so it adds **no** dependency to `package.json` — it needs only a Chromium binary via `--chrome`. Its assertions use `textContent`, never `innerText`, because `innerText` returns text after CSS `text-transform` and a `uppercase` label will not match its own source string). `QKVIEW_DB_PATH` / `QKVIEW_LOGS_DB_DIR` point the backend at a throwaway store for such runs.

**Do not run the browser smoke against a customer archive on a remote host** — the analysis, its on-disk log index and any screenshot all carry that archive's contents. Three of the archives in `qkview/` are customer material (RT#338).

The test suite is 29 unit tests + 31 integration tests + the RT#36/RT#38 unit tests (80 total, ~75 s). The integration tests need the real archives `tmos_ve.qkview`, `rSeries.tar`, `partition.tar`, `syscon.tar`; `backend/tests/conftest.py` looks for them in `$QKVIEW_FIXTURE_DIR`, then `backend/tests/fixtures/`, then `<repo>/qkview/` (where this checkout keeps them), then the legacy `data/qkview/`. **Until 2026-09-18 only the legacy path was consulted and it never existed in the fork, so every run reported 31 skips and this file called that expected (RT#335).** A skip and a pass look the same in a green run: if you see `31 skipped`, the archives are NOT being found — fix the path, do not accept the skip. Genuinely missing archives (CI, fresh clone) still skip; do not mark those xfail or delete them.

## Architecture — the non-obvious parts

### QKView archives come in four distinct shapes

This is the single most important architectural fact in the repo. Same `.tar` / `.qkview` extension, four incompatible layouts:

| Family               | Shape                                                              | Config entry                       | Logs entry                                                                    |
| -------------------- | ------------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------- |
| **TMOS VE / BIG-IP** | Flat gzip tar, root-level `config/` + `var/log/` + `*_module.xml`  | `config/bigip.conf`, `bigip_base.conf` | `var/log/ltm,tmm,apm,asm,gtm,audit,daemon.log,restjavad*.log`             |
| **F5OS rSeries**     | `qkview/subpackages/<service>/qkview/…`; command outputs under MD5-hash paths; `manifest.json` maps name → path | `system_manager` subpackage | Per-subpackage `filesystem/var/log/…`                                         |
| **VELOS partition**  | Doubly nested inside `qkview/subpackages/peer-qkview.<ip>/qkview/…` (partition + HA peer) | `partition\d*_manager` under the peer wrapper — the code matches **both** `partition1_manager` and `partition_manager` (`_F5OS_MANAGER_PRIORITY`, `backend/qkview_analyzer/extractor.py`) | `partition_alert_service`, `lopd`, `partition\d*_manager` under the peer wrapper |
| **VELOS controller** | Same peer-wrapper as partition; half the subpackages are OpenShift `k8s_*` pods | `vcc-confd` subpackage | `velocity-rsyslogd`, k8s pod logs, PEL/platform event logs                    |

Never guess command-output paths — always read `manifest.json` in each subpackage. `/confd/scripts/f5_confd_run_cmd show …` is F5OS's CLI wrapper; strip that prefix when displaying command names.

**Before changing [backend/qkview_analyzer/extractor.py](backend/qkview_analyzer/extractor.py), [config_parser.py](backend/qkview_analyzer/config_parser.py), [tmos_config.py](backend/qkview_analyzer/tmos_config.py), or [xml_stats.py](backend/qkview_analyzer/xml_stats.py):** read the corresponding file in the parent project's `QKVIEW_FORMATS.md` — at `~/projects/f5.assistant/QKVIEW_FORMATS.md` **on the `outcome` host** (the parent isn't checked out on this workstation). That remains the authoritative field-by-field reference. We don't duplicate it here.

### Analyzer data flow

```
archive → extract_qkview (detects family, unpacks, reads manifest.json)
       → parse_all_logs (syslog + ISO 8601 + F5OS event-log variants)
       → LogIndexer (in-memory SQLite FTS5, FTS5 queries drive the rule engine)
       → parse_bigip_conf + parse_bigip_base_conf + per-partition dumps
       → parse_tmos_config (universal TMOS tree, partition-aware)
       → RuleEngine (YAML-driven: message-code match, regex, time-windowed correlation)
       → Reporter → client-trimmed NDJSON stream
```

Rule files:
- [backend/rules/tmos_known_issues.yaml](backend/rules/tmos_known_issues.yaml)
- [backend/rules/f5os_hardware.yaml](backend/rules/f5os_hardware.yaml)

**Adding a new known-issue rule is a YAML edit, not a code change.** Restart the backend after editing. See existing entries for the schema.

Analysis summaries persist to `backend/local_qkview.db` (SQLite, gitignored). The `/api/qkview/{id}/apps/…` endpoints serve drill-downs from the persisted tree without re-parsing.

### Webapp ↔ backend wiring

Server-side proxies only — the browser never talks to FastAPI directly. Keeps the backend on localhost.

- `POST /api/analyze` → [webapp/app/api/analyze/route.ts](webapp/app/api/analyze/route.ts) → backend. Raw `application/octet-stream` body, filename in `X-Filename` header (multipart was a 1 MB/s bottleneck; do not reintroduce it).
- `GET /api/qkview/{id}/apps/{full_path}` → [webapp/app/api/qkview/\[id\]/apps/\[...path\]/route.ts](webapp/app/api/qkview/%5Bid%5D/apps/%5B...path%5D/route.ts) → backend. Serves virtual-server drill-downs from the persisted summary.

`FASTAPI_BACKEND_URL` env var overrides the default `http://127.0.0.1:8001` — useful when running the two processes on different ports during dev. The `scripts/run.sh` launcher wires this automatically from `BACKEND_PORT`.

### What's deliberately not here (and must stay gone)

The parent project includes these — Local.Qkview does not, and pulling them back in would undo the fork:

- **No Ollama, no LLM of any kind.** This is CPU-only freeware. Do not add `ollama`, `@anthropic-ai/sdk`, `openai`, `transformers`, `torch`, or any inference client.
- **No knowledge DB** (`db/knowledge.db`, `better-sqlite3`, `minisearch`). The `/knowledge`, `/reference`, `/generator`, `/validator`, `/discussion` routes are not part of this fork and must not be added.
- **No pipeline / training / HuggingFace integration.** Those live in the parent's `pipeline/` tree only.
- **No systemd units.** Cross-platform freeware — stick to plain processes and the `scripts/run.*` launchers.

If a feature request tempts you to re-import any of the above, push back and keep the scope tight. This repo's job is *analyze a QKView, show findings, drill into virtuals* — nothing else.

## Platform requirements (the only ones that matter)

- Python **3.10+** (developed on 3.12)
- Node **20.9+** (Next.js 16 hard requirement)
- RAM: 8 GB handles typical archives, 16 GB comfortable for multi-hundred-MB VELOS bundles (log indexer is in-memory SQLite)
- Disk: a few GB free for temp extraction of the largest archive you'll analyze
- No GPU. No CUDA. No ML runtime.
- Works on **Linux, macOS, Windows**. If you add code that uses Unix-only APIs (glibc's `malloc_trim` in `main.py` is an existing example), wrap it in a capability check — do not hard-require it. Windows compatibility is a product promise.

## Runtime dependency budget

Keep it small. Every dep is a support burden for F5 engineers installing this on laptops with varying corporate restrictions.

**Backend runtime** ([backend/requirements.txt](backend/requirements.txt)):
`fastapi`, `uvicorn[standard]`, `lxml`, `PyYAML`, `click`, `rich`.

**Webapp runtime** ([webapp/package.json](webapp/package.json) `dependencies`):
`next`, `react`, `react-dom`, `next-themes`, `lucide-react`.

Adding anything to either list requires a real justification. Default answer is no.

## Working style

- **Discover before you script.** Before writing scripts that talk to the local backend, SQLite DB, or filesystem layout, query the actual state. Don't assume from memory.
- Changes to `qkview_analyzer/*.py` that affect archive parsing must be validated against at least one real QKView of the relevant family, not just unit tests.
- Rule additions should include the F5 message code (e.g. `01070638`) or a tight regex — broad patterns create false positives.

## Attribution — f5-corkscrew (Apache 2.0)

`backend/qkview_analyzer/tmos_config.py` and `backend/qkview_analyzer/xml_stats.py` derive from [f5-corkscrew](https://github.com/f5devcentral/f5-corkscrew) (© 2014-2025 F5 Networks, Apache-2.0). When editing or adding code ported from corkscrew:

1. Preserve the copyright header block in the file.
2. Keep [NOTICE](NOTICE) accurate (upstream file → ported file mapping).
3. Mark modifications with a one-line comment.

## GitHub

- Target repo: `git@github.com:JSONFnBourne/local.qkview.git` (not yet pushed as of initial commit `f27edce`).
- Default branch: `main`.
- Commit author: `JSONFnBourne <jsonfnbourne@users.noreply.github.com>` — use the noreply alias, never a personal email.

## Secrets, credentials, and PII — do not transmit to GitHub

The origin remote will be a public transmission boundary. Anything committed and pushed is effectively permanent.

**Never commit:**

- Tokens / API keys (GitHub PATs, HuggingFace tokens, any vendor keys).
- Credentials (passwords, connection strings, real SNMP community strings, device passwords).
- Private key material (PEM/OpenSSH private keys, `.p12`/`.pfx`).
- `.env*` files (gitignored — never override with `-f`).
- PII: real email addresses other than F5 corporate (`*@f5.com`) or RFC/doc synthetic examples; customer names; customer device hostnames; serial numbers.
- **Real QKView archives or anything extracted from one.** Customer config, pool-member IPs, cert CNs — all of it stays local. The `.gitignore` excludes `*.qkview`, `*.tgz`, `*.tar.gz` and `backend/local_qkview.db*` for this reason.

  **`qkview/` on this host holds REAL PRODUCTION CUSTOMER DEVICES.** `vCMP.tgz`
  was removed by operator ruling on 2026-09-14 once its support case closed
  (RT#203) — but **that ticket's closing statement, that the seven remaining
  archives were re-swept for the customer domain "with zero hits", is FALSE and
  the reason is instructive (RT#338, 2026-09-19).** Every archive here is
  **gzip-compressed**, including the three named `.tar`, so a grep over the
  container bytes returns 0 for any string whatsoever. Decompressed
  (`tar xzf <archive> -O | grep -c`), the same domain appears **3,474,104 times
  in `partition.tar`, 1,964,106 in `syscon.tar` and 1,212,538 in `rSeries.tar`**
  — all three F5OS archives are the same customer's chassis. The four TMOS
  `.qkview` files return 0 by the corrected method.

  Two consequences. **Never sweep these archives without decompressing**, and
  record the command alongside the result: "we grepped and found nothing" and
  "we could not read it" produced identical output here for five days. And
  **nothing derived from an archive — hostnames, partition names, pool members,
  cert CNs — may reach a commit**, because the origin is public; the customer's
  partition name did reach it (`parser.py`, `test_parser.py`) and is tracked on
  RT#338.

  That directory is itself gitignored (`.gitignore:38`, `/qkview/`), so it
  carries its own uncommitted `README.md` recording what each archive is —
  **read it before using anything in there.** This pointer is tracked because
  that README is not, and a fresh clone would otherwise give no warning.
  Verified when the customer archive was found: nothing under `qkview/` is
  tracked and no archive has ever been added on any ref, so the public origin
  is clean. Operator ruling the same day, standing as precedent for the next
  such archive: **qksan (`v2_qkview`) is not to be pointed at customer data** —
  its own operating standard gates real-engagement use behind five checks, and
  gates 2 and 5 are unmet.

**Allowed without scrubbing:**

- F5 public doc examples (`j.doe@company.com`, RFC5737 `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`).
- The commit-author noreply alias (`jsonfnbourne@users.noreply.github.com`).

**Before any `git push`:** run `git diff origin/main..HEAD` and eyeball for the patterns above. If something leaked, stop — rotate the credential first, then contact the user before rewriting history.

## Reference docs in-tree

- [README.md](README.md) — user-facing install + usage.
- [LICENSE](LICENSE) — Apache-2.0.
- [NOTICE](NOTICE) — third-party attributions.
- [scripts/run.sh](scripts/run.sh), [scripts/run.ps1](scripts/run.ps1) — one-shot launchers (assume one-time install is done).

Authoritative parent docs (read-only reference at `~/projects/f5.assistant/` **on the `outcome` host** — not present on this workstation):

- `QKVIEW_FORMATS.md` — archive layouts, iHealth Quick-Links mapping, field-by-field.
- `CLAUDE.md` — parent platform's operating guide.
