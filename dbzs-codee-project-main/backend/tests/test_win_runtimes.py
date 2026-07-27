from pathlib import Path

from app.runtime.win_runtimes import (
    clear_win_runtime_discovery_cache,
    discover_win_llama_runtime_dirs,
    discover_win_openssl_dirs,
    first_win_llama_runtime_dir,
)


def test_discovers_nested_llama_server(tmp_path: Path, monkeypatch) -> None:
    clear_win_runtime_discovery_cache()
    monkeypatch.setenv("DBZS_WIN_RUNTIMES_DIR", str(tmp_path))

    nested = tmp_path / "llama" / "cpu-x64"
    nested.mkdir(parents=True)
    (nested / "llama-server.exe").write_text("x", encoding="utf-8")
    (nested / "ggml.dll").write_text("x", encoding="utf-8")

    deep = tmp_path / "llama" / "custom" / "bundle"
    deep.mkdir(parents=True)
    (deep / "llama-server.exe").write_text("x", encoding="utf-8")
    (deep / "ggml.dll").write_text("x", encoding="utf-8")

    found = discover_win_llama_runtime_dirs(tmp_path)
    assert nested in found
    assert deep in found
    assert first_win_llama_runtime_dir(tmp_path) == nested


def test_prefers_cpu_x64_over_build_release(tmp_path: Path) -> None:
    clear_win_runtime_discovery_cache()
    cpu = tmp_path / "llama" / "cpu-x64"
    build = tmp_path / "llama" / "llama.cpp" / "build" / "bin" / "Release"
    cpu.mkdir(parents=True)
    build.mkdir(parents=True)
    (cpu / "llama-server.exe").write_text("x", encoding="utf-8")
    (cpu / "ggml.dll").write_text("x", encoding="utf-8")
    (build / "llama-server.exe").write_text("x", encoding="utf-8")
    (build / "ggml.dll").write_text("x", encoding="utf-8")

    found = discover_win_llama_runtime_dirs(tmp_path)
    assert found[0] == cpu


def test_prefer_gpu_ranks_vulkan_before_cpu(tmp_path: Path) -> None:
    clear_win_runtime_discovery_cache()
    cpu = tmp_path / "llama" / "cpu-x64"
    vulkan = tmp_path / "llama" / "vulkan-x64"
    cpu.mkdir(parents=True)
    vulkan.mkdir(parents=True)
    for bundle in (cpu, vulkan):
        (bundle / "llama-server.exe").write_text("x", encoding="utf-8")
        (bundle / "ggml.dll").write_text("x", encoding="utf-8")

    cpu_first = discover_win_llama_runtime_dirs(tmp_path, prefer_gpu=False)
    gpu_first = discover_win_llama_runtime_dirs(tmp_path, prefer_gpu=True)
    assert cpu_first[0] == cpu
    assert gpu_first[0] == vulkan
    assert first_win_llama_runtime_dir(tmp_path, prefer_gpu=True) == vulkan


def test_discovers_openssl_under_win_runtimes(tmp_path: Path) -> None:
    clear_win_runtime_discovery_cache()
    openssl = tmp_path / "Git" / "mingw64" / "bin"
    openssl.mkdir(parents=True)
    (openssl / "libssl-3-x64.dll").write_text("x", encoding="utf-8")
    (openssl / "libcrypto-3-x64.dll").write_text("x", encoding="utf-8")

    found = discover_win_openssl_dirs(tmp_path)
    assert openssl in found


def test_skips_git_metadata_dirs(tmp_path: Path) -> None:
    clear_win_runtime_discovery_cache()
    decoy = tmp_path / ".git" / "hooks"
    decoy.mkdir(parents=True)
    (decoy / "llama-server.exe").write_text("x", encoding="utf-8")
    real = tmp_path / "llama" / "cpu-x64"
    real.mkdir(parents=True)
    (real / "llama-server.exe").write_text("x", encoding="utf-8")
    (real / "ggml-base.dll").write_text("x", encoding="utf-8")

    found = discover_win_llama_runtime_dirs(tmp_path)
    assert real in found
    assert decoy not in found


def test_skips_python_site_packages_llama_bins(tmp_path: Path) -> None:
    clear_win_runtime_discovery_cache()
    pip_bin = tmp_path / "Python313" / "Lib" / "site-packages" / "llama_cpp_bin" / "bin"
    pip_bin.mkdir(parents=True)
    (pip_bin / "llama-server.exe").write_text("x", encoding="utf-8")
    (pip_bin / "ggml.dll").write_text("x", encoding="utf-8")
    real = tmp_path / "llama" / "cpu-x64"
    real.mkdir(parents=True)
    (real / "llama-server.exe").write_text("x", encoding="utf-8")
    (real / "ggml.dll").write_text("x", encoding="utf-8")

    found = discover_win_llama_runtime_dirs(tmp_path)
    assert real in found
    assert pip_bin not in found
