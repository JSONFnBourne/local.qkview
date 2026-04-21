# CLAUDE.md

Guidance for Claude Code when working in the Local.Qkview repository.

## What this is

Local.Qkview is a standalone, GPU-free, offline QKView archive analyzer for F5 BIG-IP (TMOS), F5OS rSeries, and VELOS. Two cooperating processes — a FastAPI backend and a Next.js webapp — packaged for Linux / macOS / Windows, distributed via GitHub as freeware for F5 field engineers.

It is a fork of the QKView subsystem from the F5 Assistant project (`~/projects/f5.assistant/`). The parent project is actively maintained and must not be modified from here. Treat the parent as read-only reference material.

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
cd backend && uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Frontend — Node 20.9+ (Next.js 16 requirement)
cd webapp && npm run dev            # HMR
cd webapp && npm run build && npm run start    # prod mirror
```

**Important**: `npm run start` serves the compiled `.next/` build. After editing webapp source you must rebuild before `npm run start` will pick up changes.

| Component | URL                          | Source                           |
| --------- | ---------------------------- | -------------------------------- |
| backend   | http://127.0.0.1:8000        | [backend/](backend/)             |
| webapp    | http://127.0.0.1:3000        | [webapp/](webapp/)               |

## Tests and lint

```bash
# Backend (pytest)
source .venv/bin/activate
cd backend && pytest

# Frontend
cd webapp && npm run lint
```

The test suite is 25 unit tests + 31 integration tests that are skipped unless real QKView archive fixtures are present at `backend/tests/fixtures/` (`tmos_ve.qkview`, `rSeries.tar`, `partition.tar`, `syscon.tar`). Skipped fixtures are expected; do not mark them xfail or delete them.

## Architecture — the non-obvious parts

### QKView archives come in four distinct shapes

This is the single most important architectural fact in the repo. Same `.tar` / `.qkview` extension, four incompatible layouts:

| Family               | Shape                                                              | Config entry                       | Logs entry                                                                    |
| -------------------- | ------------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------- |
| **TMOS VE / BIG-IP** | Flat gzip tar, root-level `config/` + `var/log/` + `*_module.xml`  | `config/bigip.conf`, `bigip_base.conf` | `var/log/ltm,tmm,apm,asm,gtm,audit,daemon.log,restjavad*.log`             |
| **F5OS rSeries**     | `qkview/subpackages/<service>/qkview/…`; command outputs under MD5-hash paths; `manifest.json` maps name → path | `system_manager` subpackage | Per-subpackage `filesystem/var/log/…`                                         |
| **VELOS partition**  | Doubly nested inside `qkview/subpackages/peer-qkview.<ip>/qkview/…` (partition + HA peer) | `partition_manager` under the peer wrapper | `partition_alert_service`, `lopd`, `partition_manager` under the peer wrapper |
| **VELOS controller** | Same peer-wrapper as partition; half the subpackages are OpenShift `k8s_*` pods | `vcc-confd` subpackage | `velocity-rsyslogd`, k8s pod logs, PEL/platform event logs                    |

Never guess command-output paths — always read `manifest.json` in each subpackage. `/confd/scripts/f5_confd_run_cmd show …` is F5OS's CLI wrapper; strip that prefix when displaying command names.

**Before changing [backend/qkview_analyzer/extractor.py](backend/qkview_analyzer/extractor.py), [config_parser.py](backend/qkview_analyzer/config_parser.py), [tmos_config.py](backend/qkview_analyzer/tmos_config.py), or [xml_stats.py](backend/qkview_analyzer/xml_stats.py):** read the corresponding file in the parent project's `QKVIEW_FORMATS.md` at `~/projects/f5.assistant/QKVIEW_FORMATS.md` — that remains the authoritative field-by-field reference. We don't duplicate it here.

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

`FASTAPI_BACKEND_URL` env var overrides the default `http://127.0.0.1:8000` — useful when running the two processes on different ports during dev.

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

**Allowed without scrubbing:**

- F5 public doc examples (`j.doe@company.com`, RFC5737 `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`).
- The commit-author noreply alias (`jsonfnbourne@users.noreply.github.com`).

**Before any `git push`:** run `git diff origin/main..HEAD` and eyeball for the patterns above. If something leaked, stop — rotate the credential first, then contact the user before rewriting history.

## Reference docs in-tree

- [README.md](README.md) — user-facing install + usage.
- [LICENSE](LICENSE) — Apache-2.0.
- [NOTICE](NOTICE) — third-party attributions.
- [scripts/run.sh](scripts/run.sh), [scripts/run.ps1](scripts/run.ps1) — one-shot launchers (assume one-time install is done).

Authoritative parent docs (read-only reference at `~/projects/f5.assistant/`):

- `QKVIEW_FORMATS.md` — archive layouts, iHealth Quick-Links mapping, field-by-field.
- `CLAUDE.md` — parent platform's operating guide.
