"""Offline proof for scripts/har_scrub.py (RT#38).

Every guard is negative-tested: the test that a rule fires is paired with the
test that its absence is caught, because a scrubber whose verification pass
cannot fail is one you trust blind.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import har_scrub  # noqa: E402


def _har(entries):
    return {"log": {"version": "1.2", "creator": {"name": "t"}, "entries": entries}}


def _entry(url, req_headers=(), resp_text="", post_text=None, cookies=()):
    e = {
        "request": {
            "method": "GET",
            "url": url,
            "headers": [{"name": n, "value": v} for n, v in req_headers],
            "cookies": [{"name": n, "value": v} for n, v in cookies],
        },
        "response": {
            "status": 200,
            "headers": [],
            "cookies": [],
            "content": {"mimeType": "application/json", "text": resp_text},
        },
        "time": 1.0,
    }
    if post_text is not None:
        e["request"]["postData"] = {"mimeType": "text/plain", "text": post_text}
    return e


def _run(har, patterns=None):
    s = har_scrub.Scrubber(patterns or har_scrub.Patterns([]))
    out = s.scrub_document(json.loads(json.dumps(har)))
    text = json.dumps(out)
    return out, text, s


# ---- hostnames -----------------------------------------------------------

def test_customer_fqdn_in_url_and_body_is_rewritten_consistently():
    har = _har([_entry(
        "http://localhost:3001/api/qkview/1/apps/Common/api.prod.acme-corp.com_443",
        resp_text='{"name": "api.prod.acme-corp.com_443", "dest": "API.PROD.ACME-CORP.COM"}',
    )])
    out, text, s = _run(har)
    assert "acme-corp" not in text.lower()
    assert list(s.host_map.values()) == ["h1.example.net"]
    # same real name, any case → one synthetic name
    assert text.count("h1.example.net") == 3


def test_allowlisted_names_are_untouched():
    har = _har([_entry(
        "http://localhost:3001/x",
        resp_text="grafana.home.arpa downloads.f5.com fonts.googleapis.com node1.chassis.local",
    )])
    _, text, s = _run(har)
    for name in ("grafana.home.arpa", "downloads.f5.com", "fonts.googleapis.com", "node1.chassis.local"):
        assert name in text
    assert s.host_map == {}


def test_bundle_paths_are_not_mistaken_for_hostnames():
    """`layout.js` / `page.tsx` must survive, or a replayed capture 404s."""
    har = _har([_entry("http://localhost:3001/_next/static/chunks/app/layout.js",
                       resp_text="import('./page.tsx'); e.t.length; x.md")])
    _, text, s = _run(har)
    assert "layout.js" in text and "page.tsx" in text and "e.t.length" in text
    assert s.host_map == {}


def test_iapp_folder_names_are_not_hostnames():
    har = _har([_entry("http://localhost:3001/api/qkview/1/apps/DMZ/dmz.app/dmz_IP_Forwarding")])
    _, text, s = _run(har)
    assert "DMZ/dmz.app/dmz_IP_Forwarding" in text and s.host_map == {}


# ---- addresses -----------------------------------------------------------

def test_ipv4_maps_into_rfc5737_and_keeps_loopback():
    har = _har([_entry("http://127.0.0.1:8001/x",
                       resp_text="member 10.1.2.3:9443 and 172.20.30.40 and 0.0.0.0 and 255.255.255.255")])
    _, text, s = _run(har)
    assert "10.1.2.3" not in text and "172.20.30.40" not in text
    assert "127.0.0.1" in text and "0.0.0.0" in text and "255.255.255.255" in text
    assert s.ip_map["10.1.2.3"] == "192.0.2.1"
    assert s.ip_map["172.20.30.40"] == "192.0.2.2"


def test_underscore_joined_address_in_object_name_uses_same_table():
    har = _har([_entry("http://localhost:3001/api/qkview/2/apps/Common/vs_172_20_30_40_53_gtm",
                       resp_text='{"destination": "172.20.30.40:53"}')])
    _, text, s = _run(har)
    assert "172_20_30_40" not in text and "172.20.30.40" not in text
    synthetic = s.ip_map["172.20.30.40"]
    assert synthetic.replace(".", "_") in text and synthetic in text


def test_version_strings_with_out_of_range_octets_are_left_alone():
    har = _har([_entry("http://localhost:3001/x", resp_text="next 16.3.0.1288 build 1.7.7.588")])
    _, text, s = _run(har)
    assert "1.7.7.588" in text
    assert "1.7.7.588" not in s.ip_map


def test_synthetic_space_is_stable_and_not_rewritten_twice():
    har = _har([_entry("http://localhost:3001/x", resp_text="192.0.2.1 already synthetic; 10.0.0.1 real")])
    _, text, s = _run(har)
    assert s.ip_map == {"10.0.0.1": "192.0.2.1"}
    # the pre-existing synthetic and the new one now collide by design of the
    # range, but nothing real survives
    assert "10.0.0.1" not in text


# ---- headers -------------------------------------------------------------

def test_cookie_and_authorization_are_blanked_and_x_filename_synthesised():
    har = _har([_entry(
        "http://localhost:3001/api/analyze",
        req_headers=[("Cookie", "session=abc"), ("Authorization", "Bearer x"),
                     ("X-Filename", "customer-device.tgz"), ("Accept", "*/*")],
        cookies=[("session", "abc")],
    )])
    out, text, s = _run(har)
    hdrs = {h["name"]: h["value"] for h in out["log"]["entries"][0]["request"]["headers"]}
    assert hdrs["Cookie"] == "[scrubbed]" and hdrs["Authorization"] == "[scrubbed]"
    assert hdrs["X-Filename"] == "archive1.tgz"
    assert hdrs["Accept"] == "*/*"
    assert out["log"]["entries"][0]["request"]["cookies"] == []
    assert "customer-device" not in text


def test_tar_gz_filename_keeps_double_suffix():
    har = _har([_entry("http://localhost:3001/api/analyze",
                       req_headers=[("X-Filename", "site-b.tar.gz")])])
    out, _, _ = _run(har)
    hdrs = {h["name"]: h["value"] for h in out["log"]["entries"][0]["request"]["headers"]}
    assert hdrs["X-Filename"] == "archive1.tar.gz"


# ---- literal patterns ----------------------------------------------------

def test_patterns_file_literal_and_regex(tmp_path):
    note = tmp_path / "pats.txt"
    note.write_text("# comment\nacmeSvc\tvsAlpha\nre:ZZQM-\\d+\tvsBeta\n", encoding="utf-8")
    pats = har_scrub.Patterns.load(note)
    har = _har([_entry("http://localhost:3001/api/qkview/3/apps/Common/ZZQM-8181",
                       resp_text='{"name": "ACMESVC_Listener"}')])
    _, text, s = _run(har, pats)
    assert "ZZQM" not in text and "acmesvc" not in text.lower()
    assert "vsBeta" in text and "vsAlpha_Listener" in text
    assert s.counts["pattern"] == 2


def test_patterns_file_refuses_line_without_tab(tmp_path):
    note = tmp_path / "pats.txt"
    note.write_text("justonefield\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        har_scrub.Patterns.load(note)


def test_patterns_file_refuses_replacement_matching_its_own_pattern(tmp_path):
    """Such a rule makes the verification pass structurally unable to pass."""
    note = tmp_path / "pats.txt"
    note.write_text("acme\tacme-scrubbed\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        har_scrub.Patterns.load(note)


def test_missing_patterns_file_means_no_rules_not_a_crash(tmp_path):
    assert har_scrub.Patterns.load(tmp_path / "absent").rules == []


# ---- verification --------------------------------------------------------

def test_survivors_catches_a_hostname_that_escaped():
    s = har_scrub.Scrubber(har_scrub.Patterns([]))
    s._map_host("api.acme-corp.com")
    assert har_scrub.survivors('{"x": "api.acme-corp.com"}', s) == ["hostname api.acme-corp.com"]
    assert har_scrub.survivors('{"x": "h1.example.net"}', s) == []


def test_survivors_catches_an_address_in_either_form():
    s = har_scrub.Scrubber(har_scrub.Patterns([]))
    s._map_ip("10.1.2.3")
    assert har_scrub.survivors("vs_10_1_2_3_443", s) == ["ipv4_underscore 10_1_2_3"]
    assert har_scrub.survivors("10.1.2.3", s) == ["ipv4 10.1.2.3"]
    assert har_scrub.survivors("110.1.2.30", s) == []  # not the same address


def test_survivors_catches_a_literal_pattern(tmp_path):
    note = tmp_path / "pats.txt"
    note.write_text("acmeSvc\tvsAlpha\n", encoding="utf-8")
    s = har_scrub.Scrubber(har_scrub.Patterns.load(note))
    assert har_scrub.survivors("AcmeSvc lives", s) == ["pattern acmeSvc"]


def test_scrub_file_refuses_to_write_when_a_survivor_exists(tmp_path, monkeypatch):
    """Inject a survivor by making the address rule inert; the file must not land."""
    src = tmp_path / "cap.har"
    src.write_text(json.dumps(_har([_entry("http://localhost:3001/x", resp_text="10.1.2.3")])))
    monkeypatch.setattr(har_scrub.Scrubber, "scrub_text", lambda self, s: s)
    # the map must still record the address for the verifier to look for it
    orig_init = har_scrub.Scrubber.__init__

    def init(self, patterns):
        orig_init(self, patterns)
        self._map_ip("10.1.2.3")

    monkeypatch.setattr(har_scrub.Scrubber, "__init__", init)
    dest, _, bad = har_scrub.scrub_file(src, None, har_scrub.Patterns([]), False, lambda s: None)
    assert dest is None and bad == ["ipv4 10.1.2.3"]
    assert not (tmp_path / "cap.scrubbed.har").exists()


def test_end_to_end_writes_scrubbed_file_and_map(tmp_path):
    src = tmp_path / "cap.har"
    src.write_text(json.dumps(_har([_entry(
        "http://localhost:3001/api/qkview/1/apps/Common/api.acme-corp.com_443",
        req_headers=[("X-Filename", "dev.tgz")],
        resp_text='{"members": {"/Common/10.1.2.3:9443": {}}}',
    )])))
    mapf = tmp_path / "map.json"
    rc = har_scrub.main([str(src), "--patterns", str(tmp_path / "none"), "--map", str(mapf)])
    assert rc == 0
    out = (tmp_path / "cap.scrubbed.har").read_text()
    assert "acme-corp" not in out and "10.1.2.3" not in out and "dev.tgz" not in out
    m = json.loads(mapf.read_text())
    assert m["cap.har"]["hosts"] == {"api.acme-corp.com": "h1.example.net"}
    assert m["cap.har"]["ips"] == {"10.1.2.3": "192.0.2.1"}
    assert oct(mapf.stat().st_mode & 0o777) == "0o600"
    # a second, verify-only pass over the OUTPUT reports it clean
    assert har_scrub.main([str(tmp_path / "cap.scrubbed.har"), "--verify-only",
                           "--patterns", str(tmp_path / "none")]) == 0
    # and over the INPUT reports identifiers present
    assert har_scrub.main([str(src), "--verify-only", "--patterns", str(tmp_path / "none")]) == 1


def test_drop_static_empties_non_api_bodies_only(tmp_path):
    har = _har([
        _entry("http://localhost:3001/_next/static/chunks/main.js", resp_text="var a=1;"),
        _entry("http://localhost:3001/api/qkview/1/apps/Common/x", resp_text='{"k": 1}'),
    ])
    s = har_scrub.Scrubber(har_scrub.Patterns([]))
    out = s.scrub_document(har, drop_static=True)
    assert out["log"]["entries"][0]["response"]["content"]["text"] == ""
    assert out["log"]["entries"][1]["response"]["content"]["text"] == '{"k": 1}'
