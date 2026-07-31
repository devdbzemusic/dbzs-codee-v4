/**
 * Assess hardware fit for a bound role model before launch.
 * Never silently swaps models — high/unsupported requires an explicit user choice.
 */

export type ResourceRiskLevel = "low" | "medium" | "high" | "unsupported";

export interface RuntimeResourcePlanView {
  modelSizeBytes: number;
  estimatedVramBytes: number;
  estimatedRamBytes: number;
  contextLength: number;
  gpuLayers: number;
  cpuOffloadLayers: number;
  slotId: string;
  availableVramBytes: number | null;
  safetyReserveBytes: number;
  warnings: string[];
  risk: ResourceRiskLevel;
  reasons: string[];
}

export interface ResourcePlanPreviewLike {
  model_id?: string;
  slot_id?: string;
  context_size?: number;
  gpu_layers?: number;
  estimated_model_bytes?: number;
  estimated_total_vram_bytes?: number;
  available_vram_bytes?: number | null;
  safety_reserve_bytes?: number;
  warnings?: string[];
  hardware_mode?: string;
}

export function assessResourcePlanRisk(plan: ResourcePlanPreviewLike | null | undefined): {
  risk: ResourceRiskLevel;
  reasons: string[];
  view: RuntimeResourcePlanView | null;
} {
  if (!plan) {
    return { risk: "medium", reasons: ["resource_plan_unavailable"], view: null };
  }

  const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
  const estimatedVram = Math.max(0, Number(plan.estimated_total_vram_bytes ?? 0));
  const available = plan.available_vram_bytes == null ? null : Math.max(0, Number(plan.available_vram_bytes));
  const safety = Math.max(0, Number(plan.safety_reserve_bytes ?? 0));
  const gpuLayers = Math.max(0, Number(plan.gpu_layers ?? 0));
  const modelBytes = Math.max(0, Number(plan.estimated_model_bytes ?? 0));
  const reasons: string[] = [];

  let risk: ResourceRiskLevel = "low";

  if (warnings.includes("estimated_vram_exceeds_safety_reserve")) {
    reasons.push("estimated_vram_exceeds_safety_reserve");
    risk = "high";
  }
  if (available != null && estimatedVram > available) {
    reasons.push("estimated_vram_exceeds_available");
    risk = "unsupported";
  } else if (available != null && available > 0) {
    const usable = Math.max(1, available - safety);
    const ratio = estimatedVram / usable;
    if (ratio >= 1) {
      reasons.push(`vram_ratio_${ratio.toFixed(2)}`);
      risk = "unsupported";
    } else if (ratio >= 0.85) {
      reasons.push(`vram_ratio_${ratio.toFixed(2)}`);
      risk = "high";
    } else if (ratio >= 0.7) {
      reasons.push(`vram_ratio_${ratio.toFixed(2)}`);
      if (risk === "low") risk = "medium";
    }
  }

  if (warnings.includes("no_gpu_detected_forced_cpu") && modelBytes >= 4_000_000_000) {
    reasons.push("large_model_on_cpu");
    if (risk === "low") risk = "medium";
    if (risk === "medium" && modelBytes >= 7_000_000_000) risk = "high";
  }

  // ~8B+ on 4GB: elevate at most to medium unless VRAM ratio already says high/unsupported.
  if (
    available != null &&
    available > 0 &&
    available <= 4.5 * 1024 * 1024 * 1024 &&
    modelBytes >= 4_000_000_000 &&
    risk === "low"
  ) {
    reasons.push("large_model_on_4gb_class_vram");
    risk = "medium";
  }

  const estimatedModelLayers = 32;
  const cpuOffloadLayers =
    gpuLayers > 0 ? Math.max(0, estimatedModelLayers - gpuLayers) : 0;

  const view: RuntimeResourcePlanView = {
    modelSizeBytes: modelBytes,
    estimatedVramBytes: estimatedVram,
    estimatedRamBytes: Math.max(0, modelBytes - estimatedVram),
    contextLength: Math.max(0, Number(plan.context_size ?? 0)),
    gpuLayers,
    cpuOffloadLayers,
    slotId: String(plan.slot_id ?? ""),
    availableVramBytes: available,
    safetyReserveBytes: safety,
    warnings,
    risk,
    reasons
  };

  return { risk, reasons, view };
}

export function buildResourceRiskQuestion(input: {
  roleLabel: string;
  modelName: string;
  slotId: string;
  risk: ResourceRiskLevel;
  reasons: string[];
  residentModelName?: string | null;
}): import("@dbzs/shared").AssistantQuestion {
  const reasonText = input.reasons.length ? ` (${input.reasons.slice(0, 3).join(", ")})` : "";
  const riskLabel = input.risk === "unsupported" ? "nicht passend" : "grenzwertig";
  const alternativeModelLabel = input.residentModelName
    ? `bereits geladenes Modell nutzen (${input.residentModelName})`
    : `anderes Rollenmodell fuer Slot ${input.slotId} auswaehlen`;
  const context = [
    `Betroffener Slot: ${input.slotId}`,
    `Konfiguriertes Modell: ${input.modelName}`,
    `Ressourcenbewertung: ${input.risk}${reasonText}`,
    `Kurzbewertung: ${riskLabel}`,
    `Empfehlung: ${alternativeModelLabel}`,
    "Kein automatischer Modellwechsel."
  ].join(" · ");
  const options: import("@dbzs/shared").AssistantQuestionOption[] = [
    {
      id: "smaller_profile",
      label: "A – Hybrid CPU/GPU (weniger GPU-Layers)",
      description: `Startet ${input.modelName} im Slot ${input.slotId} mit weniger GPU-Last.`,
      recommended: !input.residentModelName
    },
    {
      id: "cpu_safe_profile",
      label: "B – reines CPU-Profil (cpu_safe)",
      description: `Startet ${input.modelName} im Slot ${input.slotId} ohne GPU-Layers. Langsamer, aber stabiler.`
    },
    {
      id: "choose_other_model",
      label: `C – ${alternativeModelLabel}`,
      description: input.residentModelName
        ? `Empfehlung: Statt ${input.modelName} das bereits laufende Modell im Slot ${input.slotId} nutzen.`
        : `Oeffnet die Rollenmodell-Auswahl fuer Slot ${input.slotId}; kein stiller Modellwechsel.`
    },
    { id: "abort_start", label: "D – abbrechen" }
  ];
  if (input.residentModelName) {
    options.unshift({
      id: "continue_with_resident",
      label: `A – anderes Modell nutzen: ${input.residentModelName}`,
      description: `Verwendet das bereits geladene Modell im Slot ${input.slotId} statt ${input.modelName}.`,
      recommended: true,
      value: `Mit bereits geladenem Modell im Slot ${input.slotId} fortfahren: ${input.residentModelName}.`
    });
    options[1] = {
      id: "smaller_profile",
      label: "B – Hybrid CPU/GPU (weniger GPU-Layers)",
      description: `Startet ${input.modelName} im Slot ${input.slotId} mit weniger GPU-Last.`
    };
    options[2] = {
      id: "cpu_safe_profile",
      label: "C – reines CPU-Profil (cpu_safe)",
      description: `Startet ${input.modelName} im Slot ${input.slotId} ohne GPU-Layers. Langsamer, aber stabiler.`
    };
    options[3] = {
      id: "choose_other_model",
      label: `D – anderes Rollenmodell fuer Slot ${input.slotId} auswaehlen`,
      description: "Kein stiller Wechsel; du entscheidest explizit in den Settings."
    };
    options[4] = { id: "abort_start", label: "E – abbrechen" };
  }
  return {
    id: `q-resource-risk-${Date.now().toString(36)}`,
    questionType: "single_choice",
    prompt: `Das konfigurierte ${input.roleLabel}-Modell ist fuer Slot ${input.slotId} ${riskLabel}: ${input.modelName}.`,
    context,
    options,
    defaultOptionId: input.residentModelName ? "continue_with_resident" : "smaller_profile",
    riskLevel: input.risk === "unsupported" ? "high" : "medium",
    toolCallId: "resource-risk-policy",
    requiredField: "resource_risk_decision"
  };
}

export function requiresExplicitResourceRiskDecision(risk: ResourceRiskLevel): boolean {
  return risk === "high" || risk === "unsupported";
}

const acceptedResourceRiskKeys = new Set<string>();

export function resourceRiskAcceptanceKey(slotId: string, modelId: string): string {
  return `${slotId}::${modelId}`;
}

export function hasAcceptedResourceRisk(slotId: string, modelId: string): boolean {
  return acceptedResourceRiskKeys.has(resourceRiskAcceptanceKey(slotId, modelId));
}

export function markResourceRiskAccepted(slotId: string, modelId: string): void {
  acceptedResourceRiskKeys.add(resourceRiskAcceptanceKey(slotId, modelId));
}

export function resetResourceRiskAcceptanceForTests(): void {
  acceptedResourceRiskKeys.clear();
}
