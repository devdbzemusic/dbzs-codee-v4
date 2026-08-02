from __future__ import annotations

import json
import os
import shlex
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

from app.models.schemas import IndexedModel
from app.models.launcher import is_llama_server_launcher, is_ollama_launcher
from app.runtime.schemas import LlamaRuntimeCapabilities


@dataclass
class RuntimeLaunchPlan:
    command: list[str]
    env: dict[str, str] | None
    runtime_dir: Path
    port: int
    endpoint: str
    command_preview: str
    warnings: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)


class ManagedProcess(Protocol):
    pid: int

    def poll(self) -> int | None: ...

    def terminate(self) -> None: ...


def _read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def format_command_preview(command: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in command)


def _dir_has_openssl_dlls(directory: Path) -> bool:
    if not directory.is_dir():
        return False
    return any(directory.glob("libssl*.dll")) and any(directory.glob("libcrypto*.dll"))


def _windows_env_with_path_prefix(path_prefix: list[str]) -> dict[str, str]:
    """Build a child-process env with a single canonical PATH entry.

    On Windows, os.environ often exposes the key as ``Path``. Setting a second
    ``PATH`` key leaves CreateProcess reading the stale ``Path`` value, so
    OpenSSL DLLs on our prefix are never searched.
    """
    env = {str(key): str(value) for key, value in os.environ.items()}
    existing = ""
    path_key = "PATH"
    for key in list(env):
        if key.upper() == "PATH":
            path_key = key
            if not existing:
                existing = env.pop(key)
            else:
                env.pop(key, None)
    parts = [part for part in path_prefix if part]
    if existing:
        parts.append(existing)
    env[path_key] = os.pathsep.join(parts)
    return env


def ensure_openssl_dlls_beside_runtime(runtime_dir: Path, models_dir: Path) -> Path | None:
    """Copy libssl/libcrypto next to llama-server.exe when missing.

    Windows loads dependent DLLs from the executable directory first. Staging
    them there is more reliable than PATH alone (and survives Path/PATH quirks).
    """
    if _dir_has_openssl_dlls(runtime_dir):
        return runtime_dir

    openssl_dir = resolve_openssl_dir(models_dir, runtime_dir)
    if openssl_dir is None:
        return None
    if openssl_dir.resolve() == runtime_dir.resolve():
        return runtime_dir

    import shutil

    runtime_dir.mkdir(parents=True, exist_ok=True)
    copied = False
    for pattern in ("libssl*.dll", "libcrypto*.dll"):
        for source in openssl_dir.glob(pattern):
            target = runtime_dir / source.name
            if target.exists():
                continue
            try:
                shutil.copy2(source, target)
                copied = True
            except OSError:
                return None
    if _dir_has_openssl_dlls(runtime_dir):
        return runtime_dir
    return openssl_dir if copied or _dir_has_openssl_dlls(openssl_dir) else None


def _collect_openssl_dir_candidates(models_dir: Path, runtime_dir: Path | None = None) -> list[Path]:
    candidates: list[Path] = []
    if runtime_dir is not None:
        candidates.append(runtime_dir)

    env_dir = os.getenv("DBZS_OPENSSL_BIN_DIR", "").strip()
    if env_dir:
        candidates.append(Path(env_dir))

    from app.runtime.win_runtimes import discover_win_openssl_dirs

    candidates.extend(discover_win_openssl_dirs())
    candidates.extend(
        [
            Path("C:/Program Files/Git/mingw64/bin"),
            Path("C:/Program Files/Git/usr/bin"),
            models_dir / "openssl",
        ]
    )

    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def resolve_openssl_dir(models_dir: Path, runtime_dir: Path) -> Path | None:
    for candidate in _collect_openssl_dir_candidates(models_dir, runtime_dir):
        if _dir_has_openssl_dlls(candidate):
            return candidate
    return None


def validate_runtime_bundle(runtime_dir: Path, models_dir: Path) -> str | None:
    if not (runtime_dir / "llama-server.exe").exists():
        return f"llama-server.exe missing in {runtime_dir}"
    if not any(runtime_dir.glob("ggml*.dll")):
        return (
            "llama-server runtime incomplete: ggml*.dll fehlen. "
            "Vollstaendiges llama.cpp-Bundle verwenden unter D:/win_runtimes "
            "(oder DBZS_WIN_RUNTIMES_DIR / DBZS_LLAMA_RUNTIME_DIR)."
        )
    if _dir_has_openssl_dlls(runtime_dir) or resolve_openssl_dir(models_dir, runtime_dir):
        return None
    return (
        "llama-server runtime incomplete: libssl/libcrypto fehlen. "
        "OpenSSL-DLLs (libssl-3-x64.dll, libcrypto-3-x64.dll) ins Runtime-Verzeichnis legen "
        "oder DBZS_OPENSSL_BIN_DIR setzen; typisch unter D:/win_runtimes/Git/mingw64/bin."
    )


def validate_model_for_launch(
    model: IndexedModel,
    *,
    runtime_dir: Path | None,
    ollama_executable: Path,
    models_dir: Path | None = None,
    config_override: dict[str, object] | None = None,
) -> str | None:
    if is_ollama_launcher(model.runtime_launcher):
        if model.format != "ollama":
            return "Ollama runtime requires an Ollama manifest model."
        if not ollama_executable.exists():
            return f"Ollama executable does not exist: {ollama_executable}"
        return None

    if not is_llama_server_launcher(model.runtime_launcher):
        return "Model is not configured for llama-server."
    if model.artifact_type != "model":
        return "Only full model artifacts can be started directly."
    if model.format != "gguf":
        return "llama-server requires a GGUF model."
    if not Path(model.path).exists():
        return f"Model file does not exist: {model.path}"
    override = config_override or {}
    mmproj_path = override.get("mmproj_path")
    if isinstance(mmproj_path, str) and mmproj_path.strip() and not Path(mmproj_path.strip()).exists():
        return f"MMProj file does not exist: {mmproj_path}"
    if runtime_dir is None:
        return "Runtime directory not found."
    if models_dir is None:
        if not (runtime_dir / "llama-server.exe").exists():
            return f"llama-server.exe missing in {runtime_dir}"
        return None
    return validate_runtime_bundle(runtime_dir, models_dir)


def _runtime_dir_has_llama_server(runtime_dir: Path, models_dir: Path) -> bool:
    return validate_runtime_bundle(runtime_dir, models_dir) is None


def _effective_gpu_layers(
    model: IndexedModel,
    config_override: dict[str, object] | None = None,
) -> int:
    override = config_override or {}
    override_gpu = override.get("n_gpu_layers", override.get("gpu_layers"))
    if isinstance(override_gpu, int):
        return override_gpu
    if model.runtime.gpu_layers is not None:
        return int(model.runtime.gpu_layers)
    return 0


def _collect_runtime_dir_candidates(
    models_dir: Path,
    *,
    prefer_gpu: bool = False,
) -> list[Path]:
    candidates: list[Path] = []

    env_runtime = os.getenv("DBZS_LLAMA_RUNTIME_DIR", "").strip()
    if env_runtime:
        candidates.append(Path(env_runtime))

    runtime_json = models_dir / "models.runtime.json"
    if runtime_json.exists():
        runtime_data = _read_json(runtime_json)
        llama_server_exe = runtime_data.get("llama_server_exe")
        if isinstance(llama_server_exe, str) and llama_server_exe.strip():
            candidates.append(Path(llama_server_exe.strip()).parent)

    catalog_path = models_dir / "models.catalog.json"
    if catalog_path.exists():
        catalog = _read_json(catalog_path)
        runtime_dir = catalog.get("runtime_dir")
        if isinstance(runtime_dir, str) and runtime_dir.strip():
            candidates.append(Path(runtime_dir.strip()))

    candidates.append(models_dir / "llama.cpp-win-runtime")

    from app.runtime.win_runtimes import discover_win_llama_runtime_dirs

    candidates.extend(discover_win_llama_runtime_dirs(prefer_gpu=prefer_gpu))

    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def resolve_runtime_dir(
    model: IndexedModel,
    models_dir: Path,
    ollama_dir: Path,
    *,
    prefer_gpu: bool = False,
) -> Path | None:
    if is_ollama_launcher(model.runtime_launcher):
        return ollama_dir

    for candidate in _collect_runtime_dir_candidates(models_dir, prefer_gpu=prefer_gpu):
        if _runtime_dir_has_llama_server(candidate, models_dir):
            return candidate

    return None


def resolve_preferred_port(
    model: IndexedModel,
    models_dir: Path,
    *,
    config_override: dict[str, object] | None = None,
) -> int | None:
    override = config_override or {}
    override_port = override.get("port")
    if isinstance(override_port, int):
        return override_port

    if is_ollama_launcher(model.runtime_launcher):
        return 11434

    if model.runtime.preferred_port:
        return model.runtime.preferred_port

    runtime_path = models_dir / "models.runtime.json"
    if runtime_path.exists():
        runtime_data = _read_json(runtime_path)
        models = runtime_data.get("models", {})
        if isinstance(models, dict):
            model_runtime = models.get(model.id, {})
            if isinstance(model_runtime, dict):
                port = model_runtime.get("server", {}).get("preferred_port")
                if isinstance(port, int):
                    return port
        artifacts = runtime_data.get("artifacts", [])
        if isinstance(artifacts, list):
            for entry in artifacts:
                if isinstance(entry, dict) and entry.get("id") == model.id:
                    port = entry.get("server", {}).get("preferred_port")
                    if isinstance(port, int):
                        return port

    return None


def build_runtime_command(
    model: IndexedModel,
    runtime_dir: Path,
    port: int,
    *,
    ollama_executable: Path,
    config_override: dict[str, object] | None = None,
    capabilities: LlamaRuntimeCapabilities | None = None,
) -> list[str]:
    if is_ollama_launcher(model.runtime_launcher):
        return [str(ollama_executable), "serve"]

    server_exe = runtime_dir / "llama-server.exe"
    ctx = model.runtime.ctx or 4096
    gpu_layers = model.runtime.gpu_layers if model.runtime.gpu_layers is not None else 0

    override = config_override or {}
    override_ctx = override.get("context_size", override.get("ctx"))
    if isinstance(override_ctx, int):
        ctx = override_ctx
    override_gpu = override.get("n_gpu_layers", override.get("gpu_layers"))
    if isinstance(override_gpu, int):
        gpu_layers = override_gpu
    threads = override.get("n_threads", override.get("threads"))
    override_parallel = override.get("parallel", override.get("n_parallel"))
    parallel = 1
    if isinstance(override_parallel, int):
        parallel = override_parallel

    command = [
        str(server_exe),
        "-m",
        model.path,
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--ctx-size",
        str(ctx),
        "--gpu-layers",
        str(gpu_layers),
        "--parallel",
        str(parallel),
    ]
    if isinstance(threads, int):
        command.extend(["--threads", str(threads)])
    mmproj_path = override.get("mmproj_path")
    if isinstance(mmproj_path, str) and mmproj_path.strip():
        command.extend(["--mmproj", mmproj_path.strip()])

    # Only emit flags the discovered llama-server binary actually supports —
    # never blindly set a flag when capabilities are unknown (capabilities=None).
    if capabilities is not None:
        batch_size = override.get("batch_size")
        if capabilities.supports_batch_size and isinstance(batch_size, int):
            command.extend(["--batch-size", str(batch_size)])

        micro_batch_size = override.get("micro_batch_size", override.get("ubatch_size"))
        if capabilities.supports_ubatch_size and isinstance(micro_batch_size, int):
            command.extend(["--ubatch-size", str(micro_batch_size)])

        cache_type_k = override.get("cache_type_k")
        if capabilities.supports_cache_type_k and isinstance(cache_type_k, str):
            command.extend(["--cache-type-k", cache_type_k])

        cache_type_v = override.get("cache_type_v")
        if capabilities.supports_cache_type_v and isinstance(cache_type_v, str):
            command.extend(["--cache-type-v", cache_type_v])

        # Prompt/KV cache reuse (Phase 5) — safe to enable unconditionally once
        # supported: it only ever reuses a stable prompt prefix within THIS
        # process's own KV cache, and the Residency Cache (Phase 2) already
        # guarantees a fresh process (no cross-model/cross-config reuse) on
        # any launch-fingerprint mismatch.
        cache_reuse = override.get("cache_reuse")
        if capabilities.supports_cache_reuse and isinstance(cache_reuse, int):
            command.extend(["--cache-reuse", str(cache_reuse)])

    return command


def build_llama_server_env(runtime_dir: Path, models_dir: Path) -> dict[str, str]:
    ensure_openssl_dlls_beside_runtime(runtime_dir, models_dir)
    path_prefix = [str(runtime_dir)]
    openssl_dir = resolve_openssl_dir(models_dir, runtime_dir)
    if openssl_dir is not None and str(openssl_dir) not in path_prefix:
        path_prefix.append(str(openssl_dir))
    return _windows_env_with_path_prefix(path_prefix)


def build_runtime_env(
    model: IndexedModel,
    ollama_models_dir: Path,
    *,
    runtime_dir: Path | None = None,
    models_dir: Path | None = None,
) -> dict[str, str] | None:
    if is_ollama_launcher(model.runtime_launcher):
        return {
            **os.environ,
            "OLLAMA_HOST": "127.0.0.1:11434",
            "OLLAMA_MODELS": str(ollama_models_dir),
        }

    if runtime_dir is not None and models_dir is not None:
        return build_llama_server_env(runtime_dir, models_dir)

    return os.environ.copy()


def config_override_from_preset(preset: dict[str, object]) -> dict[str, object]:
    override: dict[str, object] = {}
    if isinstance(preset.get("ctx"), int):
        override["context_size"] = preset["ctx"]
    if isinstance(preset.get("gpu_layers"), int):
        override["n_gpu_layers"] = preset["gpu_layers"]
    if isinstance(preset.get("threads"), int):
        override["n_threads"] = preset["threads"]
    if isinstance(preset.get("port"), int):
        override["port"] = preset["port"]
    if isinstance(preset.get("batch_size"), int):
        override["batch_size"] = preset["batch_size"]
    if isinstance(preset.get("micro_batch_size"), int):
        override["micro_batch_size"] = preset["micro_batch_size"]
    if isinstance(preset.get("cache_type_k"), str):
        override["cache_type_k"] = preset["cache_type_k"]
    if isinstance(preset.get("cache_type_v"), str):
        override["cache_type_v"] = preset["cache_type_v"]
    if isinstance(preset.get("cache_reuse"), int):
        override["cache_reuse"] = preset["cache_reuse"]
    return override


def build_launch_plan(
    model: IndexedModel,
    *,
    models_dir: Path,
    ollama_dir: Path,
    ollama_models_dir: Path,
    config_override: dict[str, object] | None = None,
    capabilities: LlamaRuntimeCapabilities | None = None,
) -> RuntimeLaunchPlan:
    ollama_executable = ollama_dir / "ollama.exe"
    prefer_gpu = _effective_gpu_layers(model, config_override) > 0
    runtime_dir = resolve_runtime_dir(
        model,
        models_dir,
        ollama_dir,
        prefer_gpu=prefer_gpu,
    )
    warnings: list[str] = []
    blockers: list[str] = []

    if prefer_gpu and runtime_dir is not None:
        runtime_key = str(runtime_dir).replace("\\", "/").lower()
        if "vulkan" in runtime_key:
            warnings.append("gpu_runtime_selected:vulkan")
        elif "cpu-x64" in runtime_key:
            warnings.append("gpu_layers_requested_but_cpu_runtime_selected")

    validation_error = validate_model_for_launch(
        model,
        runtime_dir=runtime_dir,
        ollama_executable=ollama_executable,
        models_dir=models_dir,
        config_override=config_override,
    )
    if validation_error:
        blockers.append(validation_error)

    if model.size_gb and model.size_gb > 8:
        warnings.append("Large model — prefer CPU or conservative GPU layers")

    if runtime_dir is not None:
        staged = ensure_openssl_dlls_beside_runtime(runtime_dir, models_dir)
        openssl_dir = resolve_openssl_dir(models_dir, runtime_dir)
        if openssl_dir is not None and openssl_dir.resolve() != runtime_dir.resolve():
            if staged == runtime_dir and _dir_has_openssl_dlls(runtime_dir):
                warnings.append(
                    f"OpenSSL DLLs nach {runtime_dir} kopiert (Quelle: {openssl_dir})."
                )
            else:
                warnings.append(
                    f"OpenSSL DLLs (libssl/libcrypto) werden aus {openssl_dir} geladen."
                )

    effective_runtime_dir = runtime_dir or (models_dir / "llama.cpp-win-runtime")

    port = resolve_preferred_port(model, models_dir, config_override=config_override) or 8091
    command = build_runtime_command(
        model,
        effective_runtime_dir,
        port,
        ollama_executable=ollama_executable,
        config_override=config_override,
        capabilities=capabilities,
    )

    return RuntimeLaunchPlan(
        command=command,
        env=build_runtime_env(
            model,
            ollama_models_dir,
            runtime_dir=effective_runtime_dir if runtime_dir is not None else None,
            models_dir=models_dir if runtime_dir is not None else None,
        ),
        runtime_dir=effective_runtime_dir,
        port=port,
        endpoint=f"http://127.0.0.1:{port}",
        command_preview=format_command_preview(command),
        warnings=warnings,
        blockers=blockers,
    )


_CUDA_OOM_STDERR_PATTERNS: tuple[str, ...] = (
    "out of memory",
    "cuda error",
    "cudamalloc failed",
    "insufficient memory",
    "ggml_cuda_error",
    "not enough memory",
)


def is_oom_stderr(stderr_tail: str | None) -> bool:
    """True if stderr looks like a CUDA/ggml out-of-memory failure.

    Usable directly by callers (e.g. RuntimeService's OOM-retry loop) that
    already have a stderr tail but not necessarily a process exit code.
    """
    if not stderr_tail:
        return False
    lowered = stderr_tail.lower()
    return any(pattern in lowered for pattern in _CUDA_OOM_STDERR_PATTERNS)


def classify_exit_failure(exit_code: int, stderr_tail: str | None) -> str:
    """Classify a failed launch for retry logic (not just for a display string).

    Returns one of "dll_missing", "arch_mismatch", "oom", "unknown".
    """
    if exit_code == 3221225781 or exit_code == -1073741515:
        return "dll_missing"

    if stderr_tail:
        lowered = stderr_tail.lower()
        if "unknown model architecture" in lowered or "unsupported model architecture" in lowered:
            return "arch_mismatch"
        if is_oom_stderr(stderr_tail):
            return "oom"

    return "unknown"


def describe_process_exit_code(exit_code: int, stderr_tail: str | None = None) -> str:
    if exit_code == 3221225781 or exit_code == -1073741515:
        return (
            "llama-server startete nicht: fehlende DLLs (0xC0000135). "
            "Pruefen: ggml*.dll, libssl/libcrypto im Runtime-Ordner oder auf PATH "
            "(z. B. D:/win_runtimes/Git/mingw64/bin)."
        )

    if stderr_tail:
        lowered = stderr_tail.lower()
        if "unknown model architecture" in lowered or "unsupported model architecture" in lowered:
            return (
                "llama-server konnte das Modell nicht laden: die verwendete Modellarchitektur ist "
                f"unsupported by the installed llama-server build ({stderr_tail}). Bitte ein kompatibles GGUF-Modell "
                "mit einer neueren/kompatiblen llama.cpp-Build-Version verwenden."
            )
        if classify_exit_failure(exit_code, stderr_tail) == "oom":
            return (
                "llama-server ist mit einem Speicherfehler abgestuerzt (vermutlich zu viele GPU-Layer fuer "
                f"den verfuegbaren VRAM): {stderr_tail}"
            )

    return f"Runtime process exited with code {exit_code}."


def wait_for_runtime_endpoint(
    endpoint: str,
    checker: Callable[[str], bool],
    process: ManagedProcess | None,
    *,
    timeout_seconds: float,
    interval_seconds: float,
    stderr_tail: Callable[[], str] | None = None,
) -> tuple[bool, str]:
    deadline = time.monotonic() + timeout_seconds

    while time.monotonic() < deadline:
        if process is not None:
            exit_code = process.poll()
            if exit_code is not None:
                tail = stderr_tail() if stderr_tail else ""
                detail = f" Runtime stderr: {tail}" if tail else ""
                message = describe_process_exit_code(exit_code, tail)
                return False, f"{message}{detail}"

        if checker(endpoint):
            return True, ""

        time.sleep(interval_seconds)

    tail = stderr_tail() if stderr_tail else ""
    detail = f" Stderr tail: {tail}" if tail else ""
    return False, f"Runtime endpoint not ready within {int(timeout_seconds)}s.{detail}"


def default_warmup_timeout_seconds() -> float:
    return float(os.getenv("DBZS_RUNTIME_WARMUP_TIMEOUT_SECONDS", "600"))


def default_warmup_interval_seconds() -> float:
    return float(os.getenv("DBZS_RUNTIME_WARMUP_INTERVAL_SECONDS", "0.5"))
