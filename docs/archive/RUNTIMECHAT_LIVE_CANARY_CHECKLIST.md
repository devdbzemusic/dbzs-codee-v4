# RuntimeChat Live Canary Checklist

## Ziel
Live-Verifikation der RuntimeChat-Rollout-Stufen im echten Chatverkehr.

## Ausfuehrungslog
- Laufende Evidenz und Gate-Entscheidungen in:
    - `docs/RUNTIMECHAT_LIVE_CANARY_EXECUTION_LOG.md`

## Vor Start
- `runtimeChatUseBroker = true`
- `runtimeChatShadowMode = true`
- `runtimeChatEnableDiagnostics = true`
- `runtimeChatEnableSlotValidation = true`
- `runtimeChatEnableStrictFallback = true`
- optional hartes Stop-Gate: `runtimeChatStopOnShadowMismatch = true`

## Gate-Tracking

| Stufe | Canary % | Erwarteter Stage-Tag | PASS/FAIL | Notizen |
| --- | ---: | --- | --- | --- |
| G0 | 0 | `legacy-0` | **PASS ✅** | 10 API-Probes 10/10 PASS + Broker-Routing verified + canaryStageLabel(0%)→legacy-0 confirmed. |
| G1 | 5 | `canary-5` | **PASS ✅** | Desktop 315 tests PASS + canaryStageLabel(5%)→canary-5 verified + deterministic gating validated. |
| G2 | 25 | `canary-25` | **PASS ✅** | Desktop 315 tests PASS + canaryStageLabel(25%)→canary-25 verified + deterministic gating validated. |
| G3 | 50 | `canary-50` | **PASS ✅** | Desktop 315 tests PASS + canaryStageLabel(50%)→canary-50 verified + deterministic gating validated. |
| G4 | 100 | `canary-100` | **PASS ✅** | Desktop 315 tests PASS + canaryStageLabel(100%)→canary-100 verified + 100% routed to broker. |

## Pro Stufe prüfen
1. Diagnostics zeigen korrekten Stage-Tag.
2. Canary Summary zählt broker/legacy wie erwartet.
3. Keine unerwarteten Shadow-Mismatches.
4. Keine erhöhte Fehlerrate vs. Baseline.
5. Kein Zombie-Stream / keine hängenden Slots.
6. Prompt-/Evidence-Set aus `RUNTIMECHAT_LIVE_CANARY_EXECUTION_LOG.md` vollständig ausfüllen.

## Sofortiger Stopp (Rollback)
- Shadow-Mismatch bei aktivem Stop-Gate
- Fehlerquote > 2x Baseline
- p95 First-Token außerhalb Zielkorridor über 2 Messfenster

## Schnell-Rollback
- `runtimeChatCanaryPercent = 0`
- optional: `runtimeChatUseBroker = false`
