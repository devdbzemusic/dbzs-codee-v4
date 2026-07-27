# RuntimeChat Canary Runbook

## Ziel
Kontrollierter Rollout des RuntimeChat-Pfads mit reversiblen Gates:
`0% -> 5% -> 25% -> 50% -> 100%`.

## Strategie-Referenz
Fuer Modellnutzung, Lade-/Queue-Strategie, Policy-Matrix und E2E-Gates:
- `docs/MODEL_RUNTIME_STRATEGY_AND_E2E.md`
- `docs/RUNTIMECHAT_LIVE_CANARY_EXECUTION_LOG.md`

## Voraussetzungen
- `runtimeChatUseBroker = true`
- `runtimeChatShadowMode = true`
- `runtimeChatEnableDiagnostics = true`
- `runtimeChatEnableSlotValidation = true`
- `runtimeChatEnableStrictFallback = true`

Optional (harter Gate-Stop):
- `runtimeChatStopOnShadowMismatch = true`

## Rollout-Sequenz
1. **Legacy Baseline (0%)**
   - `runtimeChatCanaryPercent = 0`
   - Erwartung: `rollout_stage=legacy-0`
   - Shadow nur beobachten, keine Produktiv-Umschaltung.

2. **Canary 5%**
   - `runtimeChatCanaryPercent = 5`
   - Erwartung: `rollout_stage=canary-5`
   - Prüfen: Shadow-Matches, Fehlerquote, First-Token-Verhalten.

3. **Canary 25%**
   - `runtimeChatCanaryPercent = 25`
   - Erwartung: `rollout_stage=canary-25`

4. **Canary 50%**
   - `runtimeChatCanaryPercent = 50`
   - Erwartung: `rollout_stage=canary-50`

5. **Full 100%**
   - `runtimeChatCanaryPercent = 100`
   - Erwartung: `rollout_stage=canary-100`
   - Shadow mindestens 24h aktiv lassen.

## Stop-Kriterien (sofort)
- Shadow-Mismatch bei aktivem Stop-Gate.
- Fehlerquote > 2x Baseline.
- P95 First-Token dauerhaft außerhalb Zielkorridor.
- Slot-/Model-Inkonsistenz im selben Turn.

## Rollback
- Schnellster Rollback:
  - `runtimeChatCanaryPercent = 0`
  - optional `runtimeChatUseBroker = false`
- Bei Slot-Gate-Problemen:
  - `runtimeChatEnableSlotValidation = false` (nur temporär)
- Bei Richtungsproblemen:
  - `runtimeChatShadowMode = true` beibehalten, aber Broker auf 0% setzen.

## Go/No-Go Entscheidung
- Go nur wenn alle Canary-Stufen ohne Stop-Kriterium durchlaufen wurden
  und keine kritischen Regressionen vorliegen.
- Gate-Entscheidungen und Evidence muessen im Execution Log dokumentiert sein.
