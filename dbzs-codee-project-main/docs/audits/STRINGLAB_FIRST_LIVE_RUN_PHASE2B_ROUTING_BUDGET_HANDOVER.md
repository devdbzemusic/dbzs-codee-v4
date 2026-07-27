# StringLab First Live Run – Phase 2B / Model Routing + Context Budget

Stand: 2026-07-22
Branch: `fix/stringlab-model-routing-context-budget`
Basis: `main` @ `51eb7e1`

## Ergebnis

- Visionmodelle nur bei `hasImageInput` / `requiresVision` (sonst Fallback Planner→Coder→Chat)
- Feature-Aufgaben routen zuerst auf **planner**
- `stickyTaskType` verhindert `casual_chat` nach Interview-Resume
- Context-Stufe 1 überspringt Struktur-Signale / Broad-RAG / rekursives list_files
- `FinalRequestTokenBudget` blockiert Overflow vor dem Runtime-Call
- Einmaliger Minimal-Planning-Fallback; sonst `outcome=context_overflow` (kein success)

## Kernfiles

- `packages/shared/src/index.ts` — Capabilities, Stage, Budget, Outcome
- `apps/desktop/src/services/modelSelectionBroker.ts`
- `apps/desktop/src/services/contextStagePolicy.ts`
- `apps/desktop/src/services/finalRequestTokenBudget.ts`
- `apps/desktop/src/stores/runtimeChatStore.ts`
- `apps/desktop/src/services/runtimeSlotManager.ts`
- `apps/desktop/src/components/chat/CodeeRunLiveBlock.tsx`

## Checks

- Shared 9/9
- Broker + Phase2B Budget/Stage Tests: 32/32
- Desktop typecheck: grün

## Noch offen

- FunctionGemma Decision Path
- First-Token-SLO Messung
- Live-Reproduktionslauf gegen `dbzssl`
- Scoped Stall-Stop (separater Branch, nicht in main)
