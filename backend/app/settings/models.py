from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# P1 Phase 4: Model Discovery modes
ModelDiscoveryMode = Literal["project_local_strict", "local_with_ollama", "cloud_enabled"]


class AppSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: int = Field(default=1, ge=1)
    revision: int = Field(default=0, ge=0)
    updatedAt: str | None = None

    theme: Literal["dark", "light"] = "dark"
    autoSave: bool = True
    editorFontSize: int = Field(default=14, ge=10, le=28)
    terminalShell: Literal["powershell", "cmd", "pwsh"] = "powershell"
    safeCommandConfirmation: bool = True
    telemetryEnabled: Literal[False] = False
    modelsPath: str = Field(default="D:/Models", min_length=1, max_length=260)
    defaultModelId: str = Field(default="", max_length=120)
    defaultChatModelId: str = Field(default="", max_length=120)
    defaultModelName: str = Field(default="Default Model", max_length=120)
    backendUrl: str = Field(default="http://127.0.0.1:8876", min_length=1, max_length=260)
    agentExecutionEnabled: bool = True
    safeMode: bool = True
    maxAgentRuntimeSeconds: int = Field(default=3600, ge=30, le=86_400)
    maxFileScanCount: int = Field(default=2500, ge=100, le=100_000)
    cloudModelsEnabled: bool = False
    preferLocalModels: bool = True
    localOnlyModels: bool = True
    ollamaBaseUrl: str = Field(default="http://127.0.0.1:11434", max_length=260)
    anthropicApiKey: str = Field(default="", max_length=260)
    openaiApiKey: str = Field(default="", max_length=260)
    huggingfaceApiKey: str = Field(default="", max_length=260)
    defaultPlannerModelId: str = Field(default="", max_length=120)
    defaultCoderModelId: str = Field(default="", max_length=120)
    defaultReviewerModelId: str = Field(default="", max_length=120)
    defaultDebugModelId: str = Field(default="", max_length=120)
    defaultUtilityModelId: str = Field(default="", max_length=120)
    defaultVisionModelId: str = Field(default="", max_length=120)
    autoStartChatRuntime: bool = False
    autoStartCodingRuntime: bool = False
    autoStartVisionRuntime: bool = False
    autoStartReviewRuntime: bool = False
    idleUnloadWorkModelsMinutes: int = Field(default=10, ge=0, le=240)
    chatRuntimeSlot: Literal["quality_cpu"] = "quality_cpu"
    codingRuntimeSlot: Literal["fast_gpu"] = "fast_gpu"
    chatRuntimePort: int = Field(default=8081, ge=1, le=65535)
    codingRuntimePort: int = Field(default=8082, ge=1, le=65535)
    stopDesktopRuntimesOnExit: bool = True
    maxAutonomousSteps: int = Field(default=20, ge=1, le=200)
    maxDebugRetries: int = Field(default=2, ge=0, le=20)
    maxFailedTaskRetries: int = Field(default=1, ge=0, le=10)
    localOnly: bool = True
    modelDiscoveryMode: ModelDiscoveryMode = "project_local_strict"
    runtimeChatUseBroker: bool = True
    runtimeChatEnableSlotValidation: bool = True
    runtimeChatEnableAgentTurnLoop: bool = True
    runtimeChatEnableStrictFallback: bool = True
    runtimeChatEnableDiagnostics: bool = True
    runtimeChatShadowMode: bool = False
    runtimeChatCanaryPercent: int = Field(default=100, ge=0, le=100)
    runtimeChatStopOnShadowMismatch: bool = False
    reasoningDisplayMode: Literal["hidden", "summary", "expanded"] = "summary"
    contextSpoolerEnabled: bool = True
    ragEnabled: bool = True
    hybridRetrievalEnabled: bool = True
    reasoningTraceEnabled: bool = True
    tokenBudgetOutputReserveRatio: float = Field(default=0.22, ge=0, le=0.8)
    tokenBudgetToolReserveRatio: float = Field(default=0.07, ge=0, le=0.5)
    tokenBudgetSafetyReserveRatio: float = Field(default=0.05, ge=0, le=0.5)
    conversationControlV2: bool = True
    legacyStructuredMarkupParser: bool = False
    defaultOrchestratorModelId: str = Field(default="", max_length=120)
    autoStartOrchestratorRuntime: bool = True
    orchestratorRuntimeSlot: Literal["orchestrator_cpu"] = "orchestrator_cpu"
    orchestratorRuntimePort: int = Field(default=8084, ge=1, le=65535)
    timeoutStreamIdleSeconds: int = Field(default=30, ge=5, le=3600)
    timeoutFirstTokenSeconds: int = Field(default=90, ge=10, le=3600)
    timeoutGenerationSeconds: int = Field(default=300, ge=30, le=14_400)
    timeoutPromptEvalSeconds: int = Field(default=90, ge=10, le=3600)
    timeoutCpuSafeStreamIdleSeconds: int = Field(default=180, ge=15, le=3600)
    timeoutCpuSafeFirstTokenSeconds: int = Field(default=120, ge=15, le=3600)
    timeoutCpuSafeGenerationSeconds: int = Field(default=600, ge=60, le=14_400)


class SettingsPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baseRevision: int = Field(ge=0)
    changes: dict[str, Any]


class SettingsRevisionConflict(Exception):
    """Raised when a patch baseRevision does not match the stored revision."""

    code = "settings_revision_conflict"
