#!/usr/bin/env python3
"""Per-stage timing of the analyze pipeline (RT#39).

Two modes, and the difference between them is the point of the tool:

``--stages`` runs the same stages ``POST /api/analyze`` runs, in the same
order, in this process, and prints wall time, peak RSS delta and output size
for each — so "where does a 60 s analysis go" has a measured answer rather
than a guess about tar handling.

``--http URL`` streams the archive to a RUNNING backend exactly as the
webapp does (raw octet-stream body, ``X-Filename`` header) and timestamps
every NDJSON event as it arrives: time to first byte, time to each progress
message, time to the ``result`` line, and the result's size. Subtracting the
two views separates producer cost (the stages) from transport cost (HTTP,
serialisation, the client-trim step, the queue).

stdlib only. Run from the repo root::

    .venv/bin/python scripts/profile_analyze.py --stages qkview/tmos_ve.qkview
    .venv/bin/python scripts/profile_analyze.py --http http://127.0.0.1:8001 qkview/partition.tar

Both modes accept several archives and print one table per archive plus a
JSON summary on stdout when ``--json`` is given (the tables go to stderr).
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))


def _rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


class Stage:
    def __init__(self, rows: list[dict]):
        self.rows = rows

    def __call__(self, name: str):
        stage = self

        class _Ctx:
            def __enter__(self_inner):
                self_inner.t0 = time.perf_counter()
                self_inner.r0 = _rss_mb()
                return self_inner

            def __exit__(self_inner, *exc):
                stage.rows.append({
                    "stage": name,
                    "seconds": round(time.perf_counter() - self_inner.t0, 3),
                    "peak_rss_mb_after": round(_rss_mb(), 1),
                    "note": getattr(self_inner, "note", ""),
                })
                return False

        return _Ctx()


def run_stages(path: Path) -> dict:
    """Mirror backend/main.py::analyze_qkview's worker, stage by stage."""
    from qkview_analyzer.extractor import extract_qkview
    from qkview_analyzer.parser import parse_all_logs, parse_f5os_event_log
    from qkview_analyzer.indexer import LogIndexer
    from qkview_analyzer.config_parser import (
        parse_bigip_conf, parse_bigip_base_conf, BigIPConfig,
    )
    from qkview_analyzer.rule_engine import RuleEngine
    from qkview_analyzer.reporter import Reporter
    from qkview_analyzer.tmos_config import parse_tmos_config, list_partitions, app_summary

    rows: list[dict] = []
    stage = Stage(rows)
    total0 = time.perf_counter()

    with stage("extract_qkview") as s:
        data = extract_qkview(str(path))
        s.note = f"{len(data.log_files)} log files, {len(data.config_files)} config files, product={data.meta.product}"

    with stage("parse_all_logs") as s:
        entries = parse_all_logs(data.log_files)
        s.note = f"{len(entries)} entries"

    is_f5os = data.meta.product == "F5OS"
    if is_f5os:
        with stage("parse_f5os_event_logs") as s:
            n0 = len(entries)
            if data.f5os_event_log:
                entries.extend(parse_f5os_event_log(data.f5os_event_log, source_file="event-log.log"))
            if data.f5os_system_events:
                entries.extend(parse_f5os_event_log(data.f5os_system_events, source_file="system-events"))
            entries.sort(key=lambda e: e.timestamp)
            s.note = f"+{len(entries) - n0} entries, sorted"

    with stage("LogIndexer.bulk_insert (in-memory)") as s:
        indexer = LogIndexer()
        indexer.bulk_insert(entries)
        s.note = f"{len(entries)} entries indexed"
    n_entries = len(entries)
    entries = []

    config = BigIPConfig()
    tmos_tree: dict = {}
    if not is_f5os:
        with stage("parse_bigip_conf + base") as s:
            if "config/bigip.conf" in data.config_files:
                config = parse_bigip_conf(data.config_files["config/bigip.conf"])
            if "config/bigip_base.conf" in data.config_files:
                base = parse_bigip_base_conf(data.config_files["config/bigip_base.conf"])
                config.vlans = base.vlans
                config.self_ips = base.self_ips
            s.note = f"{len(config.virtual_servers) if hasattr(config, 'virtual_servers') else '?'} virtuals"
        with stage("parse_tmos_config (universal tree)") as s:
            names = ["config/bigip.conf", "config/bigip_base.conf", "config/bigip_gtm.conf"] + sorted(
                n for n in data.config_files if n.startswith("config/partitions/") and n.endswith(".conf")
            )
            combined = "\n".join(data.config_files.get(n, "") for n in names)
            if combined.strip():
                tmos_tree = parse_tmos_config(combined)
            s.note = f"{len(combined)} bytes of config"

    with stage("RuleEngine.scan") as s:
        engine = RuleEngine(platform="f5os" if is_f5os else "tmos")
        findings = engine.scan(indexer)
        s.note = f"{len(engine.rules)} rules, {len(findings)} findings"

    with stage("indexer.query(warning, 5000)") as s:
        queried = indexer.query(min_severity="warning", limit=5000)
        s.note = f"{len(queried)} rows"

    with stage("Reporter.to_json") as s:
        json_str = Reporter.to_json(data.meta, queried, findings, config if not is_f5os else None, qkview_data=data)
        s.note = f"{len(json_str) / 1e6:.2f} MB"

    with stage("json.loads + inject tmos_tree + json.dumps") as s:
        summary = json.loads(json_str)
        if tmos_tree:
            summary["tmos_config"] = tmos_tree
            summary["partitions"] = list_partitions(tmos_tree)
            summary["apps"] = app_summary(tmos_tree)
        persisted = json.dumps(summary, default=str)
        s.note = f"persisted {len(persisted) / 1e6:.2f} MB"

    with stage("client trim (entries[:300], drop tmos_config)") as s:
        client = {k: v for k, v in summary.items() if k != "tmos_config"}
        if isinstance(client.get("entries"), list):
            client["entries"] = client["entries"][:300]
        client_bytes = len(json.dumps({"type": "result", "data": client}, default=str))
        s.note = f"client payload {client_bytes / 1e6:.2f} MB"

    indexer.close()
    total = time.perf_counter() - total0
    return {
        "archive": path.name,
        "size_mb": round(path.stat().st_size / 1e6, 1),
        "product": data.meta.product,
        "entries": n_entries,
        "total_seconds": round(total, 2),
        "client_payload_mb": round(client_bytes / 1e6, 2),
        "stages": rows,
    }


def run_http(base_url: str, path: Path) -> dict:
    """Stream the archive to a running backend and timestamp every NDJSON event."""
    url = base_url.rstrip("/") + "/api/analyze"
    size = path.stat().st_size
    events: list[dict] = []
    t0 = time.perf_counter()
    with open(path, "rb") as fh:
        req = urllib.request.Request(url, data=fh, method="POST", headers={
            "Content-Type": "application/octet-stream",
            "X-Filename": path.name,
            "Content-Length": str(size),
        })
        resp = urllib.request.urlopen(req)
        t_upload_done_and_headers = time.perf_counter() - t0
        first_byte = None
        result_bytes = 0
        while True:
            line = resp.readline()
            if not line:
                break
            now = time.perf_counter() - t0
            if first_byte is None:
                first_byte = now
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                events.append({"t": round(now, 3), "type": "unparseable", "bytes": len(line)})
                continue
            if ev.get("type") == "result":
                result_bytes = len(line)
                events.append({"t": round(now, 3), "type": "result", "bytes": len(line),
                               "analysis_id": ev.get("data", {}).get("analysis_id")})
            else:
                events.append({"t": round(now, 3), "type": ev.get("type"), "msg": ev.get("msg") or ev.get("detail")})
    total = time.perf_counter() - t0
    progress = [e for e in events if e["type"] == "progress"]
    last_progress = progress[-1]["t"] if progress else None
    result_t = next((e["t"] for e in events if e["type"] == "result"), None)
    return {
        "archive": path.name,
        "size_mb": round(size / 1e6, 1),
        "response_headers_at": round(t_upload_done_and_headers, 3),
        "first_event_at": round(first_byte, 3) if first_byte is not None else None,
        "last_progress_at": last_progress,
        "result_at": result_t,
        "result_mb": round(result_bytes / 1e6, 2),
        "gap_last_progress_to_result_s": round(result_t - last_progress, 3) if result_t and last_progress else None,
        "total_seconds": round(total, 2),
        "events": events,
    }


def _print_stages(r: dict) -> None:
    err = sys.stderr
    print(f"\n== {r['archive']}  ({r['size_mb']} MB, {r['product']}, {r['entries']} log entries)  "
          f"total {r['total_seconds']} s, client payload {r['client_payload_mb']} MB", file=err)
    print(f"  {'stage':50} {'seconds':>9} {'%':>6} {'RSS MB':>8}  note", file=err)
    for s in r["stages"]:
        pct = 100.0 * s["seconds"] / r["total_seconds"] if r["total_seconds"] else 0
        print(f"  {s['stage']:50} {s['seconds']:9.3f} {pct:6.1f} {s['peak_rss_mb_after']:8.0f}  {s['note']}", file=err)


def _print_http(r: dict) -> None:
    err = sys.stderr
    print(f"\n== HTTP {r['archive']} ({r['size_mb']} MB): headers {r['response_headers_at']} s, "
          f"first event {r['first_event_at']} s, last progress {r['last_progress_at']} s, "
          f"result {r['result_at']} s ({r['result_mb']} MB), total {r['total_seconds']} s, "
          f"gap last-progress→result {r['gap_last_progress_to_result_s']} s", file=err)
    prev = 0.0
    for e in r["events"]:
        delta = e["t"] - prev
        prev = e["t"]
        print(f"  {e['t']:9.3f}  +{delta:7.3f}  {e['type']:9} {e.get('msg') or ('%d bytes' % e.get('bytes', 0))}", file=err)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("archives", nargs="+", type=Path)
    ap.add_argument("--stages", action="store_true", help="run the pipeline stages in-process and time each")
    ap.add_argument("--http", metavar="URL", help="stream to a running backend and time the NDJSON events")
    ap.add_argument("--json", action="store_true", help="print the measurements as JSON on stdout")
    args = ap.parse_args(argv)
    if not args.stages and not args.http:
        ap.error("choose --stages and/or --http URL")
    out = []
    for path in args.archives:
        if not path.exists():
            print(f"{path}: missing", file=sys.stderr)
            return 2
        if args.stages:
            r = run_stages(path)
            _print_stages(r)
            out.append({"mode": "stages", **r})
        if args.http:
            r = run_http(args.http, path)
            _print_http(r)
            out.append({"mode": "http", **r})
    if args.json:
        print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
