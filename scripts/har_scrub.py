#!/usr/bin/env python3
"""Scrub customer identifiers out of browser HAR captures (RT#38).

A HAR recorded against this app carries whatever the analysed archive carried:
virtual-server names in drill-down URLs, pool-member addresses and VLAN names
in the drill-down JSON, the archive's filename in the ``X-Filename`` header,
and log lines from the search endpoint. Those captures are gitignored
(``*.har``) precisely because of that, which also means they cannot be used
for CI or benchmarking. This tool rewrites a capture so it can.

Three rewrite rules, applied to EVERY string in the document (URLs, headers,
query strings, post bodies, response bodies, page titles):

1. **Literal patterns** from a local, gitignored note (default
   ``.har_scrub_patterns.txt`` beside this repo's root). One rule per line,
   ``pattern<TAB>replacement``; prefix the pattern with ``re:`` for a regex.
   Literal matches are case-insensitive. This is where customer domains,
   device-name prefixes and archive filenames go — the note is the only place
   the real strings are written down, and it never leaves this machine.
2. **Hostnames**: any FQDN that is not on the allow-list (localhost,
   ``*.f5.com``, ``*.home.arpa``, RFC 2606 example domains, framework CDNs) is
   mapped to ``h<N>.example.net``, one synthetic name per distinct real name,
   in order of first appearance.
3. **IPv4 addresses**: every address outside loopback / unspecified /
   broadcast / multicast is mapped into RFC 5737 (``192.0.2.0/24``,
   ``198.51.100.0/24``, ``203.0.113.0/24``) and, once those 762 hosts are
   used, into the RFC 2544 benchmarking block ``198.18.0.0/15``. The same
   table is applied to underscore-joined forms (``vs_10_1_2_3_443``), which
   is how TMOS object names embed addresses.

Cookie, Set-Cookie and Authorization header values are blanked
unconditionally; ``X-Filename`` values become ``archive<N>.<ext>``.

The output is VERIFIED before it is written: the scrubbed text is re-scanned
for every original hostname and address the run mapped and for every literal
pattern, and a single survivor is a hard failure (exit 2). ``--verify-only``
runs that scan against an existing file without writing anything.

The real→synthetic table is written to ``.har_scrub_map.json`` next to the
patterns note. Both are gitignored; neither may be committed.

stdlib only — this repo's dependency budget is deliberate.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import sys
from pathlib import Path
from typing import Callable, Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATTERNS = REPO_ROOT / ".har_scrub_patterns.txt"
DEFAULT_MAP = REPO_ROOT / ".har_scrub_map.json"

# Names that are not customer identifiers. Suffix match on the whole label
# boundary — "f5.com" matches "x.f5.com" and "f5.com", never "notf5.com".
HOST_ALLOW_SUFFIXES = (
    "localhost",
    "f5.com",
    "f5.net",
    "f5networks.com",
    "home.arpa",
    "example.com",
    "example.net",
    "example.org",
    "example",
    "invalid",
    "test",
    "w3.org",
    "mozilla.org",
    "nextjs.org",
    "react.dev",
    "vercel.app",
    "vercel.com",
    "github.com",
    "npmjs.com",
    "googleapis.com",
    "gstatic.com",
    "ietf.org",
    "chassis.local",  # VELOS internal OpenShift node names, not customer data
)

# A conservative TLD set: real hostnames in these captures end in one of
# these. Minified JavaScript is full of dotted member chains (`e.t.length`)
# that a looser rule would rewrite, which would break a replayed capture.
_TLDS = (
    "com|net|org|io|edu|gov|mil|biz|info|co|us|uk|ca|de|au|eu|"
    "local|lan|corp|internal|intra|arpa|home|test|example|invalid|"
    "cloud|dev|inc|store|shop|retail|bank|health|systems|tech|"
    "services|solutions|group|global|network|online|site"
)
# No two-letter catch-all: it would match `layout.js`, `page.tsx` and `x.md`
# in every bundle URL. Add a ccTLD explicitly if a capture ever needs one.
# No `app` either: TMOS iApp folders are named `<service>.app` and appear in
# every drill-down URL (`DMZ/dmz.app/dmz_IP_Forwarding`); rewriting one to a
# synthetic hostname is harmless but misleading.
# Boundaries deliberately ADMIT `_`: TMOS object names embed identifiers as
# `host.example.com_443_tt` and `vs_10_1_2_3_443`, and a rule that stops at a
# word boundary leaves exactly those in place.
HOST_RE = re.compile(
    r"(?<![A-Za-z0-9.-])"
    r"((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:" + _TLDS + r"))"
    r"(?![A-Za-z0-9-])",
    re.IGNORECASE,
)
IPV4_RE = re.compile(r"(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?![\d.])")
IPV4_UNDERSCORE_RE = re.compile(r"(?<!\d)((?:\d{1,3}_){3}\d{1,3})(?!\d)")

_RFC5737 = [
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
]
_OVERFLOW = ipaddress.ip_network("198.18.0.0/15")
_SYNTHETIC_NETS = _RFC5737 + [_OVERFLOW]

BLANK_HEADERS = {"cookie", "set-cookie", "authorization", "proxy-authorization"}


def _is_valid_ipv4(s: str) -> bool:
    try:
        ipaddress.IPv4Address(s)
    except ValueError:
        return False
    return True


def _keep_ip(ip: ipaddress.IPv4Address) -> bool:
    """Addresses that carry no customer information and must not be rewritten."""
    if ip.is_loopback or ip.is_unspecified or ip.is_multicast:
        return True
    if ip == ipaddress.IPv4Address("255.255.255.255"):
        return True
    return any(ip in n for n in _SYNTHETIC_NETS)


def _host_allowed(host: str) -> bool:
    h = host.lower().rstrip(".")
    for suf in HOST_ALLOW_SUFFIXES:
        if h == suf or h.endswith("." + suf):
            return True
    return False


class Patterns:
    """The gitignored literal/regex rule list."""

    def __init__(self, rules: list[tuple[re.Pattern, str, str]]):
        self.rules = rules  # (compiled, replacement, display)

    @classmethod
    def load(cls, path: Path | None) -> "Patterns":
        rules: list[tuple[re.Pattern, str, str]] = []
        if path is None or not path.exists():
            return cls(rules)
        for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            line = raw.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if "\t" not in line:
                raise SystemExit(
                    f"{path}:{lineno}: expected 'pattern<TAB>replacement'"
                )
            pat, repl = line.split("\t", 1)
            if pat.startswith("re:"):
                compiled = re.compile(pat[3:], re.IGNORECASE)
                display = pat
            else:
                compiled = re.compile(re.escape(pat), re.IGNORECASE)
                display = pat
            if compiled.search(repl):
                raise SystemExit(
                    f"{path}:{lineno}: replacement still matches its own pattern; "
                    "the verification pass could never pass"
                )
            rules.append((compiled, repl, display))
        return cls(rules)


class Scrubber:
    def __init__(self, patterns: Patterns):
        self.patterns = patterns
        self.host_map: dict[str, str] = {}
        self.ip_map: dict[str, str] = {}
        self.filename_map: dict[str, str] = {}
        self.counts: dict[str, int] = {
            "pattern": 0,
            "hostname": 0,
            "ipv4": 0,
            "ipv4_underscore": 0,
            "header_blanked": 0,
            "filename": 0,
        }
        self._ip_iter = self._synthetic_ips()

    @staticmethod
    def _synthetic_ips() -> Iterable[str]:
        for net in _SYNTHETIC_NETS:
            for host in net.hosts():
                yield str(host)

    # ---- mapping ---------------------------------------------------------
    def _map_host(self, host: str) -> str:
        key = host.lower().rstrip(".")
        if key not in self.host_map:
            self.host_map[key] = f"h{len(self.host_map) + 1}.example.net"
        return self.host_map[key]

    def _map_ip(self, ip: str) -> str:
        if ip not in self.ip_map:
            try:
                self.ip_map[ip] = next(self._ip_iter)
            except StopIteration:  # pragma: no cover - 131k addresses
                raise SystemExit("synthetic address space exhausted")
        return self.ip_map[ip]

    # ---- string rewrite --------------------------------------------------
    def scrub_text(self, s: str) -> str:
        if not s:
            return s
        for compiled, repl, _ in self.patterns.rules:
            s, n = compiled.subn(repl, s)
            self.counts["pattern"] += n

        def host_sub(m: re.Match) -> str:
            host = m.group(1)
            if _host_allowed(host):
                return host
            self.counts["hostname"] += 1
            return self._map_host(host)

        s = HOST_RE.sub(host_sub, s)

        def ip_sub(m: re.Match) -> str:
            ip = m.group(1)
            if not _is_valid_ipv4(ip) or _keep_ip(ipaddress.IPv4Address(ip)):
                return ip
            self.counts["ipv4"] += 1
            return self._map_ip(ip)

        s = IPV4_RE.sub(ip_sub, s)

        def ip_us_sub(m: re.Match) -> str:
            dotted = m.group(1).replace("_", ".")
            if not _is_valid_ipv4(dotted) or _keep_ip(ipaddress.IPv4Address(dotted)):
                return m.group(1)
            self.counts["ipv4_underscore"] += 1
            return self._map_ip(dotted).replace(".", "_")

        s = IPV4_UNDERSCORE_RE.sub(ip_us_sub, s)
        return s

    def _scrub_filename(self, name: str) -> str:
        if name not in self.filename_map:
            ext = "".join(Path(name).suffixes[-2:]) if name.endswith(".tar.gz") else Path(name).suffix
            self.filename_map[name] = f"archive{len(self.filename_map) + 1}{ext}"
        self.counts["filename"] += 1
        return self.filename_map[name]

    # ---- document walk ---------------------------------------------------
    def scrub_headers(self, headers: list) -> None:
        for h in headers:
            if not isinstance(h, dict):
                continue
            name = str(h.get("name", "")).lower()
            if name in BLANK_HEADERS:
                if h.get("value"):
                    h["value"] = "[scrubbed]"
                    self.counts["header_blanked"] += 1
            elif name == "x-filename" and h.get("value"):
                h["value"] = self._scrub_filename(str(h["value"]))

    def scrub_document(self, har: dict, drop_static: bool = False) -> dict:
        log = har.get("log", {})
        for entry in log.get("entries", []):
            req = entry.get("request", {})
            resp = entry.get("response", {})
            self.scrub_headers(req.get("headers", []))
            self.scrub_headers(resp.get("headers", []))
            for side in (req, resp):
                if side.get("cookies"):
                    self.counts["header_blanked"] += len(side["cookies"])
                    side["cookies"] = []
            if drop_static and "/api/" not in str(req.get("url", "")):
                content = resp.get("content")
                if isinstance(content, dict) and content.get("text"):
                    content["text"] = ""
                    content["_scrubbed"] = "static body dropped"
        return self._walk(har)

    def _walk(self, node):
        if isinstance(node, str):
            return self.scrub_text(node)
        if isinstance(node, list):
            return [self._walk(x) for x in node]
        if isinstance(node, dict):
            return {k: self._walk(v) for k, v in node.items()}
        return node


# ---- verification --------------------------------------------------------
def survivors(text: str, scrubber: Scrubber) -> list[str]:
    """Every original identifier that still appears in the scrubbed text."""
    found: list[str] = []
    lowered = text.lower()
    for host in scrubber.host_map:
        if re.search(r"(?<![a-z0-9.-])" + re.escape(host) + r"(?![a-z0-9-])", lowered):
            found.append(f"hostname {host}")
    for ip in scrubber.ip_map:
        if re.search(r"(?<![\d.])" + re.escape(ip) + r"(?![\d.])", text):
            found.append(f"ipv4 {ip}")
        us = ip.replace(".", "_")
        if re.search(r"(?<!\d)" + re.escape(us) + r"(?!\d)", text):
            found.append(f"ipv4_underscore {us}")
    for name in scrubber.filename_map:
        if name in text:
            found.append(f"filename {name}")
    for compiled, _, display in scrubber.patterns.rules:
        if compiled.search(text):
            found.append(f"pattern {display}")
    return found


def scan_only(text: str, patterns: Patterns) -> dict[str, int]:
    """Counts for --verify-only: what a scrub run WOULD touch in this text."""
    hosts = {h.lower() for h in HOST_RE.findall(text) if not _host_allowed(h)}
    ips = {
        ip for ip in IPV4_RE.findall(text)
        if _is_valid_ipv4(ip) and not _keep_ip(ipaddress.IPv4Address(ip))
    }
    pats = sum(len(c.findall(text)) for c, _, _ in patterns.rules)
    return {"hostnames": len(hosts), "ipv4": len(ips), "pattern_hits": pats}


# ---- cli -----------------------------------------------------------------
def scrub_file(path: Path, out_dir: Path | None, patterns: Patterns,
               drop_static: bool, log: Callable[[str], None]) -> tuple[Path | None, Scrubber, list[str]]:
    raw = path.read_text(encoding="utf-8")
    har = json.loads(raw)
    scrubber = Scrubber(patterns)
    scrubbed = scrubber.scrub_document(har, drop_static=drop_static)
    text = json.dumps(scrubbed, ensure_ascii=False, separators=(",", ":"))
    bad = survivors(text, scrubber)
    if bad:
        return None, scrubber, bad
    dest_dir = out_dir or path.parent
    dest = dest_dir / (path.stem + ".scrubbed.har")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8")
    return dest, scrubber, []


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("har", nargs="+", type=Path)
    ap.add_argument("--patterns", type=Path, default=DEFAULT_PATTERNS,
                    help=f"gitignored literal/regex rule list (default {DEFAULT_PATTERNS.name})")
    ap.add_argument("--out", type=Path, default=None, help="output directory (default: beside input)")
    ap.add_argument("--map", type=Path, default=DEFAULT_MAP,
                    help="where the real→synthetic table is written (gitignored)")
    ap.add_argument("--drop-static", action="store_true",
                    help="empty response bodies of non-/api/ entries (JS bundles) to shrink the output")
    ap.add_argument("--verify-only", action="store_true",
                    help="report what would be rewritten; write nothing")
    args = ap.parse_args(argv)

    log = lambda s: print(s, file=sys.stderr)  # noqa: E731
    patterns = Patterns.load(args.patterns)
    log(f"patterns: {len(patterns.rules)} rule(s) from {args.patterns if args.patterns.exists() else '(none)'}")

    rc = 0
    combined_map: dict[str, dict] = {}
    for path in args.har:
        if not path.exists():
            log(f"{path}: MISSING")
            rc = 2
            continue
        if args.verify_only:
            counts = scan_only(path.read_text(encoding="utf-8"), patterns)
            state = "CLEAN" if not any(counts.values()) else "IDENTIFIERS PRESENT"
            log(f"{path.name}: {state} {counts}")
            if state != "CLEAN":
                rc = max(rc, 1)
            continue
        dest, scrubber, bad = scrub_file(path, args.out, patterns, args.drop_static, log)
        if bad:
            log(f"{path.name}: FAILED verification — {len(bad)} identifier(s) survived the scrub:")
            for b in bad[:20]:
                log(f"    {b}")
            rc = 2
            continue
        log(f"{path.name} -> {dest}  {scrubber.counts}  "
            f"hosts={len(scrubber.host_map)} ips={len(scrubber.ip_map)} files={len(scrubber.filename_map)}")
        combined_map[path.name] = {
            "hosts": scrubber.host_map,
            "ips": scrubber.ip_map,
            "filenames": scrubber.filename_map,
        }
    if combined_map and not args.verify_only:
        args.map.write_text(json.dumps(combined_map, indent=2, sort_keys=True), encoding="utf-8")
        os.chmod(args.map, 0o600)
        log(f"map written: {args.map} (mode 0600, gitignored)")
    return rc


if __name__ == "__main__":
    sys.exit(main())
