"""Pytest configuration and fixtures."""

import shutil
import sys
import uuid
from pathlib import Path

import pytest

# Add backend root to Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

_LOCAL_TMP_ROOT = Path(__file__).parent / ".pytest-local-tmp"


@pytest.fixture
def tmp_path(request: pytest.FixtureRequest) -> Path:
    """Use repo-local temp dirs when system temp is not writable."""
    _LOCAL_TMP_ROOT.mkdir(parents=True, exist_ok=True)
    safe_name = request.node.name.replace("[", "_").replace("]", "_").replace(":", "_")
    # Windows virus scanners and still-closing SQLite handles can retain a
    # previous directory briefly. A unique suffix keeps tests isolated even
    # when best-effort cleanup cannot remove the prior run immediately.
    path = _LOCAL_TMP_ROOT / f"{safe_name}-{uuid.uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    request.addfinalizer(lambda: shutil.rmtree(path, ignore_errors=True))
    return path
