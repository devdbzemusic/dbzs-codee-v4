import type { AppSettings } from "@dbzs/shared";
import {
  SETTINGS_REGISTRY,
  getSettingDefinition,
  type SettingDefinition,
} from "./settingsRegistry";

export type SettingsDisplayCategory =
  | "general"
  | "appearance"
  | "workspace"
  | "runtime"
  | "models"
  | "fleet_routing"
  | "rag"
  | "agents"
  | "tools"
  | "security"
  | "diagnostics"
  | "updates";

interface SettingsDisplaySectionDefinition {
  id: string;
  label: string;
  description: string;
  keys: Array<keyof AppSettings>;
}

export interface SettingsDisplayCategoryDefinition {
  id: SettingsDisplayCategory;
  label: string;
  description: string;
  emptyState: string;
  sections: SettingsDisplaySectionDefinition[];
}

const CATEGORY_DEFINITIONS: SettingsDisplayCategoryDefinition[] = [
  {
    id: "general",
    label: "General",
    description: "Grundlegende App- und Notebook-Standards.",
    emptyState: "Aktuell keine allgemeinen Settings mit eigener UI-Konfiguration.",
    sections: [
      {
        id: "general-core",
        label: "Core",
        description: "Allgemeine Anwendungsoptionen.",
        keys: ["autoSave", "backendUrl"],
      },
    ],
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Darstellung von Desktop, Editor und Reasoning-Ansicht.",
    emptyState: "Aktuell keine Appearance-Settings registriert.",
    sections: [
      {
        id: "appearance-ui",
        label: "Interface",
        description: "Farbschema und sichtbare UI-Präferenzen.",
        keys: ["theme", "reasoningDisplayMode", "editorFontSize"],
      },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Datei-, Editor- und Workspace-bezogene Grenzen.",
    emptyState: "Aktuell keine Workspace-Settings registriert.",
    sections: [
      {
        id: "workspace-editor",
        label: "Editor & Scan",
        description: "Editor- und Workspace-Verhalten ohne Runtime-Effekt.",
        keys: ["terminalShell", "maxFileScanCount"],
      },
    ],
  },
  {
    id: "runtime",
    label: "Runtime",
    description: "Runtime-Slots, Ports, Autostart und Laufzeitlimits.",
    emptyState: "Aktuell keine Runtime-Settings registriert.",
    sections: [
      {
        id: "runtime-startup",
        label: "Startup",
        description: "Autostart- und Lifecycle-Verhalten für lokale Runtimes.",
        keys: [
          "autoStartChatRuntime",
          "autoStartCodingRuntime",
          "autoStartVisionRuntime",
          "autoStartReviewRuntime",
          "autoStartOrchestratorRuntime",
          "stopDesktopRuntimesOnExit",
        ],
      },
      {
        id: "runtime-slots",
        label: "Slots & Ports",
        description: "Feste Slot-Contracts und effektive Ports.",
        keys: [
          "chatRuntimeSlot",
          "codingRuntimeSlot",
          "orchestratorRuntimeSlot",
          "chatRuntimePort",
          "codingRuntimePort",
          "orchestratorRuntimePort",
        ],
      },
      {
        id: "runtime-timeouts",
        label: "Timeouts & Idle",
        description: "Laufzeitbudgets für Tokens, Generierung und Idle-Unload.",
        keys: [
          "idleUnloadWorkModelsMinutes",
          "timeoutStreamIdleSeconds",
          "timeoutFirstTokenSeconds",
          "timeoutGenerationSeconds",
          "timeoutPromptEvalSeconds",
          "timeoutCpuSafeStreamIdleSeconds",
          "timeoutCpuSafeFirstTokenSeconds",
          "timeoutCpuSafeGenerationSeconds",
        ],
      },
    ],
  },
  {
    id: "models",
    label: "Models",
    description: "Modellpfade, Rollenmodelle und Discovery.",
    emptyState: "Aktuell keine Model-Settings registriert.",
    sections: [
      {
        id: "models-storage",
        label: "Model Sources",
        description: "Pfade und Discovery für lokale oder gescannte Modelle.",
        keys: ["modelsPath", "modelDiscoveryMode", "enableModelLabRuntimeBridge"],
      },
      {
        id: "models-role-defaults",
        label: "Role Defaults",
        description: "Standardmodelle für Chat, Coding, Review, Planung und Vision.",
        keys: [
          "defaultChatModelId",
          "defaultCoderModelId",
          "defaultReviewerModelId",
          "defaultPlannerModelId",
          "defaultDebugModelId",
          "defaultVisionModelId",
        ],
      },
    ],
  },
  {
    id: "fleet_routing",
    label: "Fleet Routing",
    description: "Routing-Modi, Cloud-Fallback und Orchestrator-Zuordnung.",
    emptyState: "Aktuell keine Fleet-Routing-Settings registriert.",
    sections: [
      {
        id: "fleet-routing-models",
        label: "Routing Models",
        description: "Modelle für Utility-, Orchestrator- und Workflow-Routing.",
        keys: [
          "defaultUtilityModelId",
          "defaultOrchestratorModelId",
          "defaultWorkflowRoutingModelId",
          "defaultDocumentationModelId",
        ],
      },
      {
        id: "fleet-routing-policy",
        label: "Routing Policy",
        description: "Priorisierung lokaler Modelle, Cloud-Zulassung und Shadow-Checks.",
        keys: [
          "cloudModelsEnabled",
          "preferLocalModels",
          "localOnlyModels",
          "runtimeChatUseBroker",
          "runtimeChatEnableSlotValidation",
          "runtimeChatEnableStrictFallback",
          "runtimeChatShadowMode",
          "runtimeChatStopOnShadowMismatch",
          "runtimeChatCanaryPercent",
          "conversationControlV2",
        ],
      },
    ],
  },
  {
    id: "rag",
    label: "RAG",
    description: "Kontextaufbereitung, Retrieval und lokale Embedding-/Reranking-Modelle.",
    emptyState: "Aktuell keine RAG-Settings registriert.",
    sections: [
      {
        id: "rag-models",
        label: "Retrieval Models",
        description: "Lokale ONNX-Modelle für Embeddings und Reranking.",
        keys: ["defaultEmbeddingModelId", "defaultRerankerModelId"],
      },
      {
        id: "rag-pipeline",
        label: "Retrieval Pipeline",
        description: "Kontext-Spooler, Retrieval-Modi und Token-Budget-Reserven.",
        keys: [
          "contextSpoolerEnabled",
          "ragEnabled",
          "hybridRetrievalEnabled",
          "reasoningTraceEnabled",
          "tokenBudgetOutputReserveRatio",
          "tokenBudgetToolReserveRatio",
          "tokenBudgetSafetyReserveRatio",
        ],
      },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    description: "Grenzen und Verhalten autonomer Sessions.",
    emptyState: "Aktuell keine Agent-Settings registriert.",
    sections: [
      {
        id: "agents-runtime",
        label: "Autonomous Sessions",
        description: "Limits und Retry-Verhalten für Agent-Ausführung.",
        keys: [
          "agentExecutionEnabled",
          "maxAgentRuntimeSeconds",
          "maxAutonomousSteps",
          "maxDebugRetries",
          "maxFailedTaskRetries",
          "runtimeChatEnableAgentTurnLoop",
        ],
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    description: "Tool-Interaktion und Command-Schutzmechanismen.",
    emptyState: "Aktuell gibt es nur einen echten Tool-bezogenen Schalter.",
    sections: [
      {
        id: "tools-commands",
        label: "Commands",
        description: "Schutz vor riskanten Tool- oder Command-Ausführungen.",
        keys: ["safeCommandConfirmation"],
      },
    ],
  },
  {
    id: "security",
    label: "Security",
    description: "Sicherheitsgrenzen, Secrets und lokale Ausführung.",
    emptyState: "Aktuell keine Security-Settings registriert.",
    sections: [
      {
        id: "security-policy",
        label: "Execution Policy",
        description: "Lokale-only-, Safe-Mode- und Telemetry-Regeln.",
        keys: ["localOnly", "safeMode", "telemetryEnabled"],
      },
      {
        id: "security-secrets",
        label: "Provider Secrets",
        description: "Optionale API-Key-Overrides gegenüber Umgebungsvariablen.",
        keys: ["openaiApiKey", "anthropicApiKey"],
      },
    ],
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    description: "Speicherorte, Backup-Status und Diagnose-Flags.",
    emptyState: "Diagnoseansichten stehen auch ohne registrierte Felder bereit.",
    sections: [
      {
        id: "diagnostics-flags",
        label: "Diagnostic Flags",
        description: "Persistenz der Routing-Diagnose und Altlasten.",
        keys: ["runtimeChatEnableDiagnostics", "legacyStructuredMarkupParser", "ollamaBaseUrl"],
      },
    ],
  },
  {
    id: "updates",
    label: "Updates",
    description: "Für Updates gibt es derzeit keine echten, registrierten Settings.",
    emptyState: "Keine realen Update-Settings vorhanden – daher keine Felder angezeigt.",
    sections: [],
  },
];

const KEY_TO_DISPLAY_CATEGORY = new Map<keyof AppSettings, SettingsDisplayCategory>();

for (const category of CATEGORY_DEFINITIONS) {
  for (const section of category.sections) {
    for (const key of section.keys) {
      KEY_TO_DISPLAY_CATEGORY.set(key, category.id);
    }
  }
}

export const SETTINGS_DISPLAY_CATEGORIES = CATEGORY_DEFINITIONS;

export function getDisplayCategoryDefinition(
  category: SettingsDisplayCategory,
): SettingsDisplayCategoryDefinition {
  return (
    CATEGORY_DEFINITIONS.find((entry) => entry.id === category) ?? CATEGORY_DEFINITIONS[0]
  );
}

export function getDisplayCategoryForSetting(
  key: keyof AppSettings,
): SettingsDisplayCategory {
  return KEY_TO_DISPLAY_CATEGORY.get(key) ?? "general";
}

export function getDisplaySectionsForCategory(category: SettingsDisplayCategory): Array<{
  id: string;
  label: string;
  description: string;
  entries: SettingDefinition[];
}> {
  return getDisplayCategoryDefinition(category).sections
    .map((section) => ({
      ...section,
      entries: section.keys
        .map((key) => getSettingDefinition(key))
        .filter((entry): entry is SettingDefinition => Boolean(entry)),
    }))
    .filter((section) => section.entries.length > 0);
}

export function getDisplayCategoryMatchCount(
  category: SettingsDisplayCategory,
  filter?: ReadonlySet<string>,
): number {
  return getDisplaySectionsForCategory(category).reduce((count, section) => {
    return (
      count +
      section.entries.filter((entry) =>
        filter ? filter.has(String(entry.key)) : true,
      ).length
    );
  }, 0);
}

export function getDisplayCategoryKeys(
  category: SettingsDisplayCategory,
): Array<keyof AppSettings> {
  return getDisplaySectionsForCategory(category).flatMap((section) =>
    section.entries.map((entry) => entry.key),
  );
}

export function getUnassignedSettingKeys(): string[] {
  return SETTINGS_REGISTRY.filter((entry) => !KEY_TO_DISPLAY_CATEGORY.has(entry.key)).map((entry) =>
    String(entry.key),
  );
}
