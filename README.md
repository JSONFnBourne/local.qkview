# Local.Qkview

Offline QKView archive analyzer for F5 BIG-IP (TMOS), F5OS rSeries, and VELOS. Runs entirely on your machine — the archive never leaves the host, there is no cloud call, no telemetry, and no GPU requirement.

A fork of the QKView subsystem from the F5 Assistant project, packaged as a standalone tool for fellow F5 engineers.

## What it does

Upload a `.qkview`, `.tgz`, `.tar.gz`, or `.tar` diagnostic archive and get back:

- **Device context** — product, version, hostname, platform, serial, license state, time range covered.
- **Log analysis** — parses every `var/log/*.log` (TMOS: `ltm`, `tmm`, `apm`, `asm`, `gtm`, `audit`, `daemon`, `restjavad*`; F5OS: event-log, system-events, per-subpackage logs), indexes them into an in-memory SQLite FTS table, and ranks by severity.
- **Known-issue matching** — a YAML-driven rule engine matches F5 message codes (e.g. `01070638`) and regex patterns, including time-windowed correlation for paired events. Rules live in `backend/rules/` — editing them is a config change, not a code change.
- **Configuration walk** — parses `bigip.conf`, `bigip_base.conf`, and per-partition dumps into a universal TMOS tree. Drill into virtual servers, pools, members, profiles, and iRules per partition.
- **Platform awareness** — automatically detects the four QKView layouts (flat TMOS VE, F5OS rSeries, VELOS partition, VELOS controller) and reads `manifest.json` to resolve MD5-hashed command outputs.

## Supported archive types

| Family          | Detection                                                      | Example source              |
| --------------- | -------------------------------------------------------------- | --------------------------- |
| TMOS VE / BIG-IP | Flat gzip tar with `config/` + `var/log/` at root              | Classic BIG-IP / VE         |
| F5OS rSeries    | `qkview/subpackages/<service>/qkview/…` with `manifest.json`   | rSeries appliances          |
| VELOS partition | Peer-wrapped `qkview/subpackages/peer-qkview.<ip>/qkview/…`    | VELOS chassis partition     |
| VELOS controller| Peer-wrapper + `k8s_*` subpackages                             | VELOS syscon / controller   |

## Requirements

- **Python 3.10+** (tested on 3.12)
- **Node.js 20.9+** (required by Next.js 16)
- **RAM**: 8 GB handles typical archives; 16 GB is comfortable for multi-hundred-MB VELOS bundles. Log indexing is in-memory SQLite.
- **Disk**: a few GB free for temp extraction.
- **No GPU required.** No LLM, no ML, no CUDA — pure parsing, regex, and YAML rules.
- Runs on **Linux, macOS, and Windows**.

## Quick start

Clone, install, run both services, open http://localhost:3001.

Default ports are **3001 / 8001** (webapp / backend) so Local.Qkview coexists with the upstream `f5.assistant` project, which uses 3000 / 8000. Override with `FRONTEND_PORT` / `BACKEND_PORT` env vars before invoking the launcher scripts.

### Linux / macOS

```bash
git clone https://github.com/JSONFnBourne/local.qkview.git
cd local.qkview

# Backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# Frontend
cd webapp
npm install
npm run build
cd ..

# Run (two terminals, or use the launcher below)
# Terminal 1:
source .venv/bin/activate
cd backend && uvicorn main:app --host 127.0.0.1 --port 8001

# Terminal 2:
cd webapp && PORT=3001 FASTAPI_BACKEND_URL=http://127.0.0.1:8001 npm run start
```

Then open http://localhost:3001 and drag a qkview onto the page.

### Windows (PowerShell)

```powershell
git clone https://github.com/JSONFnBourne/local.qkview.git
cd local.qkview

# Backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt

# Frontend
cd webapp
npm install
npm run build
cd ..

# Terminal 1:
.\.venv\Scripts\Activate.ps1
cd backend
uvicorn main:app --host 127.0.0.1 --port 8001

# Terminal 2:
cd webapp
$env:PORT = '3001'; $env:FASTAPI_BACKEND_URL = 'http://127.0.0.1:8001'; npm run start
```

### One-shot launchers

After the one-time install above, use the launcher scripts in `scripts/`:

- `scripts/run.sh` (Linux/macOS) — starts backend + frontend, tails logs, Ctrl+C stops both.
- `scripts/run.ps1` (Windows) — same, PowerShell.

## Project layout

```
local.qkview/
├── backend/                    FastAPI service, port 8001
│   ├── main.py                 4 routes: /health, /api/analyze, /api/qkview/{id}/apps, .../apps/{path}
│   ├── qkview_analyzer/        extractor, parser, indexer, rule_engine, reporter, tmos_config, xml_stats
│   ├── rules/                  YAML rule library (tmos_known_issues, f5os_hardware)
│   ├── tests/                  pytest suite
│   ├── requirements.txt        runtime deps (fastapi, uvicorn, lxml, PyYAML, click, rich)
│   └── requirements-dev.txt    adds pytest
├── webapp/                     Next.js 16 App Router, port 3001
│   ├── app/
│   │   ├── page.tsx            landing
│   │   ├── qkview/page.tsx     the analyzer UI
│   │   └── api/                thin proxies to the backend
│   ├── package.json            next, react, next-themes, lucide-react — nothing else
│   └── next.config.js          CSP + security headers
├── scripts/run.sh|run.ps1      one-shot launchers
├── LICENSE                     Apache-2.0
├── NOTICE                      third-party attributions (f5-corkscrew)
└── README.md
```

## Architecture

Two cooperating processes:

1. **FastAPI backend** (`backend/`, port 8001) unpacks the archive, parses logs, builds an in-memory SQLite FTS5 index, parses TMOS configuration, runs the rule engine, and persists a summary to `backend/local_qkview.db`.
2. **Next.js frontend** (`webapp/`, port 3001) serves the UI. Two API routes proxy to the backend: `POST /api/analyze` (the archive upload) and `GET /api/qkview/{id}/apps/{path}` (virtual-server drill-down). The frontend does not talk to the backend directly from the browser — the server-side proxy keeps the backend on localhost.

The analyzer pipeline, in order:

```
archive → extractor (detects family) → log parser → SQLite FTS5 indexer
       → bigip.conf + base.conf + partition dumps → universal TMOS tree
       → rule engine (YAML) → reporter → client-trimmed summary
```

Analysis summaries persist in `backend/local_qkview.db` (SQLite, gitignored). The `/api/qkview/{id}/apps/…` endpoints serve drill-downs from the persisted tree without re-parsing.

## Adding a known-issue rule

No code change needed — edit `backend/rules/tmos_known_issues.yaml` or `backend/rules/f5os_hardware.yaml`, then restart the backend. See existing entries for the schema: message-code match, regex match, severity, category, recommendation, optional correlation window.

## Tests

```bash
source .venv/bin/activate
cd backend
pytest
```

## Attribution

Portions of `backend/qkview_analyzer/tmos_config.py` and `backend/qkview_analyzer/xml_stats.py` are ported from [f5-corkscrew](https://github.com/f5devcentral/f5-corkscrew) (© 2014–2025 F5 Networks, Apache-2.0). See [NOTICE](NOTICE) for the file-by-file mapping.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Privacy

QKView archives contain device hostnames, IPs, and configuration that some organizations treat as sensitive. Local.Qkview processes everything on your machine and writes only to `backend/local_qkview.db` under the repo. It makes no outbound network calls. If you want to be extra careful, run it on an air-gapped host.
