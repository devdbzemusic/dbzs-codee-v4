import type { RuntimeSlotId } from "@dbzs/shared";
import type { ModelSelectionDecision } from "./modelSelectionBroker";

export interface ResolvedRuntimeRoute {
  modelId: string | null;
  modelName: string | null;
  slotId: RuntimeSlotId | null;
  profile: string;
  provider: string;
  reasons: string[];
  source?: string | null;
}

export interface RuntimeRouteValidationResult {
  ok: boolean;
  conflicts?: string[];
}

type BrokerRouteExpectation =
  | {
      resolvedModelId: string;
      resolvedModelName: string;
      slotId: ModelSelectionDecision["slotId"] | null;
    }
  | null;

export function validateResolvedRuntimeRoute(
  route: ResolvedRuntimeRoute,
  brokerDecision: BrokerRouteExpectation
): RuntimeRouteValidationResult {
  if (!brokerDecision) {
    return { ok: true };
  }

  const conflicts: string[] = [];

  if (brokerDecision.slotId && route.slotId && brokerDecision.slotId !== route.slotId) {
    conflicts.push(`Broker wollte Slot '${brokerDecision.slotId}', aber '${route.slotId}' wurde gewählt`);
  }

  if (brokerDecision.resolvedModelId && route.modelId && brokerDecision.resolvedModelId !== route.modelId) {
    conflicts.push(
      `Broker wollte Modell '${brokerDecision.resolvedModelId}', aber '${route.modelId}' wurde gewählt`
    );
  }

  if (conflicts.length > 0) {
    return { ok: false, conflicts };
  }

  return { ok: true };
}
