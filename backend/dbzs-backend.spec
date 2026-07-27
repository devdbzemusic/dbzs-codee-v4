# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

root = Path(SPECPATH)
repo = root.parent
fastapi_datas, fastapi_bins, fastapi_hidden = collect_all("fastapi")
sse_datas, sse_bins, sse_hidden = collect_all("sse_starlette")

a = Analysis(
    [str(root / "run.py")],
    pathex=[str(root)],
    binaries=fastapi_bins + sse_bins,
    datas=fastapi_datas + sse_datas + [
        (str(repo / "packages" / "shared" / "runtime-slots.json"), "packages/shared"),
        (str(repo / "packages" / "shared" / "src" / "context-excludes.json"), "packages/shared"),
        (str(root / "app" / "rag" / "typescript_chunker.mjs"), "app/rag"),
    ],
    hiddenimports=fastapi_hidden + sse_hidden + collect_submodules("app") + [
        "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on",
        "anyio._backends._asyncio",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="dbzs-backend", console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=True, name="dbzs-backend")
