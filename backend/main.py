from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import asyncio
import ctypes
import ctypes.util
import gc
import re
import shlex
import sqlite3
import os
import tempfile
import threading
import time
import json
import logging
from typing import Optional

logger = logging.getLogger("f5_backend")

MAX_UPLOAD_BYTES = 1024 * 1024 * 1024  # 1 GB


# Analyzing a 773 MB VELOS partition archive peaks around 7.4 GB resident.
# CPython's arena allocator + glibc don't return that to the OS on their own,
# so after a handful of requests the uvicorn worker looks pinned at multi-GB
# RSS even though nothing is live. malloc_trim(0) pushes freed glibc arenas
# back; on non-glibc platforms the helper is a no-op.
_LIBC_MALLOC_TRIM = None


def _load_malloc_trim():
    global _LIBC_MALLOC_TRIM
    if _LIBC_MALLOC_TRIM is not None:
        return _LIBC_MALLOC_TRIM
    libc_path = ctypes.util.find_library("c")
    if not libc_path:
        _LIBC_MALLOC_TRIM = False
        return False
    try:
        libc = ctypes.CDLL(libc_path)
    except OSError:
        _LIBC_MALLOC_TRIM = False
        return False
    if not hasattr(libc, "malloc_trim"):
        _LIBC_MALLOC_TRIM = False
        return False
    libc.malloc_trim.argtypes = [ctypes.c_size_t]
    libc.malloc_trim.restype = ctypes.c_int
    _LIBC_MALLOC_TRIM = libc.malloc_trim
    return _LIBC_MALLOC_TRIM


def _reclaim_memory():
    """gc.collect() + glibc malloc_trim(0). Called at the end of every analyze
    request so the long-lived worker doesn't retain analysis-peak RSS."""
    gc.collect()
    trim = _load_malloc_trim()
    if trim:
        try:
            trim(0)
        except OSError:
            pass

from qkview_analyzer.extractor import extract_qkview
from qkview_analyzer.parser import parse_all_logs, parse_f5os_event_log
from qkview_analyzer.indexer import LogIndexer
from qkview_analyzer.config_parser import parse_bigip_conf, parse_bigip_base_conf, BigIPConfig
from qkview_analyzer.rule_engine import RuleEngine, Finding
from qkview_analyzer.reporter import Reporter
from qkview_analyzer.tmos_config import (
    parse_tmos_config,
    list_partitions,
    app_summary,
    app_details,
)

app = FastAPI(title="Local.Qkview Backend API", version="0.1.0")

_ALLOWED_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3001")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[_ALLOWED_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Filename"],
)

DB_PATH = os.path.join(os.path.dirname(__file__), "local_qkview.db")
LOGS_DB_DIR = os.path.join(os.path.dirname(__file__), "logs_db")
os.makedirs(LOGS_DB_DIR, exist_ok=True)


def _logs_db_path(analysis_id: int) -> str:
    return os.path.join(LOGS_DB_DIR, f"logs_{analysis_id}.db")


# Chip name -> list of source_file matching strategies. Each entry is a SQL LIKE
# pattern. Covers the common F5 log naming variants:
#   ltm, ltm.1, ltm.2_transformed      (TMOS, root)
#   host/ltm, velos-partition-*/ltm    (F5OS, path-prefixed)
# Keep the keys stable — they become the chip `source=` API parameter.
LOG_CHIP_SOURCES: dict[str, list[str]] = {
    "ltm":       ["ltm", "ltm.%", "%/ltm", "%/ltm.%"],
    "tmm":       ["tmm", "tmm.%", "%/tmm", "%/tmm.%"],
    "gtm":       ["gtm", "gtm.%", "%/gtm", "%/gtm.%"],
    "apm":       ["apm", "apm.%", "%/apm", "%/apm.%"],
    "asm":       ["asm", "asm.%", "%/asm", "%/asm.%"],
    "restjavad": ["restjavad.%.log", "%/restjavad.%.log"],
}

def init_db():
    """Initialize the SQLite database with required schemas."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            analysis_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            summary JSON NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

@app.on_event("startup")
async def startup_event():
    init_db()

@app.get("/")
async def root():
    return {"message": "Local.Qkview Backend API is running."}

@app.get("/health")
async def health_check():
    return {"status": "ok", "db_initialized": os.path.exists(DB_PATH)}

@app.options("/api/analyze")
async def analyze_qkview_options():
    return {}

@app.post("/api/analyze")
async def analyze_qkview(request: Request):
    """Upload a qkview file (raw octet-stream), analyze it, save to DB, stream NDJSON progress.

    Accepts the archive body directly — no multipart. Filename is supplied via
    the X-Filename header. Skipping multipart avoids the pure-Python,
    GIL-bound parser in python-multipart which throttles large uploads to
    under 1 MB/s on this host.

    Response is application/x-ndjson. Each line is a JSON object:
      {"type":"progress","msg":"..."}      — status update from a pipeline stage
      {"type":"result","status":"success","filename":"...","data":{...}}  — final payload
      {"type":"error","status_code":4xx|500,"detail":"..."}                — failure
    """
    filename = request.headers.get("x-filename") or "upload.qkview"
    allowed_extensions = (".qkview", ".tgz", ".tar.gz", ".tar")
    if not filename.endswith(allowed_extensions):
        raise HTTPException(status_code=400, detail=f"File must be an archive of types: {allowed_extensions}")

    temp_path = None
    with tempfile.NamedTemporaryFile(delete=False, suffix=".qkview") as temp_file:
        bytes_written = 0
        async for chunk in request.stream():
            if not chunk:
                continue
            bytes_written += len(chunk)
            if bytes_written > MAX_UPLOAD_BYTES:
                temp_file.close()
                os.remove(temp_file.name)
                raise HTTPException(status_code=413, detail="File exceeds 1 GB limit.")
            temp_file.write(chunk)
        temp_path = temp_file.name

    if bytes_written == 0:
        os.remove(temp_path)
        raise HTTPException(status_code=400, detail="Empty upload body.")

    # Validate file content before starting the streaming pipeline — that way
    # bad uploads still return a plain 4xx instead of a 200 with a stream.
    import tarfile as _tarfile
    if filename.endswith(".tar"):
        if not _tarfile.is_tarfile(temp_path):
            os.remove(temp_path)
            raise HTTPException(status_code=400, detail="Invalid file content: not a valid tar archive.")
    else:
        with open(temp_path, "rb") as f:
            magic = f.read(2)
        if magic != b'\x1f\x8b':
            os.remove(temp_path)
            raise HTTPException(status_code=400, detail="Invalid file content: not a valid gzip/qkview archive.")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=256)

    def push(event: dict) -> None:
        """Thread-safe emit of one NDJSON event to the streaming response."""
        loop.call_soon_threadsafe(queue.put_nowait, event)

    def progress(msg: str) -> None:
        push({"type": "progress", "msg": msg})

    def worker() -> None:
        indexer: Optional[LogIndexer] = None
        # Persist the log index to disk so the UI can search it after the
        # analyze stream closes. Built at a temp path first because we don't
        # know the analysis_id until the summary row is INSERTed.
        pending_logs_db = os.path.join(
            LOGS_DB_DIR, f".tmp_logs_{os.getpid()}_{int(time.time()*1000)}.db"
        )
        final_logs_db: Optional[str] = None
        try:
            progress("Extracting archive…")
            data = extract_qkview(temp_path, progress_callback=progress)

            progress("Parsing log files…")
            entries = parse_all_logs(data.log_files, progress_callback=progress)

            is_f5os = data.meta.product == "F5OS"
            if is_f5os:
                if data.f5os_event_log:
                    event_entries = parse_f5os_event_log(data.f5os_event_log, source_file="event-log.log")
                    entries.extend(event_entries)
                if data.f5os_system_events:
                    sys_event_entries = parse_f5os_event_log(data.f5os_system_events, source_file="system-events")
                    entries.extend(sys_event_entries)
                entries.sort(key=lambda e: e.timestamp)

            progress(f"Indexing {len(entries)} log entries…")
            indexer = LogIndexer(db_path=pending_logs_db)
            indexer.bulk_insert(entries, progress_callback=progress)
            # `entries` is duplicated into the SQLite index; drop our copy now
            # so gc can reclaim it before the Reporter/json stage allocates.
            entries = []

            config = BigIPConfig()
            tmos_tree: dict = {}
            if not is_f5os:
                progress("Parsing bigip.conf / bigip_base.conf…")
                if "config/bigip.conf" in data.config_files:
                    config = parse_bigip_conf(data.config_files["config/bigip.conf"])
                if "config/bigip_base.conf" in data.config_files:
                    base_config = parse_bigip_base_conf(data.config_files["config/bigip_base.conf"])
                    config.vlans = base_config.vlans
                    config.self_ips = base_config.self_ips
                    if base_config.hostname and base_config.hostname.lower() != "localhost":
                        data.meta.hostname = base_config.hostname

                progress("Building universal TMOS config tree…")
                try:
                    # Root bigip.conf carries /Common objects; per-partition
                    # dumps under config/partitions/<name>/bigip.conf carry
                    # their partition's objects (/DMZ, /public, ...). Merge
                    # them all so VS from every partition land in tmos_tree.
                    root_names = (
                        "config/bigip.conf",
                        "config/bigip_base.conf",
                        "config/bigip_gtm.conf",
                    )
                    partition_names = sorted(
                        name
                        for name in data.config_files.keys()
                        if name.startswith("config/partitions/")
                        and name.endswith((".conf",))
                    )
                    combined = "\n".join(
                        data.config_files.get(name, "")
                        for name in (*root_names, *partition_names)
                    )
                    if combined.strip():
                        tmos_tree = parse_tmos_config(combined)
                except Exception:
                    logger.exception("Universal TMOS parser failed; continuing without app tree")
                    tmos_tree = {}

            # Hostname fallback: derive from most common hostname in parsed log entries
            if not data.meta.hostname and entries:
                from collections import Counter
                hostnames = [e.hostname for e in entries if e.hostname and e.hostname not in ("", "-", "localhost")]
                if hostnames:
                    data.meta.hostname = Counter(hostnames).most_common(1)[0][0]

            progress("Running rule engine scan…")
            engine = RuleEngine(platform="f5os" if is_f5os else "tmos")
            findings = engine.scan(indexer, progress_callback=progress)

            if is_f5os and data.f5os_health:
                for h in data.f5os_health:
                    if h.health == "unhealthy":
                        findings.append(Finding(
                            rule_name=f"f5os-health-{h.component}",
                            rule_description=f"F5OS Health: {h.component} — {h.description}",
                            severity="critical" if h.severity == "critical" else "warning",
                            category="hardware",
                            recommendation=f"Check {h.component} hardware status. Component reports: {h.description}",
                            count=1,
                        ))

            progress("Generating summary…")
            queried = indexer.query(min_severity="warning", limit=5000)
            json_str = Reporter.to_json(
                data.meta,
                queried,
                findings,
                config if not is_f5os else None,
                qkview_data=data,
            )
            summary_dict = json.loads(json_str)

            if tmos_tree:
                summary_dict["tmos_config"] = tmos_tree
                summary_dict["partitions"] = list_partitions(tmos_tree)
                summary_dict["apps"] = app_summary(tmos_tree)
                json_str = json.dumps(summary_dict, default=str)

            # sqlite3.Connection's context manager commits but does not close
            # the connection — explicit close keeps per-request connections
            # from accumulating in the long-lived worker.
            conn = sqlite3.connect(DB_PATH)
            try:
                cursor = conn.execute(
                    "INSERT INTO analyses (filename, summary) VALUES (?, ?)",
                    (filename, json_str)
                )
                analysis_id = cursor.lastrowid
                conn.commit()
            finally:
                conn.close()

            # Close the indexer's SQLite handle before renaming (Windows holds
            # file locks until the connection is closed).
            try:
                indexer.close()
            except Exception:
                pass
            indexer = None

            final_logs_db = _logs_db_path(analysis_id)
            try:
                os.replace(pending_logs_db, final_logs_db)
            except OSError:
                logger.exception("Failed to persist log index for analysis %s", analysis_id)
                final_logs_db = None

            # Trim the streamed payload so the browser doesn't freeze parsing
            # and rendering megabytes it will never show. SQLite keeps the full
            # summary (including tmos_config) for the /apps detail endpoints.
            # VELOS partition findings have been observed with 88 MB multi-line
            # "messages" that blow the client stream past 500 MB.
            MAX_MESSAGE_BYTES = 2048

            def _trim_entry(e):
                # webapp/app/qkview/page.tsx renders sample.raw_line and
                # entry.raw_line; `message` is a duplicate we drop for the
                # client stream. Truncate raw_line to keep the UI responsive
                # when the log parser produces a single 88 MB "entry".
                if not isinstance(e, dict):
                    return e
                out = {k: v for k, v in e.items() if k != "message"}
                raw = out.get("raw_line")
                if isinstance(raw, str) and len(raw) > MAX_MESSAGE_BYTES:
                    out["raw_line"] = (
                        raw[:MAX_MESSAGE_BYTES]
                        + f"\n…[truncated, {len(raw) - MAX_MESSAGE_BYTES} more bytes]"
                    )
                return out

            client_dict = {k: v for k, v in summary_dict.items() if k != "tmos_config"}
            client_dict["analysis_id"] = analysis_id
            if isinstance(client_dict.get("entries"), list):
                client_dict["entries"] = [_trim_entry(e) for e in client_dict["entries"][:300]]
            if isinstance(client_dict.get("findings"), list):
                client_dict["findings"] = [
                    {**f, "sample_entries": [_trim_entry(s) for s in f.get("sample_entries", [])]}
                    if isinstance(f, dict) else f
                    for f in client_dict["findings"]
                ]

            push({
                "type": "result",
                "status": "success",
                "filename": filename,
                "data": client_dict,
            })
        except Exception:
            import traceback
            logger.error("FAILED TO ANALYZE QKVIEW:\n%s", traceback.format_exc())
            push({
                "type": "error",
                "status_code": 500,
                "detail": "Analysis failed. Check server logs for details.",
            })
        finally:
            # Close the SQLite handle even on error paths so the worker's
            # allocation of the indexed log set can be reclaimed.
            if indexer is not None:
                try:
                    indexer.close()
                except Exception:
                    pass
            # Drop the pending temp file if rename didn't happen (failure path).
            if final_logs_db is None and os.path.exists(pending_logs_db):
                try:
                    os.remove(pending_logs_db)
                except OSError:
                    pass
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
            _reclaim_memory()
            push(None)  # sentinel: close the stream

    threading.Thread(target=worker, daemon=True).start()

    async def ndjson_stream():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield (json.dumps(item) + "\n").encode("utf-8")

    return StreamingResponse(
        ndjson_stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )

def _load_summary(analysis_id: int) -> dict:
    """Fetch a stored analysis summary JSON blob from SQLite."""
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT summary FROM analyses WHERE id = ?", (analysis_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    try:
        return json.loads(row[0])
    except (TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Corrupt analysis summary") from exc


@app.get("/api/qkview/{analysis_id}/apps")
async def list_qkview_apps(analysis_id: int, partition: Optional[str] = None):
    """Return the list of virtual-server app summaries for a stored analysis.

    Optional `?partition=Common` filters to a single partition.
    """
    summary = _load_summary(analysis_id)
    tree = summary.get("tmos_config")
    if not tree:
        return {"analysis_id": analysis_id, "apps": [], "partitions": []}
    return {
        "analysis_id": analysis_id,
        "partitions": list_partitions(tree),
        "apps": app_summary(tree, partition=partition),
    }


@app.get("/api/qkview/{analysis_id}/apps/{full_path:path}")
async def qkview_app_details(analysis_id: int, full_path: str):
    """Return the consolidated stanza set for a single virtual server."""
    if not full_path.startswith("/"):
        full_path = "/" + full_path
    summary = _load_summary(analysis_id)
    tree = summary.get("tmos_config")
    if not tree:
        raise HTTPException(status_code=404, detail="No TMOS config tree stored")
    details = app_details(tree, full_path)
    if details is None:
        raise HTTPException(status_code=404, detail=f"App not found: {full_path}")
    return {"analysis_id": analysis_id, "app": details}


# ---------------------------------------------------------------------------
# Log search (interactive, served from the persisted per-analysis FTS5 index)
# ---------------------------------------------------------------------------

_FIELD_FILTER_RE = re.compile(
    r'\b(log|severity|process)\s*:\s*("([^"]+)"|([^\s]+))',
    re.IGNORECASE,
)

_FTS_OPERATORS = {"AND", "OR", "NOT", "NEAR"}


def _maybe_prefix(tok: str) -> str:
    """Append `*` for FTS5 prefix matching on bare word tokens.

    Without this, FTS5 only matches whole tokens, so partial typing during
    interactive search ('pa', 'faile', 'Conf') silently returns nothing while
    the next keystroke ('pam', 'failed', 'ConfD' that happens to be a real
    token) suddenly returns thousands of hits. Surfaces as flickering empty
    results in the UI.

    Skips operators, quoted phrases, grouped expressions, tokens already
    ending in `*`, and tokens whose final character isn't alphanumeric (so
    we never produce `pam_*`, which the FTS5 parser rejects).
    """
    if not tok or tok.endswith("*"):
        return tok
    if tok.upper() in _FTS_OPERATORS:
        return tok
    if tok[0] in '"(' or tok[-1] in '")':
        return tok
    if not tok[-1].isalnum():
        return tok
    return tok + "*"


def _parse_log_query(q: str) -> tuple[Optional[str], dict[str, str]]:
    """Translate a Lucene-ish user query into (fts5_match, field_filters).

    Supports:
      - field filters: log:<name>, severity:<level>, process:<name>
      - quoted phrases: "user session"
      - FTS5 booleans (AND, OR, NOT) passed through verbatim
      - negation shorthand: -word  →  NOT word
      - implicit prefix matching on bare word tokens (pam → pam*)

    Anything else passes through to FTS5 as-is. Bad syntax surfaces as an
    sqlite error upstream, which the endpoint converts to HTTP 400.
    """
    if not q or not q.strip():
        return None, {}

    filters: dict[str, str] = {}
    def _capture(m: re.Match) -> str:
        key = m.group(1).lower()
        val = m.group(3) if m.group(3) is not None else m.group(4)
        filters[key] = val
        return ""
    stripped = _FIELD_FILTER_RE.sub(_capture, q).strip()

    if not stripped:
        return None, filters

    try:
        tokens = shlex.split(stripped, posix=False)
    except ValueError:
        return stripped, filters

    positives: list[str] = []
    negatives: list[str] = []
    for tok in tokens:
        if tok.startswith("-") and len(tok) > 1:
            negatives.append(_maybe_prefix(tok[1:]))
        else:
            positives.append(_maybe_prefix(tok))

    if positives and negatives:
        fts = f"({' '.join(positives)}) NOT ({' OR '.join(negatives)})"
    elif positives:
        fts = " ".join(positives)
    elif negatives:
        # FTS5 won't accept standalone negation — drop it and rely on filters.
        fts = None
    else:
        fts = None
    return fts, filters


def _open_logs_db(analysis_id: int) -> sqlite3.Connection:
    path = _logs_db_path(analysis_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Log index not found for this analysis")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# Per-analysis sources/chips aggregations are immutable once an analysis
# completes (the logs DB is written once, then read-only). On VELOS partition
# archives the chip counts iterate ~800k rows per pattern and take 12+ seconds
# the first time — cache forever, capped so a long-running worker visiting
# many analyses doesn't grow unbounded.
_LOG_SOURCES_CACHE: dict[int, dict] = {}
_LOG_SOURCES_CACHE_MAX = 64


@app.get("/api/qkview/{analysis_id}/logs/sources")
async def list_log_sources(analysis_id: int):
    """Return per-source log counts plus aggregated counts for the UI chips.

    `chips` maps a stable chip id (ltm / tmm / gtm / apm / asm / restjavad) to
    its total entry count across all rotated variants and path prefixes. A
    chip with count 0 means the log family wasn't present in the archive
    (typically because the module isn't provisioned).
    """
    cached = _LOG_SOURCES_CACHE.get(analysis_id)
    if cached is not None:
        return cached

    conn = _open_logs_db(analysis_id)
    try:
        all_sources = {
            row["source_file"]: row["cnt"]
            for row in conn.execute(
                "SELECT source_file, COUNT(*) as cnt FROM logs "
                "GROUP BY source_file ORDER BY cnt DESC"
            )
        }
        chips = {}
        for chip_id, patterns in LOG_CHIP_SOURCES.items():
            where = " OR ".join(["source_file LIKE ?"] * len(patterns))
            count = conn.execute(
                f"SELECT COUNT(*) FROM logs WHERE {where}", patterns
            ).fetchone()[0]
            chips[chip_id] = count
    finally:
        conn.close()

    payload = {
        "analysis_id": analysis_id,
        "chips": chips,
        "sources": all_sources,
    }
    if len(_LOG_SOURCES_CACHE) >= _LOG_SOURCES_CACHE_MAX:
        # Cheap FIFO eviction — drop oldest insertion. Dict iteration order
        # is insertion order in CPython 3.7+.
        _LOG_SOURCES_CACHE.pop(next(iter(_LOG_SOURCES_CACHE)))
    _LOG_SOURCES_CACHE[analysis_id] = payload
    return payload


@app.get("/api/qkview/{analysis_id}/logs")
async def search_logs(
    analysis_id: int,
    q: Optional[str] = Query(None, description="Search query (phrases, AND/OR/NOT, -word, log:/severity:/process:)"),
    source: Optional[str] = Query(None, description="Chip id (ltm, tmm, gtm, apm, asm, restjavad)"),
    severity: Optional[str] = Query(None, description="Minimum syslog severity (emerg..debug)"),
    process: Optional[str] = Query(None, description="Exact process name"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Query the persisted FTS5 log index for this analysis."""
    fts_match, parsed_filters = _parse_log_query(q or "")

    # Field filters from the query string override query-parsed filters only
    # when the query-string side wasn't set.
    src_chip = source or parsed_filters.get("log")
    sev = severity or parsed_filters.get("severity")
    proc = process or parsed_filters.get("process")

    conditions: list[str] = []
    params: list = []

    if sev:
        from qkview_analyzer.parser import SEVERITY_LEVELS
        sev_num = SEVERITY_LEVELS.get(sev.lower())
        if sev_num is None:
            raise HTTPException(status_code=400, detail=f"Unknown severity: {sev}")
        conditions.append("severity_num <= ?")
        params.append(sev_num)
    if proc:
        conditions.append("process = ?")
        params.append(proc)
    if src_chip:
        patterns = LOG_CHIP_SOURCES.get(src_chip.lower())
        if patterns is None:
            # Not a known chip — treat as an exact source_file name.
            conditions.append("source_file = ?")
            params.append(src_chip)
        else:
            or_clause = " OR ".join(["source_file LIKE ?"] * len(patterns))
            conditions.append(f"({or_clause})")
            params.extend(patterns)

    where = " AND ".join(conditions) if conditions else "1=1"

    if fts_match:
        sql = (
            "SELECT logs.timestamp, logs.hostname, logs.severity, logs.severity_num, "
            "       logs.process, logs.pid, logs.msg_code, logs.source_file, "
            "       logs.line_number, logs.raw_line "
            "FROM logs JOIN logs_fts ON logs.id = logs_fts.rowid "
            f"WHERE logs_fts MATCH ? AND {where} "
            "ORDER BY logs.timestamp_epoch ASC LIMIT ? OFFSET ?"
        )
        query_params = [fts_match, *params, limit, offset]
        count_sql = (
            "SELECT COUNT(*) FROM logs JOIN logs_fts ON logs.id = logs_fts.rowid "
            f"WHERE logs_fts MATCH ? AND {where}"
        )
        count_params = [fts_match, *params]
    else:
        sql = (
            "SELECT timestamp, hostname, severity, severity_num, process, pid, "
            "       msg_code, source_file, line_number, raw_line "
            f"FROM logs WHERE {where} "
            "ORDER BY timestamp_epoch ASC LIMIT ? OFFSET ?"
        )
        query_params = [*params, limit, offset]
        count_sql = f"SELECT COUNT(*) FROM logs WHERE {where}"
        count_params = list(params)

    conn = _open_logs_db(analysis_id)
    try:
        try:
            rows = [dict(r) for r in conn.execute(sql, query_params).fetchall()]
            total = conn.execute(count_sql, count_params).fetchone()[0]
        except sqlite3.OperationalError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid search query: {exc}")
    finally:
        conn.close()

    # Cap raw_line the same way /api/analyze does to keep the UI responsive
    # on pathological single-line entries.
    MAX_MESSAGE_BYTES = 2048
    for r in rows:
        raw = r.get("raw_line")
        if isinstance(raw, str) and len(raw) > MAX_MESSAGE_BYTES:
            r["raw_line"] = (
                raw[:MAX_MESSAGE_BYTES]
                + f"\n…[truncated, {len(raw) - MAX_MESSAGE_BYTES} more bytes]"
            )

    return {
        "analysis_id": analysis_id,
        "total": total,
        "limit": limit,
        "offset": offset,
        "entries": rows,
        "filters": {
            "q": q,
            "source": src_chip,
            "severity": sev,
            "process": proc,
        },
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("BACKEND_PORT", "8001"))
    uvicorn.run("main:app", host="127.0.0.1", port=port)
