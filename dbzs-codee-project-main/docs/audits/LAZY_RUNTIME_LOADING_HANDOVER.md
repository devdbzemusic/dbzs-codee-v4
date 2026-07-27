# Lazy Runtime Loading — Handover

Stand: 2026-07-22

## Ziel

Arbeitsmodelle (Chat/Planner/Coder/Review/Vision) starten **nicht** bei App-Start, Workspace-Open, Runtime-Chat-Open, Clear oder Statusabfrage.

Optional resident: FunctionGemma auf `orchestrator_cpu` (`autoStartOrchestratorRuntime`, Default `true`).

## Startreihenfolge

```text
Nachricht → Preflight / ask_user → Broker → Context Budget → On-Demand Slot-Start → Request
```

## Geänderte Defaults

| Setting | Default |
|---------|---------|
| `autoStartChatRuntime` | `false` |
| `autoStartCodingRuntime` | `false` |
| `autoStartVisionRuntime` | `false` |
| `autoStartReviewRuntime` | `false` |
| `autoStartOrchestratorRuntime` | `true` |
| `idleUnloadWorkModelsMinutes` | `10` |
| Bootstrap `autoStartOnBoot` | `false` |

## Wichtige Dateien

- `apps/desktop/src/services/runtimeBootstrap.ts` — Kernel/MCP only; `preloadSelectedRuntime()` manuell
- `apps/desktop/src/services/lazyRuntimePolicy.ts` — UI-Labels, Idle-Unload
- `apps/desktop/src/stores/runtimeChatStore.ts` — On-Demand nach Budget; Race auf Abort/Workspace
- `apps/desktop/src/components/RuntimeChatTab.tsx` — `autoStart={false}`, Status „Arbeitsmodell: nicht geladen“
- Settings UI in `App.tsx` — manueller Vorladen-Button

## Diagnose

Run-Events tragen `startTrigger: "post_budget_ondemand"` inkl. Slot, Modell und Broker-Reasons.
