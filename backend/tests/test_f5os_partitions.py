"""`show partitions` parsing (RT#35).

A VELOS *controller* qkview carries no `show tenants` output anywhere — that
was measured across all 182 subpackage manifests of a syscon archive — so the
chassis-wide inventory a controller CAN answer is its partition list. This
parser feeds that table.

The fixtures reproduce the real column layout byte for byte but use synthetic
partition names: this repository has a public origin and an archive's
partition names are not ours to publish.
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from qkview_analyzer.extractor import _parse_f5os_partitions  # noqa: E402

# Exact spacing of the real output: three wrapped header lines, an unbroken
# rule, a dashes-only pseudo-row, then a partition whose HA pair prints one
# row per controller with the partition columns blank on the second.
REAL_SHAPE = (
    "# show partitions\n"
    "                                                                 RUNNING              \n"
    "          BLADE OS     SERVICE                  PARTITION        SERVICE      STATUS  \n"
    "NAME  ID  VERSION      VERSION      CONTROLLER  STATUS           VERSION      AGE     \n"
    "--------------------------------------------------------------------------------------\n"
    "none  -   -            -                                                              \n"
    "alpha 1   1.8.2-28311  1.8.2-28311  1           running-active   1.8.2-28311  83d     \n"
    "                                    2           running-standby  1.8.2-28311  83d     \n"
)


def test_parses_partition_with_an_ha_pair():
    parts = _parse_f5os_partitions(REAL_SHAPE)
    assert [p.name for p in parts] == ["none", "alpha"]
    alpha = parts[1]
    assert alpha.id == "1"
    assert alpha.blade_os_version == "1.8.2-28311"
    assert alpha.service_version == "1.8.2-28311"
    assert [c.controller for c in alpha.controllers] == ["1", "2"]
    assert [c.partition_status for c in alpha.controllers] == ["running-active", "running-standby"]
    assert alpha.controllers[0].running_service_version == "1.8.2-28311"
    assert alpha.controllers[1].status_age == "83d"


def test_continuation_row_attaches_to_the_partition_above_it():
    """The second controller must not become a partition of its own."""
    parts = _parse_f5os_partitions(REAL_SHAPE)
    assert len(parts) == 2
    assert len(parts[1].controllers) == 2


def test_unassigned_pseudo_row_yields_a_partition_with_no_controllers():
    """`none` is what the chassis reports for unassigned slots — it is real
    output and is kept, but it has no controller rows."""
    none_row = _parse_f5os_partitions(REAL_SHAPE)[0]
    assert none_row.name == "none"
    assert none_row.id == "-"
    assert none_row.controllers == []


def test_wide_values_do_not_bleed_into_the_next_column():
    wide = REAL_SHAPE.replace(
        "alpha 1   1.8.2-28311  1.8.2-28311  1           running-active   1.8.2-28311  83d     ",
        "bravo 12  10.11.12-99999  9.9.9-1  3           running-degraded  2.2.2-2      1234d   ",
    )
    p = _parse_f5os_partitions(wide)[1]
    # Columns are sliced at the header offsets, so an over-wide value is
    # truncated at the boundary rather than swallowing its neighbour.
    assert p.name == "bravo"
    assert p.id == "12"
    assert p.controllers and p.controllers[0].controller


def test_header_with_an_extra_column_is_refused_not_guessed():
    """A future F5OS adding a column must produce NO table, not a wrong one."""
    changed = REAL_SHAPE.replace(
        "NAME  ID  VERSION      VERSION      CONTROLLER  STATUS           VERSION      AGE     ",
        "NAME  ID  VERSION      VERSION      CONTROLLER  STATUS           VERSION      AGE  MODE",
    )
    assert _parse_f5os_partitions(changed) == []


def test_reordered_header_is_refused():
    changed = REAL_SHAPE.replace(
        "NAME  ID  VERSION      VERSION      CONTROLLER  STATUS           VERSION      AGE     ",
        "ID  NAME  VERSION      VERSION      CONTROLLER  STATUS           VERSION      AGE     ",
    )
    assert _parse_f5os_partitions(changed) == []


def test_missing_rule_line_is_refused():
    changed = REAL_SHAPE.replace(
        "--------------------------------------------------------------------------------------\n", ""
    )
    assert _parse_f5os_partitions(changed) == []


def test_empty_and_unrelated_output_yield_nothing():
    assert _parse_f5os_partitions("") == []
    assert _parse_f5os_partitions("% No entries found.\n") == []
    assert _parse_f5os_partitions("cluster nodes node controller-1\n state ready true\n") == []


def test_continuation_row_before_any_partition_is_dropped():
    """Defends the `out[-1]` access: no parent means no invented parent."""
    orphan = (
        "NAME  ID  VERSION      VERSION      CONTROLLER  STATUS           VERSION      AGE     \n"
        "--------------------------------------------------------------------------------------\n"
        "                                    2           running-standby  1.8.2-28311  83d     \n"
    )
    assert _parse_f5os_partitions(orphan) == []
