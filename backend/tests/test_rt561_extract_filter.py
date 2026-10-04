"""RT#561 — the F5OS stream extractor passes an explicit tarfile ``filter``.

Without one, Python 3.12/3.13 emit a DeprecationWarning for every extracted
member (7,887 per test run, burying real warnings), and Python 3.14 silently
switches the default to ``'data'``. Pinning ``filter="data"`` now makes the
behaviour the same on every supported interpreter.

Pinned here: no DeprecationWarning; a regular file still extracts byte-for-byte;
a FIFO on an allowlisted path is refused (counted skipped), not materialised.
"""

from __future__ import annotations

import io
import tarfile
import warnings

from qkview_analyzer.extractor import _stream_extract_f5os_to_dir

MANIFEST = "qkview/manifest.json"


def _archive(tmp_path):
    path = tmp_path / "mini.tar.gz"
    body = b'{"rt561": true}'
    with tarfile.open(path, "w:gz") as tar:
        info = tarfile.TarInfo(MANIFEST)
        info.size = len(body)
        tar.addfile(info, io.BytesIO(body))
        fifo = tarfile.TarInfo("qkview/subpackages/host-qkview/qkview/manifest.json")
        fifo.type = tarfile.FIFOTYPE
        tar.addfile(fifo)
    return path, body


def test_extract_emits_no_deprecation_warning_and_keeps_regular_files(tmp_path):
    archive, body = _archive(tmp_path)
    dest = tmp_path / "out"
    dest.mkdir()
    with warnings.catch_warnings():
        warnings.simplefilter("error", DeprecationWarning)
        _stream_extract_f5os_to_dir(archive, dest)
    assert (dest / MANIFEST).read_bytes() == body


def test_a_fifo_member_is_refused_not_created(tmp_path):
    archive, _ = _archive(tmp_path)
    dest = tmp_path / "out"
    dest.mkdir()
    _stream_extract_f5os_to_dir(archive, dest)
    fifo = dest / "qkview/subpackages/host-qkview/qkview/manifest.json"
    assert not fifo.exists()
