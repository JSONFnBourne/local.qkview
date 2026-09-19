"""Per-row analysis delete (RT#36): the `analyses` row, its `analysis_files`
rows and its `logs_<id>.db` go together, and a missing id is None (→ 404),
never a silent no-op.

Exercised through the helper functions rather than the ASGI app because the
dev requirements deliberately carry no `httpx` (TestClient needs it) and the
dependency budget in CLAUDE.md is a product decision, not an oversight.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import main  # noqa: E402


@pytest.fixture
def store(tmp_path, monkeypatch):
    db = tmp_path / "local_qkview.db"
    logs = tmp_path / "logs_db"
    logs.mkdir()
    monkeypatch.setattr(main, "DB_PATH", str(db))
    monkeypatch.setattr(main, "LOGS_DB_DIR", str(logs))
    main.init_db()
    conn = sqlite3.connect(db)
    for aid, name in ((1, "a.qkview"), (2, "b.tar"), (3, "c.tgz")):
        conn.execute("INSERT INTO analyses (id, filename, summary) VALUES (?, ?, ?)", (aid, name, "{}"))
        conn.execute(
            "INSERT INTO analysis_files (analysis_id, path, category, size, content) VALUES (?, ?, ?, ?, ?)",
            (aid, "config/bigip.conf", "config", 1, "x"),
        )
    conn.commit()
    conn.close()
    (logs / "logs_1.db").write_bytes(b"\0" * 1024)
    (logs / "logs_2.db").write_bytes(b"\0" * 2048)
    # analysis 3 deliberately has NO index file (pre-Session-4 row / already swept)
    return db, logs


def test_list_is_newest_first_with_index_sizes(store):
    rows = main._list_analyses()
    assert [r["id"] for r in rows] == [3, 2, 1]
    by_id = {r["id"]: r for r in rows}
    assert by_id[1]["logs_db_bytes"] == 1024
    assert by_id[2]["logs_db_bytes"] == 2048
    assert by_id[3]["logs_db_bytes"] == 0
    assert by_id[2]["filename"] == "b.tar"


def test_delete_removes_row_files_and_index(store):
    db, logs = store
    result = main._delete_analysis(2)
    assert result == {
        "id": 2,
        "analysis_files_deleted": 1,
        "logs_db_removed": True,
        "logs_db_bytes_reclaimed": 2048,
    }
    assert not (logs / "logs_2.db").exists()
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM analyses WHERE id = 2").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM analysis_files WHERE analysis_id = 2").fetchone()[0] == 0
    # the neighbours are untouched
    assert conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM analysis_files").fetchone()[0] == 2
    conn.close()
    assert (logs / "logs_1.db").exists()


def test_delete_without_index_file_still_succeeds(store):
    result = main._delete_analysis(3)
    assert result["logs_db_removed"] is False
    assert result["logs_db_bytes_reclaimed"] == 0
    assert [r["id"] for r in main._list_analyses()] == [2, 1]


def test_delete_unknown_id_is_none_and_touches_nothing(store):
    db, logs = store
    assert main._delete_analysis(99) is None
    assert len(main._list_analyses()) == 3
    assert (logs / "logs_1.db").exists() and (logs / "logs_2.db").exists()


def test_endpoint_maps_none_to_404(store):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        main.delete_analysis(99)
    assert ei.value.status_code == 404
    assert main.delete_analysis(1)["id"] == 1
    assert main.list_analyses() == {"analyses": main._list_analyses()}


def test_db_path_env_override_is_honoured(tmp_path, monkeypatch):
    """A profiling run must be able to keep its rows out of the operator's DB."""
    import importlib
    monkeypatch.setenv("QKVIEW_DB_PATH", str(tmp_path / "x.db"))
    monkeypatch.setenv("QKVIEW_LOGS_DB_DIR", str(tmp_path / "l"))
    reloaded = importlib.reload(main)
    try:
        assert reloaded.DB_PATH == str(tmp_path / "x.db")
        assert reloaded.LOGS_DB_DIR == str(tmp_path / "l")
    finally:
        monkeypatch.delenv("QKVIEW_DB_PATH")
        monkeypatch.delenv("QKVIEW_LOGS_DB_DIR")
        importlib.reload(main)
