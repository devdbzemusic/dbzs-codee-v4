from pathlib import Path

from app.models.schemas import IndexedModel, ModelRuntimeHints
from app.runtime.launch import (
    build_llama_server_env,
    build_runtime_command,
    classify_exit_failure,
    describe_process_exit_code,
    ensure_openssl_dlls_beside_runtime,
    is_oom_stderr,
    resolve_openssl_dir,
    resolve_runtime_dir,
    validate_runtime_bundle,
    wait_for_runtime_endpoint,
)
from app.runtime.schemas import LlamaRuntimeCapabilities
from app.runtime.win_runtimes import clear_win_runtime_discovery_cache


def _make_model() -> IndexedModel:
    return IndexedModel(
        id="coder",
        name="Coder Q4",
        path="D:/Models/coder.gguf",
        format="gguf",
        artifact_type="model",
        size_bytes=1000,
        size_gb=0.001,
        quantization="Q4_K_M",
        backend="llama.cpp",
        runtime_launcher="llama-server",
        capabilities=["chat", "code"],
        modality=["text"],
        role=None,
        recommended_use="coding_candidate",
        compatibility="llama_server_ready",
        runtime=ModelRuntimeHints(),
    )


class FakeProcess:
    pid = 1

    def __init__(self, exit_code: int | None = None) -> None:
        self._exit_code = exit_code

    def poll(self) -> int | None:
        return self._exit_code

    def terminate(self) -> None:
        return None


def test_wait_for_runtime_endpoint_eventually_succeeds() -> None:
    calls = {"count": 0}

    def checker(_url: str) -> bool:
        calls["count"] += 1
        return calls["count"] >= 3

    ready, message = wait_for_runtime_endpoint(
        "http://127.0.0.1:8091",
        checker,
        FakeProcess(),
        timeout_seconds=1,
        interval_seconds=0.01,
    )

    assert ready is True
    assert message == ""


def test_wait_for_runtime_endpoint_includes_stderr_tail_on_timeout() -> None:
    ready, message = wait_for_runtime_endpoint(
        "http://127.0.0.1:8091",
        lambda _url: False,
        FakeProcess(),
        timeout_seconds=0.03,
        interval_seconds=0.01,
        stderr_tail=lambda: "load_tensors: failed",
    )

    assert ready is False
    assert "not ready within" in message
    assert "load_tensors: failed" in message


def test_describe_process_exit_code_mentions_openssl(tmp_path: Path) -> None:
    message = describe_process_exit_code(3221225781)
    assert "libssl/libcrypto" in message


def test_describe_process_exit_code_mentions_unsupported_model_architecture() -> None:
    message = describe_process_exit_code(
        1,
        "llama_model_load: error loading model: error loading model architecture: unknown model architecture: 'gemma4'",
    )

    assert "unsupported by the installed llama-server build" in message
    assert "gemma4" in message


def test_validate_runtime_bundle_requires_openssl(tmp_path: Path, monkeypatch) -> None:
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir(exist_ok=True)
    (runtime_dir / "llama-server.exe").write_text("runtime", encoding="utf-8")
    (runtime_dir / "ggml.dll").write_text("ggml", encoding="utf-8")

    monkeypatch.setattr(
        "app.runtime.launch.resolve_openssl_dir",
        lambda _models_dir, _runtime_dir: None,
    )

    error = validate_runtime_bundle(runtime_dir, tmp_path / "Models")

    assert error is not None
    assert "libssl/libcrypto" in error


def test_build_runtime_command_never_emits_cache_flags_without_capabilities(tmp_path: Path) -> None:
    """Acceptance test 18: cache/batch flags are only ever emitted when capabilities confirm support."""
    model = _make_model()
    override = {"batch_size": 512, "micro_batch_size": 128, "cache_type_k": "q8_0", "cache_type_v": "q8_0"}

    command = build_runtime_command(
        model,
        tmp_path,
        8091,
        ollama_executable=tmp_path / "ollama.exe",
        config_override=override,
        capabilities=None,
    )

    assert "--batch-size" not in command
    assert "--ubatch-size" not in command
    assert "--cache-type-k" not in command
    assert "--cache-type-v" not in command


def test_build_runtime_command_emits_only_supported_flags(tmp_path: Path) -> None:
    model = _make_model()
    override = {"batch_size": 512, "micro_batch_size": 128, "cache_type_k": "q8_0", "cache_type_v": "q8_0"}
    capabilities = LlamaRuntimeCapabilities(
        supports_batch_size=True,
        supports_ubatch_size=False,
        supports_cache_type_k=True,
        supports_cache_type_v=False,
    )

    command = build_runtime_command(
        model,
        tmp_path,
        8091,
        ollama_executable=tmp_path / "ollama.exe",
        config_override=override,
        capabilities=capabilities,
    )

    assert "--batch-size" in command
    assert command[command.index("--batch-size") + 1] == "512"
    assert "--ubatch-size" not in command
    assert "--cache-type-k" in command
    assert command[command.index("--cache-type-k") + 1] == "q8_0"
    assert "--cache-type-v" not in command


def test_build_runtime_command_gates_cache_reuse_on_capability(tmp_path: Path) -> None:
    model = _make_model()
    override = {"cache_reuse": 256}

    without_capability = build_runtime_command(
        model, tmp_path, 8091, ollama_executable=tmp_path / "ollama.exe",
        config_override=override, capabilities=LlamaRuntimeCapabilities(supports_cache_reuse=False),
    )
    with_capability = build_runtime_command(
        model, tmp_path, 8091, ollama_executable=tmp_path / "ollama.exe",
        config_override=override, capabilities=LlamaRuntimeCapabilities(supports_cache_reuse=True),
    )

    assert "--cache-reuse" not in without_capability
    assert "--cache-reuse" in with_capability
    assert with_capability[with_capability.index("--cache-reuse") + 1] == "256"


def test_build_runtime_command_includes_mmproj_when_override_present(tmp_path: Path) -> None:
    model = _make_model()
    mmproj = tmp_path / "mmproj.gguf"
    mmproj.write_text("projector", encoding="utf-8")

    command = build_runtime_command(
        model,
        tmp_path,
        8091,
        ollama_executable=tmp_path / "ollama.exe",
        config_override={"mmproj_path": str(mmproj)},
        capabilities=None,
    )

    assert "--mmproj" in command
    assert command[command.index("--mmproj") + 1] == str(mmproj)


def test_is_oom_stderr_detects_cuda_oom_patterns() -> None:
    assert is_oom_stderr("ggml_cuda_error: out of memory") is True
    assert is_oom_stderr("CUDA error: out of memory") is True
    assert is_oom_stderr("cudaMalloc failed: out of memory") is True
    assert is_oom_stderr(None) is False
    assert is_oom_stderr("llama_model_load: unknown model architecture") is False


def test_classify_exit_failure_distinguishes_failure_kinds() -> None:
    assert classify_exit_failure(3221225781, None) == "dll_missing"
    assert classify_exit_failure(1, "unknown model architecture: 'gemma4'") == "arch_mismatch"
    assert classify_exit_failure(1, "ggml_cuda_error: out of memory") == "oom"
    assert classify_exit_failure(1, "some other failure") == "unknown"


def test_describe_process_exit_code_mentions_oom(tmp_path: Path) -> None:
    message = describe_process_exit_code(1, "CUDA error: out of memory")
    assert "Speicherfehler" in message


def test_build_llama_server_env_prepends_openssl_dir(tmp_path: Path, monkeypatch) -> None:
    runtime_dir = tmp_path / "runtime"
    openssl_dir = tmp_path / "openssl"
    runtime_dir.mkdir(exist_ok=True)
    openssl_dir.mkdir(exist_ok=True)
    (runtime_dir / "llama-server.exe").write_text("runtime", encoding="utf-8")
    (runtime_dir / "ggml.dll").write_text("ggml", encoding="utf-8")
    (openssl_dir / "libssl-3-x64.dll").write_text("ssl", encoding="utf-8")
    (openssl_dir / "libcrypto-3-x64.dll").write_text("crypto", encoding="utf-8")

    monkeypatch.setenv("DBZS_OPENSSL_BIN_DIR", str(openssl_dir))
    monkeypatch.setenv("PATH", "C:\\existing")

    env = build_llama_server_env(runtime_dir, tmp_path / "Models")
    path_value = env.get("PATH") or env.get("Path") or ""

    assert str(runtime_dir) in path_value
    assert path_value.endswith("C:\\existing")
    assert sum(1 for key in env if key.upper() == "PATH") == 1
    # After staging, OpenSSL resolves to the runtime directory itself.
    assert resolve_openssl_dir(tmp_path / "Models", runtime_dir) == runtime_dir
    assert (runtime_dir / "libssl-3-x64.dll").exists()
    assert (runtime_dir / "libcrypto-3-x64.dll").exists()


def test_build_llama_server_env_merges_windows_path_key(tmp_path: Path, monkeypatch) -> None:
    """Regression: Windows often exposes Path, not PATH."""
    runtime_dir = tmp_path / "runtime"
    openssl_dir = tmp_path / "openssl"
    runtime_dir.mkdir()
    openssl_dir.mkdir()
    (runtime_dir / "llama-server.exe").write_text("x", encoding="utf-8")
    (runtime_dir / "ggml.dll").write_text("x", encoding="utf-8")
    (openssl_dir / "libssl-3-x64.dll").write_text("x", encoding="utf-8")
    (openssl_dir / "libcrypto-3-x64.dll").write_text("x", encoding="utf-8")

    monkeypatch.setenv("DBZS_OPENSSL_BIN_DIR", str(openssl_dir))
    monkeypatch.delenv("PATH", raising=False)
    monkeypatch.setenv("Path", "C:\\windows-path")

    env = build_llama_server_env(runtime_dir, tmp_path / "Models")
    path_keys = [key for key in env if key.upper() == "PATH"]
    assert len(path_keys) == 1
    assert str(runtime_dir) in env[path_keys[0]]
    assert "C:\\windows-path" in env[path_keys[0]]
    assert (runtime_dir / "libssl-3-x64.dll").exists()


def test_ensure_openssl_dlls_copies_into_runtime(tmp_path: Path, monkeypatch) -> None:
    runtime_dir = tmp_path / "runtime"
    openssl_dir = tmp_path / "openssl"
    runtime_dir.mkdir()
    openssl_dir.mkdir()
    (openssl_dir / "libssl-3-x64.dll").write_text("ssl", encoding="utf-8")
    (openssl_dir / "libcrypto-3-x64.dll").write_text("crypto", encoding="utf-8")
    monkeypatch.setenv("DBZS_OPENSSL_BIN_DIR", str(openssl_dir))

    staged = ensure_openssl_dlls_beside_runtime(runtime_dir, tmp_path / "Models")
    assert staged == runtime_dir
    assert (runtime_dir / "libssl-3-x64.dll").read_text(encoding="utf-8") == "ssl"


def test_resolve_runtime_dir_uses_recursive_win_runtimes(tmp_path: Path, monkeypatch) -> None:
    clear_win_runtime_discovery_cache()
    win_root = tmp_path / "win_runtimes"
    models_dir = tmp_path / "Models"
    models_dir.mkdir()
    runtime = win_root / "llama" / "nested" / "bundle"
    runtime.mkdir(parents=True)
    (runtime / "llama-server.exe").write_text("x", encoding="utf-8")
    (runtime / "ggml-base.dll").write_text("x", encoding="utf-8")
    (runtime / "libssl-3-x64.dll").write_text("x", encoding="utf-8")
    (runtime / "libcrypto-3-x64.dll").write_text("x", encoding="utf-8")

    monkeypatch.setenv("DBZS_WIN_RUNTIMES_DIR", str(win_root))

    resolved = resolve_runtime_dir(_make_model(), models_dir, tmp_path / "Ollama")
    assert resolved == runtime


def test_resolve_runtime_dir_prefers_vulkan_when_gpu_layers(tmp_path: Path, monkeypatch) -> None:
    clear_win_runtime_discovery_cache()
    win_root = tmp_path / "win_runtimes"
    models_dir = tmp_path / "Models"
    models_dir.mkdir()
    cpu = win_root / "llama" / "cpu-x64"
    vulkan = win_root / "llama" / "vulkan-x64"
    for bundle in (cpu, vulkan):
        bundle.mkdir(parents=True)
        (bundle / "llama-server.exe").write_text("x", encoding="utf-8")
        (bundle / "ggml-base.dll").write_text("x", encoding="utf-8")
        (bundle / "libssl-3-x64.dll").write_text("x", encoding="utf-8")
        (bundle / "libcrypto-3-x64.dll").write_text("x", encoding="utf-8")

    monkeypatch.setenv("DBZS_WIN_RUNTIMES_DIR", str(win_root))

    cpu_path = resolve_runtime_dir(_make_model(), models_dir, tmp_path / "Ollama", prefer_gpu=False)
    gpu_path = resolve_runtime_dir(_make_model(), models_dir, tmp_path / "Ollama", prefer_gpu=True)
    assert cpu_path == cpu
    assert gpu_path == vulkan

