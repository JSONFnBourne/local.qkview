"""Tests for the TMOS-config-derived inventories used by the webapp:
provisioned modules, non-default DB variables, and CM redundancy topology.

These parse bigip_base.conf stanzas; the fixtures here are synthetic config
snippets (no customer data) modeled on real TMOS layout.
"""

from qkview_analyzer.config_parser import (
    parse_sys_provision,
    parse_cm_redundancy,
)


PROVISION_CONF = """
sys provision ltm { }
sys provision asm {
    level dedicated
}
sys provision apm {
    level nominal
}
sys provision avr {
    level minimum
}
"""


def test_parse_sys_provision_levels_and_names():
    mods = parse_sys_provision(PROVISION_CONF)
    by_module = {m["module"]: m for m in mods}

    # Bare `{ }` stanza means default level (nominal).
    assert by_module["ltm"]["level"] == "nominal"
    assert by_module["ltm"]["name"] == "Local Traffic Manager"

    assert by_module["asm"]["level"] == "dedicated"
    assert by_module["asm"]["name"] == "Application Security Manager"
    assert by_module["apm"]["level"] == "nominal"
    assert by_module["avr"]["level"] == "minimum"


def test_parse_sys_provision_ignores_unprovisioned():
    # Modules at the default `none` are absent from config, so absent => not
    # provisioned. gtm never appears in PROVISION_CONF.
    assert "gtm" not in {m["module"] for m in parse_sys_provision(PROVISION_CONF)}


def test_parse_sys_provision_injects_default_ltm():
    # LTM defaults to nominal and TMOS omits its stanza when at the default —
    # real archives (e.g. iseries.qkview) show only avr/gtm in config. The
    # parser must still surface LTM so the panel matches iHealth.
    conf = "sys provision avr {\n    level nominal\n}\nsys provision gtm {\n}\n"
    mods = parse_sys_provision(conf)
    by_module = {m["module"]: m for m in mods}
    assert by_module["ltm"]["level"] == "nominal"
    assert set(by_module) == {"avr", "gtm", "ltm"}


CM_CONF = """
cm device /Common/bigip-a.example.com {
    self-device true
    management-ip 192.0.2.10
    hostname bigip-a.example.com
    version 17.1.0
    marketing-name "BIG-IP Virtual Edition"
}
cm device /Common/bigip-b.example.com {
    management-ip 192.0.2.11
    hostname bigip-b.example.com
    version 17.1.0
}
cm device-group /Common/failover-group {
    type sync-failover
    auto-sync enabled
    devices {
        /Common/bigip-a.example.com { }
        /Common/bigip-b.example.com { }
    }
}
cm traffic-group /Common/traffic-group-1 {
    ha-order { /Common/bigip-a.example.com /Common/bigip-b.example.com }
}
"""


def test_parse_cm_redundancy_topology():
    cm = parse_cm_redundancy(CM_CONF)

    assert len(cm["devices"]) == 2
    self_dev = [d for d in cm["devices"] if d["self_device"]]
    assert len(self_dev) == 1
    assert self_dev[0]["name"] == "bigip-a.example.com"
    assert self_dev[0]["management_ip"] == "192.0.2.10"

    assert len(cm["device_groups"]) == 1
    dg = cm["device_groups"][0]
    assert dg["type"] == "sync-failover"
    # Nested device sub-block must be brace-matched, not truncated at first '}'.
    assert dg["devices"] == ["bigip-a.example.com", "bigip-b.example.com"]

    assert len(cm["traffic_groups"]) == 1
    assert cm["traffic_groups"][0]["ha_order"] == [
        "bigip-a.example.com", "bigip-b.example.com"
    ]
