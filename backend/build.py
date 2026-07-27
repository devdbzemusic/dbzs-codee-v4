"""
PyInstaller build script for the DBZS backend.

Usage:
  uv run python build.py

Output: ../../backend-dist/  (relative to this file)
The electron-builder config picks up backend-dist/ as extraResources.
"""

import os
import stat
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
REPOSITORY_ROOT = ROOT.parent
DIST = Path(os.getenv("DBZS_BACKEND_DIST", str(REPOSITORY_ROOT / "backend-dist"))).resolve()
WORK = Path(os.getenv("DBZS_BACKEND_WORK", str(REPOSITORY_ROOT / ".cache" / "backend-build"))).resolve()


def _remove_build_tree(path: Path) -> None:
    """Entfernt auch schreibgeschützte PyInstaller-Artefakte unter Windows."""
    if not path.exists():
        return

    def make_writable_and_retry(function, target, _error) -> None:
        os.chmod(target, stat.S_IWRITE)
        function(target)

    shutil.rmtree(path, onexc=make_writable_and_retry)


def main() -> None:
    print(f"Building backend -> {DIST}")
    _remove_build_tree(DIST)
    _remove_build_tree(WORK)
    WORK.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller",
            "--distpath", str(DIST),
            "--workpath", str(WORK),
            "--noconfirm",
            str(ROOT / "dbzs-backend.spec"),
        ],
        check=True,
        cwd=ROOT,
    )
    print(f"Backend bundle ready at: {DIST / 'dbzs-backend'}")

if __name__ == "__main__":
    main()
