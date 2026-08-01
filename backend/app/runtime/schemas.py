from typing import Literal

from pydantic import BaseModel


RuntimeState = Literal["stopped", "starting", "running", "error"]
RuntimeProvider = Literal["llama.cpp", "ollama", "antigravity"]
HardwareMode = Literal["cpu", "gpu", "hybrid"]
RuntimeFallbackPolicy = Literal[
    "strict",
    "allow_local_fallback",
    "allow_cloud_fallback",
    "allow_any_fallback",
]
RuntimeSlotId = Literal["fast_gpu", "quality_cpu", "utility", "orchestrator_cpu", "vision_gpu"]

# P2 Phase 5: Runtime Tool Registry schemas
ToolName = Literal["llama-server", "llama-cli", "llama-bench", "llama-tokenize"]
ToolStatus = Literal["available", "not_found", "error"]


class RuntimeStatus(BaseModel):
    state: RuntimeState
    provider: RuntimeProvider | None = None
    model_id: str | None = None
    model_name: str | None = None
    port: int | None = None
    pid: int | None = None
    endpoint: str | None = None
    message: str = ""
    error_code: str | None = None
    diagnostic_context: dict[str, object] | None = None
    stderr_tail: str = ""
    stdout_tail: str = ""
    slot_id: RuntimeSlotId | None = None
    hardware_mode: HardwareMode | None = None
    gpu_layers: int | None = None
    gpu_device: str | None = None
    vram_total_bytes: int | None = None
    vram_used_bytes: int | None = None


class RuntimeSlotStatus(RuntimeStatus):
    slot_id: RuntimeSlotId
    device_policy: Literal["gpu", "cpu", "auto"] = "auto"
    gpu_layers: int | None = None
    context_size: int | None = None
    chat_ready: bool = False
    hardware_mode: HardwareMode | None = None
    gpu_device: str | None = None
    vram_total_bytes: int | None = None
    vram_used_bytes: int | None = None
    error_message: str | None = None
    # Phase 2: Runtime Residency Cache
    launch_fingerprint: str | None = None
    active_requests: int | None = None
    residency_state: str | None = None
    # Phase 6: UI diagnostics — surfaced from the same resource plan as gpu_layers/context_size
    reserved_output_tokens: int | None = None
    batch_size: int | None = None
    micro_batch_size: int | None = None
    cache_type_k: str | None = None
    cache_type_v: str | None = None


class RuntimeLogsResponse(BaseModel):
    state: RuntimeState
    model_id: str | None = None
    stderr_tail: str = ""
    stdout_tail: str = ""


class StartModelRequest(BaseModel):
    model_id: str
    slot_id: RuntimeSlotId | None = None
    profile: str | None = None


ChatRole = Literal["system", "user", "assistant"]
AttachmentSource = Literal["clipboard", "file_dialog"]
AttachmentKind = Literal["image", "document", "archive", "text", "code"]


class RuntimeChatMessage(BaseModel):
    role: ChatRole
    content: str


class RuntimeChatFileContext(BaseModel):
    path: str
    language: str
    content: str


class ChatAttachmentPrepareSource(BaseModel):
    name: str
    source: AttachmentSource
    extension: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None
    path: str | None = None
    data_base64: str | None = None


class ChatAttachmentArchiveEntry(BaseModel):
    path: str
    kind: AttachmentKind | Literal["binary"]
    size_bytes: int | None = None
    included_inline: bool = False
    truncated: bool = False


class ChatAttachmentPrepared(BaseModel):
    id: str
    name: str
    kind: AttachmentKind
    extension: str
    mime_type: str
    source: AttachmentSource
    size_bytes: int | None = None
    path: str | None = None
    data_url: str | None = None
    text_content: str | None = None
    derived_summary: str | None = None
    archive_entries: list[ChatAttachmentArchiveEntry] = []
    truncated: bool = False
    error: str | None = None


class PrepareChatAttachmentsRequest(BaseModel):
    attachments: list[ChatAttachmentPrepareSource]


class PrepareChatAttachmentsResponse(BaseModel):
    attachments: list[ChatAttachmentPrepared]


class RuntimeChatToolsPayload(BaseModel):
    """Tool definitions attached to a chat turn, tagged with how they must be applied.

    ``mode="prompt"`` means the tool definitions are already folded into the
    prompt text by the caller and must NOT also be forwarded as a
    provider-native ``tools`` field (that would double-expose them and can
    trigger malformed/duplicate tool calls). ``mode="native"`` means the
    provider's own function-calling API should receive ``definitions``
    verbatim as its ``tools`` payload.
    """

    mode: Literal["prompt", "native"]
    definitions: list[dict] = []


class RuntimeChatRequest(BaseModel):
    messages: list[RuntimeChatMessage]
    file_context: RuntimeChatFileContext | None = None
    temperature: float = 0.2
    max_tokens: int = 1024
    top_p: float | None = None
    min_p: float | None = None
    repeat_penalty: float | None = None
    repeat_last_n: int | None = None
    presence_penalty: float | None = None
    frequency_penalty: float | None = None
    tools: RuntimeChatToolsPayload | None = None
    model_id: str | None = None
    slot_id: RuntimeSlotId | None = None
    provider: str | None = None
    fallback_policy: RuntimeFallbackPolicy | None = None
    routing_reason: str | None = None
    decision_id: str | None = None
    request_id: str | None = None
    run_id: str | None = None

    def native_tools_payload(self) -> list[dict] | None:
        """Provider-native ``tools`` payload, or ``None`` when not applicable.

        Only ``mode="native"`` tool definitions are ever forwarded to the
        provider's own tool-calling API; ``mode="prompt"`` tools are the
        caller's responsibility and must stay out of the wire payload.
        """
        if self.tools is None or self.tools.mode != "native":
            return None
        return self.tools.definitions or None


class RuntimeChatResponse(BaseModel):
    message: RuntimeChatMessage
    model_id: str | None = None
    model_name: str | None = None


class RuntimeChatStreamDonePayload(BaseModel):
    type: Literal["done"] = "done"
    slot_id: RuntimeSlotId | None = None
    model_id: str | None = None
    model_name: str | None = None
    # Phase 5: real usage stats from llama-server, when available (never
    # fabricated — absent rather than guessed when the provider didn't send them).
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    finish_reason: str | None = None


# P2 Phase 5: Runtime Tool Registry
class ToolCommand(BaseModel):
    """A single command available in a tool (e.g., llama-server --help)."""
    name: str
    description: str = ""
    args: list[str] = []


class ToolInfo(BaseModel):
    """Information about a runtime tool."""
    name: ToolName
    status: ToolStatus
    version: str | None = None
    path: str | None = None
    available_commands: list[ToolCommand] = []
    error_message: str | None = None


class RuntimeToolRegistry(BaseModel):
    """Registry of available runtime tools."""
    tools: dict[ToolName, ToolInfo] = {}
    timestamp: str | None = None

    def get_tool(self, name: ToolName) -> ToolInfo | None:
        return self.tools.get(name)

    def is_available(self, name: ToolName) -> bool:
        tool = self.get_tool(name)
        return tool is not None and tool.status == "available"


# Runtime Resource Planner (Phase 1)
CacheType = Literal["f16", "q8_0", "q4_0"]
HardwareMode = Literal["cpu", "gpu", "hybrid"]
RuntimeBackend = Literal["cpu", "cuda", "vulkan", "metal"]
RuntimeProfileName = Literal["fast", "balanced", "large_context", "cpu_safe", "hybrid", "custom"]


class HardwareFingerprint(BaseModel):
    """Snapshot of the hardware a runtime resource plan was computed for.

    Used to decide whether a persisted "last good" plan may be reused on the
    next launch, or must be recomputed because the hardware changed.
    """
    os: str
    architecture: str
    cpu_model: str | None = None
    cpu_threads: int
    ram_bytes: int
    gpu_name: str | None = None
    gpu_vendor: str | None = None
    vram_bytes: int | None = None
    runtime_backend: RuntimeBackend


class LlamaRuntimeCapabilities(BaseModel):
    """Which llama-server CLI flags the discovered binary actually supports.

    Populated by probing `llama-server --help` for exact flag names
    (RuntimeToolRegistry.detect_capabilities) — never assumed.
    """
    supports_batch_size: bool = False
    supports_ubatch_size: bool = False
    supports_cache_type_k: bool = False
    supports_cache_type_v: bool = False
    supports_cache_reuse: bool = False
    supports_prompt_cache: bool = False


class RuntimeResourcePlan(BaseModel):
    """A concrete, hardware-fit launch configuration for one model in one slot."""
    model_id: str
    slot_id: RuntimeSlotId
    context_size: int
    reserved_output_tokens: int
    reserved_tool_tokens: int
    gpu_layers: int
    batch_size: int
    micro_batch_size: int
    parallel: int
    threads: int
    cache_type_k: CacheType
    cache_type_v: CacheType
    estimated_model_bytes: int
    estimated_kv_cache_bytes: int
    estimated_compute_buffer_bytes: int
    estimated_total_vram_bytes: int
    available_vram_bytes: int | None = None
    safety_reserve_bytes: int
    hardware_mode: HardwareMode
    warnings: list[str] = []


class ResourcePlanPreviewRequest(BaseModel):
    model_id: str
    slot_id: RuntimeSlotId
    profile: RuntimeProfileName | None = None


# Phase 5: real tokenization (replaces the chars/4 heuristic where a slot is reachable)
class TokenizeRequest(BaseModel):
    text: str


class TokenizeResponse(BaseModel):
    token_count: int


class WarmupSlotRequest(BaseModel):
    model_id: str
    decision_id: str | None = None
    timeout_ms: int = 45_000


WarmupOutcome = Literal[
    "inference_ready",
    "endpoint_not_ready",
    "warmup_timeout",
    "warmup_http_failed",
    "warmup_empty_response",
    "runtime_oom",
    "binding_mismatch",
]

RuntimeReadinessStage = Literal[
    "process_started",
    "endpoint_reachable",
    "model_loaded",
    "prompt_eval_verified",
    "token_generation_verified",
    "inference_ready",
]

RuntimeErrorCode = Literal[
    "request_timeout",
    "request_cancelled",
    "model_not_ready",
    "backend_unavailable",
    "invalid_response",
    "runtime_unavailable",
    "target_slot_unavailable",
    "warmup_timeout",
    "warmup_http_failed",
    "warmup_empty_response",
    "binding_mismatch",
    "provider_request_failed",
    "provider_template_error",
    "provider_timeout",
    "runtime_internal_error",
]


class RuntimeWarmupDiagnostics(BaseModel):
    endpoint: str | None = None
    api_mode: str | None = None
    request_method: str | None = None
    request_body: str | None = None
    http_status: int | None = None
    content_type: str | None = None
    response_headers: dict[str, str] | None = None
    stream_events: list[str] | None = None
    parser_decision: str | None = None
    chat_template_used: str | None = None
    stop_sequences_used: list[str] | None = None
    max_tokens: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    process_start_ms: int = 0
    endpoint_ready_ms: int = 0
    model_load_ms: int = 0
    prompt_eval_ms: int = 0
    first_token_ms: int = 0
    total_warmup_ms: int = 0
    token_count: int = 0
    finish_reason: str | None = None
    readiness_stage: RuntimeReadinessStage | None = None
    stream_mode: bool = True
    tool_call_detected: bool = False
    # First 8 KB of the raw HTTP response body — only populated on
    # warmup_empty_response, so a reasoning/tool-calling model's actual
    # output shape is visible instead of just "no token" (see
    # DBZS_CODEE_V4_POST_REPAIR_ANALYSIS.md §1/Schritt 3).
    raw_response_preview: str | None = None
    stderr_tail: str | None = None


class RuntimeWarmupResult(BaseModel):
    ok: bool
    outcome: WarmupOutcome
    detail: str | None = None
    model_id: str
    model_name: str | None = None
    slot_id: RuntimeSlotId
    elapsed_ms: int
    readiness_stage: RuntimeReadinessStage | None = None
    diagnostics: RuntimeWarmupDiagnostics | None = None


class RuntimeErrorContractModel(BaseModel):
    code: RuntimeErrorCode
    message: str
    recoverable: bool
    diagnosticContext: dict[str, object] | None = None
    recommendedAction: str | None = None


# Runtime Residency Cache (Phase 2)
ResidencyPolicyName = Literal["keep_resident", "idle_evict", "manual"]
ResidencyState = Literal["warming", "ready", "busy", "idle", "evicting", "error"]


class RuntimeResidencyEntry(BaseModel):
    """Live residency metadata for a running slot — what is actually loaded,
    under what launch fingerprint, and how busy/idle it currently is.
    """
    slot_id: RuntimeSlotId
    model_id: str
    process_id: int
    endpoint: str
    launch_fingerprint: str
    context_size: int
    gpu_layers: int
    batch_size: int
    micro_batch_size: int
    parallel: int
    cache_type_k: str
    cache_type_v: str
    state: ResidencyState
    active_requests: int = 0
    started_at: str
    last_used_at: str
    idle_since: str | None = None
