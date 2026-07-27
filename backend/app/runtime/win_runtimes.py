"""Windows runtime discovery under D:\\win_runtimes (recursive, cached)."""

from __future__ import annotations

import os
from pathlib import Path

from app.core.config import get_win_runtimes_dir

_SKIP_DIR_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".cache",
    "__pycache__",
    "node_modules",
    "CMakeFiles",
    "obj",
    "Debug",
}

_SKIP_PATH_FRAGMENTS = (
    "site-packages",
    "llama_cpp_bin",
    "/python3",
    "/python2",
    "/python31",
    "/python32",
    "\\python3",
    "\\python2",
    "\\python31",
    "\\python32",
)

# Raw discovery cache (unsorted unique dirs). Preference sorting happens per call.
_llama_dirs_cache: dict[str, list[Path]] = {}
_openssl_dirs_cache: dict[str, list[Path]] = {}


def clear_win_runtime_discovery_cache() -> None:
    _llama_dirs_cache.clear()
    _openssl_dirs_cache.clear()


def _path_key(path: Path) -> str:
    try:
        return str(path.resolve()).lower()
    except OSError:
        return str(path).lower()


def _normalized_posix(path: Path) -> str:
    return str(path).replace("\\", "/").lower()


def _is_plausible_llama_runtime_dir(path: Path) -> bool:
    """Accept only llama.cpp-style bundles, not pip/python embeds."""
    if not (path / "llama-server.exe").is_file():
        return False
    text = _normalized_posix(path)
    if any(fragment in text for fragment in _SKIP_PATH_FRAGMENTS):
        return False
    # Full Windows bundles ship ggml*.dll next to llama-server.exe.
    return any(path.glob("ggml*.dll"))


def _llama_preference_score(path: Path, *, prefer_gpu: bool) -> tuple[int, int, int, int, str]:
    """Lower tuple sorts first.

    CPU-safe launches prefer cpu-x64; GPU/hybrid launches prefer vulkan-x64.
    """
    text = _normalized_posix(path)
    cpu = 0 if "cpu-x64" in text else 1
    vulkan = 0 if "vulkan" in text else 1
    buildish = 1 if "/build/" in text or text.endswith("/release") or "/release/" in text else 0
    depth = len(path.parts)
    if prefer_gpu:
        return (vulkan, cpu, buildish, depth, text)
    return (cpu, vulkan, buildish, depth, text)


def _openssl_preference_score(path: Path) -> tuple[int, int, str]:
    text = _normalized_posix(path)
    git_mingw = 0 if "git/mingw64/bin" in text else 1
    msys = 0 if "msys64/mingw64/bin" in text else 1
    return (git_mingw, msys, text)


def _walk_dirs_with_file(root: Path, filename: str, *, name_glob: str | None = None) -> list[Path]:
    if not root.is_dir():
        return []

    hits: list[Path] = []
    seen: set[str] = set()
    for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        dirnames[:] = [
            name
            for name in dirnames
            if name not in _SKIP_DIR_NAMES
            and not name.startswith(".")
            and name.lower() not in {"site-packages", "llama_cpp_bin"}
            and not name.lower().startswith("python3")
        ]
        matched = False
        if filename in filenames:
            matched = True
        elif name_glob is not None:
            matched = any(Path(name).match(name_glob) for name in filenames)
        if matched:
            path = Path(dirpath)
            key = _path_key(path)
            if key not in seen:
                seen.add(key)
                hits.append(path)
    return hits


def _cached_raw_llama_dirs(base: Path) -> list[Path]:
    cache_key = _path_key(base)
    cached = _llama_dirs_cache.get(cache_key)
    if cached is not None:
        return list(cached)

    found = _walk_dirs_with_file(base, "llama-server.exe")
    ordered: list[Path] = []
    seen: set[str] = set()
    for candidate in found:
        if not _is_plausible_llama_runtime_dir(candidate):
            continue
        key = _path_key(candidate)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(candidate)

    _llama_dirs_cache[cache_key] = ordered
    return list(ordered)


def discover_win_llama_runtime_dirs(
    root: Path | None = None,
    *,
    prefer_gpu: bool = False,
) -> list[Path]:
    """Return directories under win_runtimes that contain llama-server.exe.

    When ``prefer_gpu`` is True (gpu_layers > 0), Vulkan bundles rank before
    cpu-x64 so hybrid/GPU launches use a real GPU backend.
    """
    base = root if root is not None else get_win_runtimes_dir()
    found = _cached_raw_llama_dirs(base)

    if prefer_gpu:
        preferred = [
            base / "llama" / "vulkan-x64",
            base / "llama" / "cpu-x64",
            base / "llama",
        ]
    else:
        preferred = [
            base / "llama" / "cpu-x64",
            base / "llama" / "vulkan-x64",
            base / "llama",
        ]

    ordered: list[Path] = []
    seen: set[str] = set()
    for candidate in [
        *preferred,
        *sorted(found, key=lambda path: _llama_preference_score(path, prefer_gpu=prefer_gpu)),
    ]:
        if not _is_plausible_llama_runtime_dir(candidate):
            continue
        key = _path_key(candidate)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(candidate)

    return ordered


def discover_win_openssl_dirs(root: Path | None = None) -> list[Path]:
    """Return directories under win_runtimes that contain OpenSSL DLLs."""
    base = root if root is not None else get_win_runtimes_dir()
    cache_key = _path_key(base)
    cached = _openssl_dirs_cache.get(cache_key)
    if cached is not None:
        return list(cached)

    preferred = [
        base / "Git" / "mingw64" / "bin",
        base / "msys64" / "mingw64" / "bin",
    ]
    found = _walk_dirs_with_file(base, "libssl-3-x64.dll", name_glob="libssl*.dll")
    ordered: list[Path] = []
    seen: set[str] = set()
    for candidate in [*preferred, *sorted(found, key=_openssl_preference_score)]:
        has_ssl = any(candidate.glob("libssl*.dll"))
        has_crypto = any(candidate.glob("libcrypto*.dll"))
        if not (has_ssl and has_crypto):
            continue
        key = _path_key(candidate)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(candidate)

    _openssl_dirs_cache[cache_key] = ordered
    return list(ordered)


def first_win_llama_runtime_dir(
    root: Path | None = None,
    *,
    prefer_gpu: bool = False,
) -> Path | None:
    dirs = discover_win_llama_runtime_dirs(root, prefer_gpu=prefer_gpu)
    return dirs[0] if dirs else None
