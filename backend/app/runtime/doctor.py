"""Runtime doctor — local model/runtime diagnostics without auto-start."""

from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any, Literal
from urllib import error, request

from pydantic import BaseModel, Field

from app.core.config import get_models_dir, get_ollama_dir, get_ollama_models_dir
from app.model_lab.repository import get_shared_model_lab_repository
from app.models.discovery_mode import get_model_discovery_mode
from app.models.index_service import ModelIndexService
from app.runtime.launch import build_launch_plan, config_override_from_preset
from app.runtime.service import RuntimeService
from app.settings.service import get_settings_service


def _model_lab_bridge_kwargs() -> dict[str, object]:
    return {
        "model_lab_repository": get_shared_model_lab_repository,
        "settings_service": get_settings_service(),
    }


CheckStatus = Literal["ok", "warn", "error"]
RuntimeProbeFailureCode = Literal[
    "allow_start_disabled",
    "model_id_missing",
    "pair_missing",
    "projector_missing",
    "runtime_start",
    "endpoint",
    "models_endpoint",
    "vision_chat",
]


class RuntimeCheck(BaseModel):
    id: str
    status: CheckStatus
    message: str
    recommendation: str = ""


class ModelDoctorEntry(BaseModel):
    model_id: str
    name: str
    format: str
    artifact_type: str
    runtime_launcher: str
    provider: str
    compatibility: str
    runnable: bool
    estimated_role: str
    safe_preset: dict[str, Any] = Field(default_factory=dict)
    command_preview: str = ""
    blockers: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class SuggestedProfile(BaseModel):
    name: str
    description: str
    hardware_class: str
    preset: dict[str, Any] = Field(default_factory=dict)


class RuntimeDoctorReport(BaseModel):
    checks: list[RuntimeCheck]
    models: list[ModelDoctorEntry]
    suggested_profiles: list[SuggestedProfile]
    summary: str


class RuntimeDryRunRequest(BaseModel):
    model_id: str
    profile_name: str | None = None


class RuntimeDryRunResponse(BaseModel):
    model_id: str
    command_preview: str
    preset: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)


class RuntimeProbeRequest(BaseModel):
    allow_start: bool = False
    model_id: str | None = None
    projector_artifact_id: str | None = None


class RuntimeProbeResponse(BaseModel):
    allowed: bool
    message: str
    stderr_tail: str = ""
    stdout_tail: str = ""
    projector_artifact_id: str | None = None
    mmproj_path: str | None = None
    endpoint_verified: bool = False
    models_endpoint_verified: bool = False
    advertised_models: list[str] = Field(default_factory=list)
    vision_chat_verified: bool = False
    vision_response_preview: str | None = None
    verification_failures: list[RuntimeProbeFailureCode] = Field(default_factory=list)


HARDWARE_PRESETS: list[SuggestedProfile] = [
    SuggestedProfile(
        name="safe_cpu_coder",
        description="CPU-only coding profile for stable local runs.",
        hardware_class="cpu",
        preset={"gpu_layers": 0, "ctx": 4096, "threads": 6},
    ),
    SuggestedProfile(
        name="hybrid_gtx1650_coder",
        description="Conservative hybrid profile for GTX 1650 SUPER 4GB VRAM.",
        hardware_class="hybrid",
        preset={"gpu_layers": 12, "ctx": 4096, "threads": 6, "note": "4GB VRAM — keep layers conservative"},
    ),
    SuggestedProfile(
        name="tiny_review_agent",
        description="Small review model with low context for quick checks.",
        hardware_class="cpu",
        preset={"gpu_layers": 0, "ctx": 2048, "threads": 4, "prefer": "ollama"},
    ),
]


def _port_status(port: int) -> RuntimeCheck:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        in_use = sock.connect_ex(("127.0.0.1", port)) == 0
    if in_use:
        return RuntimeCheck(
            id=f"port_{port}",
            status="warn",
            message=f"Port {port} is in use",
            recommendation="Stop conflicting process or choose another port.",
        )
    return RuntimeCheck(id=f"port_{port}", status="ok", message=f"Port {port} is free")


def _path_check(check_id: str, path: Path, required: bool = False) -> RuntimeCheck:
    if path.exists():
        return RuntimeCheck(id=check_id, status="ok", message=str(path))
    status: CheckStatus = "error" if required else "warn"
    return RuntimeCheck(
        id=check_id,
        status=status,
        message=f"Missing: {path}",
        recommendation="Set env override or install runtime assets.",
    )


def _probe_runtime_endpoint(endpoint: str) -> tuple[bool, bool, list[str]]:
    base = endpoint.rstrip("/")
    endpoint_verified = False
    models_endpoint_verified = False
    advertised_models: list[str] = []

    for candidate in (f"{base}/health", f"{base}/"):
        try:
            with request.urlopen(candidate, timeout=2) as response:
                if 200 <= response.status < 300:
                    endpoint_verified = True
                    break
        except (OSError, TimeoutError, error.URLError):
            continue

    try:
        with request.urlopen(f"{base}/v1/models", timeout=2) as response:
            if 200 <= response.status < 300:
                models_endpoint_verified = True
                payload = json.loads(response.read().decode("utf-8"))
                if isinstance(payload, dict):
                    data = payload.get("data")
                    if isinstance(data, list):
                        for item in data:
                            if not isinstance(item, dict):
                                continue
                            model_id = item.get("id")
                            if isinstance(model_id, str) and model_id:
                                advertised_models.append(model_id)
    except (OSError, TimeoutError, error.URLError, UnicodeDecodeError, json.JSONDecodeError):
        pass

    return endpoint_verified, models_endpoint_verified, advertised_models


def _probe_verification_failure_message(endpoint_verified: bool, models_endpoint_verified: bool) -> str:
    missing_checks: list[str] = []
    if not endpoint_verified:
        missing_checks.append("Basis-Endpoint")
    if not models_endpoint_verified:
        missing_checks.append("/v1/models")
    if not missing_checks:
        return "Controlled probe started, but runtime endpoint verification did not complete successfully."
    return "Controlled probe started, but verification failed for: " + ", ".join(missing_checks) + "."


def _collect_probe_failure_codes(
    *,
    endpoint_verified: bool,
    models_endpoint_verified: bool,
    vision_required: bool,
    vision_chat_verified: bool,
) -> list[RuntimeProbeFailureCode]:
    failures: list[RuntimeProbeFailureCode] = []
    if not endpoint_verified:
        failures.append("endpoint")
    if not models_endpoint_verified:
        failures.append("models_endpoint")
    if vision_required and not vision_chat_verified:
        failures.append("vision_chat")
    return failures


def _build_probe_image_data_url() -> str:
    # 1x1 PNG keeps the multimodal probe tiny while still exercising image input.
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotkZYAAAAASUVORK5CYII="


def _verify_multimodal_chat(runtime: RuntimeService, endpoint: str, model_id: str) -> tuple[bool, str | None]:
    payload = {
        "model": model_id,
        "max_tokens": 16,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Antworte nur mit dem Wort ok."},
                    {"type": "image_url", "image_url": {"url": _build_probe_image_data_url()}},
                ],
            }
        ],
    }
    response = runtime.chat_client.complete(endpoint.rstrip("/"), payload)
    preview = response.strip()
    return bool(preview), preview[:120] if preview else None


def _multimodal_probe_exception_preview(exc: BaseException) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return message[:160]


def _estimate_role(name: str, artifact_type: str) -> str:
    lowered = name.lower()
    if "review" in lowered or artifact_type == "ollama":
        return "reviewer"
    if "code" in lowered or "coder" in lowered:
        return "coder"
    if "embed" in lowered:
        return "embedder"
    return "general"


def _default_safe_preset(model_format: str, runtime_launcher: str) -> dict[str, Any]:
    if runtime_launcher == "ollama" or model_format == "ollama":
        return {"gpu_layers": 0, "ctx": 4096, "threads": 6, "prefer": "ollama"}
    return {"gpu_layers": 0, "ctx": 4096, "threads": 6}


def _provider_for_index_model(model: Any) -> str:
    if model.runtime_launcher == "ollama":
        return "ollama"
    return model.backend or "llama.cpp"


def build_runtime_doctor(
    models_dir: Path | None = None,
    ollama_dir: Path | None = None,
    ollama_models_dir: Path | None = None,
) -> RuntimeDoctorReport:
    models_path = models_dir or get_models_dir()
    ollama_path = ollama_dir or get_ollama_dir()
    ollama_models_path = ollama_models_dir or get_ollama_models_dir()
    from app.runtime.win_runtimes import first_win_llama_runtime_dir

    bundled_llama = models_path / "llama.cpp-win-runtime" / "llama-server.exe"
    discovered_runtime = first_win_llama_runtime_dir()
    llama_server = (
        bundled_llama
        if bundled_llama.exists()
        else (
            (discovered_runtime / "llama-server.exe")
            if discovered_runtime is not None
            else bundled_llama
        )
    )
    ollama_exe = ollama_path / "ollama.exe"
    discovery_mode = get_model_discovery_mode()

    checks = [
        _path_check("models_dir", models_path, required=True),
        _path_check("models_catalog", models_path / "models.catalog.json"),
        _path_check("llama_server", llama_server),
        _port_status(8091),
    ]
    if discovery_mode == "project_local_strict":
        checks.append(
            RuntimeCheck(
                id="ollama_discovery",
                status="ok",
                message="Ollama discovery disabled by project_local_strict mode.",
            )
        )
    else:
        checks.append(_path_check("ollama_exe", ollama_exe))
        checks.append(_path_check("ollama_models_dir", ollama_models_path))
        checks.append(_port_status(11434))

    index_service = ModelIndexService(
        models_dir=models_path,
        ollama_dir=ollama_path,
        ollama_models_dir=ollama_models_path,
        discovery_mode=discovery_mode,
        **_model_lab_bridge_kwargs(),
    )
    index = index_service.build_index()
    model_entries: list[ModelDoctorEntry] = []

    for model in index.models:
        if model.runtime_launcher not in ("llama-server", "ollama"):
            continue

        preset = _default_safe_preset(model.format, model.runtime_launcher)
        plan = build_launch_plan(
            model,
            models_dir=models_path,
            ollama_dir=ollama_path,
            ollama_models_dir=ollama_models_path,
            config_override=config_override_from_preset(preset),
        )
        blockers = list(plan.blockers)
        warnings = list(plan.warnings)

        if model.runtime_launcher == "llama-server" and model.format == "gguf" and not llama_server.exists():
            if "llama-server.exe missing" not in " ".join(blockers):
                blockers.append("llama-server.exe missing")
        if model.runtime_launcher == "ollama" and model.format == "ollama" and not ollama_exe.exists():
            if "ollama.exe missing" not in " ".join(blockers):
                blockers.append("ollama.exe missing")

        model_entries.append(
            ModelDoctorEntry(
                model_id=model.id,
                name=model.name,
                format=model.format,
                artifact_type=model.artifact_type,
                runtime_launcher=model.runtime_launcher,
                provider=_provider_for_index_model(model),
                compatibility=model.compatibility,
                runnable=len(blockers) == 0,
                estimated_role=_estimate_role(model.name, model.artifact_type),
                safe_preset=preset,
                command_preview=plan.command_preview,
                blockers=blockers,
                warnings=warnings,
            )
        )

    error_count = sum(1 for item in checks if item.status == "error")
    warn_count = sum(1 for item in checks if item.status == "warn")
    summary = f"{len(checks)} checks, {warn_count} warnings, {error_count} errors, {len(model_entries)} models"

    return RuntimeDoctorReport(
        checks=checks,
        models=model_entries,
        suggested_profiles=HARDWARE_PRESETS,
        summary=summary,
    )


def build_dry_run(
    model_id: str,
    profile_name: str | None = None,
    *,
    models_dir: Path | None = None,
    ollama_dir: Path | None = None,
    ollama_models_dir: Path | None = None,
) -> RuntimeDryRunResponse:
    models_path = models_dir or get_models_dir()
    ollama_path = ollama_dir or get_ollama_dir()
    ollama_models_path = ollama_models_dir or get_ollama_models_dir()

    index_service = ModelIndexService(
        models_dir=models_path,
        ollama_dir=ollama_path,
        ollama_models_dir=ollama_models_path,
        discovery_mode=get_model_discovery_mode(),
        **_model_lab_bridge_kwargs(),
    )
    model = next((item for item in index_service.build_index().models if item.id == model_id), None)
    if model is None:
        raise ValueError(f"Model not found: {model_id}")

    preset = _default_safe_preset(model.format, model.runtime_launcher)
    if profile_name:
        profile = next((item for item in HARDWARE_PRESETS if item.name == profile_name), None)
        if profile:
            preset.update(profile.preset)

    plan = build_launch_plan(
        model,
        models_dir=models_path,
        ollama_dir=ollama_path,
        ollama_models_dir=ollama_models_path,
        config_override=config_override_from_preset(preset),
    )

    return RuntimeDryRunResponse(
        model_id=model_id,
        command_preview=plan.command_preview,
        preset=preset,
        warnings=[*plan.warnings, *plan.blockers],
    )


def probe_runtime(
    request: RuntimeProbeRequest,
    *,
    service: RuntimeService | None = None,
    models_dir: Path | None = None,
    ollama_dir: Path | None = None,
    ollama_models_dir: Path | None = None,
    endpoint_verifier: Any | None = None,
    multimodal_verifier: Any | None = None,
) -> RuntimeProbeResponse:
    if not request.allow_start:
        return RuntimeProbeResponse(
            allowed=False,
            message="Probe disabled. Set allow_start=true to permit controlled probe.",
            verification_failures=["allow_start_disabled"],
        )

    if not request.model_id:
        return RuntimeProbeResponse(
            allowed=False,
            message="model_id is required for controlled probe.",
            verification_failures=["model_id_missing"],
        )

    mmproj_path: str | None = None
    projector_artifact_id = request.projector_artifact_id
    if projector_artifact_id:
        index_service = ModelIndexService(
            models_dir=models_dir or get_models_dir(),
            ollama_dir=ollama_dir or get_ollama_dir(),
            ollama_models_dir=ollama_models_dir or get_ollama_models_dir(),
            discovery_mode=get_model_discovery_mode(),
            **_model_lab_bridge_kwargs(),
        )
        index = index_service.build_index()
        pair = next(
            (
                item for item in index.multimodal_pairs
                if item.base_model_id == request.model_id and item.projector_artifact_id == projector_artifact_id
            ),
            None,
        )
        if pair is None:
            return RuntimeProbeResponse(
                allowed=False,
                message=f"Kein multimodales Paar fuer Modell '{request.model_id}' und Projector '{projector_artifact_id}' gefunden.",
                projector_artifact_id=projector_artifact_id,
                verification_failures=["pair_missing"],
            )
        projector = next((item for item in index.support_artifacts if item.id == projector_artifact_id), None)
        if projector is None:
            return RuntimeProbeResponse(
                allowed=False,
                message=f"Projector-Artefakt '{projector_artifact_id}' ist im Index nicht verfuegbar.",
                projector_artifact_id=projector_artifact_id,
                verification_failures=["projector_missing"],
            )
        mmproj_path = projector.path

    runtime = service or RuntimeService(
        model_index_service=ModelIndexService(
            models_dir=models_dir or get_models_dir(),
            ollama_dir=ollama_dir or get_ollama_dir(),
            ollama_models_dir=ollama_models_dir or get_ollama_models_dir(),
            discovery_mode=get_model_discovery_mode(),
            **_model_lab_bridge_kwargs(),
        ),
        ollama_dir=ollama_dir or get_ollama_dir(),
        ollama_models_dir=ollama_models_dir or get_ollama_models_dir(),
        warmup_timeout_seconds=30,
        warmup_interval_seconds=0.25,
    )

    start_config = {"mmproj_path": mmproj_path} if mmproj_path else None
    status = runtime.start_model(request.model_id, config=start_config)
    if status.state != "running":
        logs = runtime.get_logs()
        return RuntimeProbeResponse(
            allowed=False,
            message=status.message or "Controlled probe failed to start runtime.",
            stderr_tail=status.stderr_tail or logs.stderr_tail,
            stdout_tail=status.stdout_tail or logs.stdout_tail,
            projector_artifact_id=projector_artifact_id,
            mmproj_path=mmproj_path,
            verification_failures=["runtime_start"],
        )

    endpoint_verified = False
    models_endpoint_verified = False
    advertised_models: list[str] = []
    vision_chat_verified = False
    vision_response_preview: str | None = None
    if status.endpoint:
        verify_endpoint = endpoint_verifier or _probe_runtime_endpoint
        endpoint_verified, models_endpoint_verified, advertised_models = verify_endpoint(status.endpoint)
        if mmproj_path:
            verify_multimodal = multimodal_verifier or _verify_multimodal_chat
            try:
                vision_chat_verified, vision_response_preview = verify_multimodal(runtime, status.endpoint, request.model_id)
            except Exception as exc:
                vision_chat_verified = False
                vision_response_preview = _multimodal_probe_exception_preview(exc)

    runtime.stop_model()
    if not endpoint_verified or not models_endpoint_verified or (mmproj_path is not None and not vision_chat_verified):
        verification_failures = _collect_probe_failure_codes(
            endpoint_verified=endpoint_verified,
            models_endpoint_verified=models_endpoint_verified,
            vision_required=mmproj_path is not None,
            vision_chat_verified=vision_chat_verified,
        )
        failure_message = _probe_verification_failure_message(endpoint_verified, models_endpoint_verified)
        if mmproj_path is not None and vision_chat_verified is False:
            failure_message = (
                f"{failure_message} Bildtest fehlgeschlagen."
                if not vision_response_preview
                else f"{failure_message} Bildtest fehlgeschlagen: {vision_response_preview}."
            )
        return RuntimeProbeResponse(
            allowed=False,
            message=failure_message,
            projector_artifact_id=projector_artifact_id,
            mmproj_path=mmproj_path,
            endpoint_verified=endpoint_verified,
            models_endpoint_verified=models_endpoint_verified,
            advertised_models=advertised_models,
            vision_chat_verified=vision_chat_verified,
            vision_response_preview=vision_response_preview,
            verification_failures=verification_failures,
        )
    if projector_artifact_id and mmproj_path:
        index_service.mark_multimodal_pair_verified(request.model_id, projector_artifact_id)
    return RuntimeProbeResponse(
        allowed=True,
        message=f"Controlled probe succeeded for {request.model_id} on port {status.port}.",
        projector_artifact_id=projector_artifact_id,
        mmproj_path=mmproj_path,
        endpoint_verified=endpoint_verified,
        models_endpoint_verified=models_endpoint_verified,
        advertised_models=advertised_models,
        vision_chat_verified=vision_chat_verified,
        vision_response_preview=vision_response_preview,
    )
