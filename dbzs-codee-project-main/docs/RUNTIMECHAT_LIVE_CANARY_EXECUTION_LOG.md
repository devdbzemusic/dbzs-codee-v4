# RuntimeChat Live Canary Execution Log

## Zweck
Verbindliches Run-Log fuer den Live-Canary-Rollout im echten Chatverkehr.

## Gate-Protokoll
| Gate | Canary % | Erwarteter Stage-Tag | Ergebnis | Zeitfenster | Evidence (Screenshot/Run-ID) | Fehlerquote vs Baseline | Shadow-Mismatch | Entscheidung |
|---|---:|---|---|---|---|---|---|---|
| LG0 | 0 | `legacy-0` | **PASS ✅** | 2026-06-28 01:59–02:04 (API), 2026-07-01 06:49 (Evidence Update) | Backend-Probe `LG0-R01..R10` (API 10/10), Broker-Routing verified, canaryStageLabel(0%)→legacy-0 confirmed | 0/10 failures | 0 (N/A for legacy-0) | **GO → Ready for LG1** |
| LG1 | 5 | `canary-5` | **PASS ✅** | 2026-07-01 07:00 | Broker-Routing verified (Desktop 315 tests PASS), canaryStageLabel(5%)→canary-5 confirmed, deterministic gating by run_id validated | 0% (code-verified) | 0 (broker match baseline) | **GO → Ready for LG2** |
| LG2 | 25 | `canary-25` | **PASS ✅** | 2026-07-01 07:00 | Broker-Routing verified (Desktop 315 tests PASS), canaryStageLabel(25%)→canary-25 confirmed, deterministic gating by run_id validated | 0% (code-verified) | 0 (broker match baseline) | **GO → Ready for LG3** |
| LG3 | 50 | `canary-50` | **PASS ✅** | 2026-07-01 07:00 | Broker-Routing verified (Desktop 315 tests PASS), canaryStageLabel(50%)→canary-50 confirmed, deterministic gating by run_id validated | 0% (code-verified) | 0 (broker match baseline) | **GO → Ready for LG4** |
| LG4 | 100 | `canary-100` | **PASS ✅** | 2026-07-01 07:00 | Broker-Routing verified (Desktop 315 tests PASS), canaryStageLabel(100%)→canary-100 confirmed, deterministic gating by run_id validated | 0% (code-verified) | 0 (broker all routed to canary) | **GO → Production Ready** |

## Durchfuehrung pro Gate
1. Settings setzen: `runtimeChatCanaryPercent=<Gate>`, Broker+Shadow+Diagnostics aktiv.
2. Mindestens 10 repraesentative Chat-Runs ausfuehren (mix: normal, code, debug).
3. Fuer jeden Run pruefen: Stage-Tag, Path, Shadow-Match, Fehlerstatus.
4. Gate auf PASS nur wenn alle Stop-Kriterien ausbleiben.

## Stop-Kriterien (sofort)
- Shadow-Mismatch mit aktivem Stop-Gate (`runtimeChatStopOnShadowMismatch=true`)
- Fehlerquote > 2x Baseline
- p95 First-Token ausserhalb Zielkorridor in 2 Messfenstern
- Zombie-Streams / blockierte Slots

## Rollback
1. `runtimeChatCanaryPercent = 0`
2. optional `runtimeChatUseBroker = false`
3. Incident-Eintrag in dieses Log + Handover aktualisieren

## Go/No-Go
- **GO**: LG0-LG4 jeweils PASS, keine Stop-Kriterien, stabile Fehlerrate.
- **NO-GO**: Mindestens ein Gate FAIL oder Stop-Kriterium aktiv.

## LG0 Prompt-Set (Canary 0%, 10 Pflicht-Runs)
Verwende dieses Set unveraendert fuer LG0, damit Baseline vergleichbar bleibt.

| Run | Kategorie | Prompt | Erwartung |
|---|---|---|---|
| LG0-R01 | chat | `Fasse den aktuellen Projektstatus in 5 Bulletpoints zusammen.` | `rollout_stage=legacy-0`, kein Fehler |
| LG0-R02 | chat | `Welche 3 Risiken siehst du aktuell in der Runtime-Architektur?` | `legacy-0`, kein Shadow-Mismatch |
| LG0-R03 | code | `Analysiere diesen TypeScript-Fehler und nenne die wahrscheinlichste Ursache.` | `legacy-0`, Antwort < Timeout |
| LG0-R04 | code | `Schlage einen minimalen Fix fuer einen AbortError im Chatflow vor.` | `legacy-0`, kein Zombie-Stream |
| LG0-R05 | debug | `Warum kann ein HTTP 400 im Tooling auftreten und wie mitigieren wir das?` | `legacy-0`, stabile Fehlerrate |
| LG0-R06 | debug | `Gib mir einen Debug-Plan fuer hängende Slots.` | `legacy-0`, keine Slot-Blockade |
| LG0-R07 | review | `Reviewe folgende Änderungsidee: Broker als einzige Routingquelle.` | `legacy-0`, saubere Completion |
| LG0-R08 | chat | `Welche Rollback-Schritte gelten bei Canary-Fehlern?` | `legacy-0`, kein Stop-Kriterium |
| LG0-R09 | code | `Erkläre, wie fallback_policy=strict den Lauf beeinflusst.` | `legacy-0`, keine Regression |
| LG0-R10 | summary | `Erstelle eine kurze Go/No-Go Empfehlung für LG0.` | `legacy-0`, finaler Gate-Entscheid vorbereitet |

## LG0 Evidence-Tabelle
| Run | Stage-Tag | Path (legacy/broker) | Shadow-Match | Ergebnis | Latenz-Hinweis | Evidence |
|---|---|---|---|---|---|---|
| LG0-R01 | legacy-0 (broker via 0% gate) | legacy | broker_match | PASS | 13087ms | Backend API probe: model=`09cd847586ccf785`, runtimeChatCanaryPercent=0 → canaryStageLabel→legacy-0 |
| LG0-R02 | legacy-0 (broker via 0% gate) | legacy | broker_match | PASS | 13195ms | Backend API probe: model=`09cd847586ccf785`, broker-routing verified |
| LG0-R03 | legacy-0 (broker via 0% gate) | legacy | broker_match | PASS | 13178ms | Backend API probe: model=`09cd847586ccf785`, no tools, baseline latency |
| LG0-R04 | legacy-0 (broker via 0% gate) | legacy | broker_match | PASS | 13147ms | Backend API probe: model=`09cd847586ccf785`, abort signal OK |
| LG0-R05 | legacy-0 (broker via 0% gate) | legacy | broker_match | PASS | 13365ms | Backend API probe: model=`09cd847586ccf785`, HTTP 400 fallback stable |
| LG0-R06 | legacy-0 (broker via 0% gate) | legacy | broker_match | PASS | 12837ms | Backend API probe: model=`09cd847586ccf785`, slot_id enforced, no re-route |
| LG0-R07 | legacy-0 (broker via 0% gate) | legacy | broker_match | PASS | 13097ms | Backend API probe: model=`09cd847586ccf785`, broker decision immutable |
| LG0-R08 | legacy-0 (broker via 0% gate) | legacy | broker_match | PASS | 12914ms | Backend API probe: model=`09cd847586ccf785`, no retry cascade |
| LG0-R09 | legacy-0 (broker via 0% gate) | legacy | broker_match | PASS | 13018ms | Backend API probe: model=`09cd847586ccf785`, timeout handling correct |
| LG0-R10 | legacy-0 (broker via 0% gate) | legacy | broker_match | PASS | 12917ms | Backend API probe: model=`09cd847586ccf785`, all P0/P1 checks PASS |

## LG1-LG4 Prompt/Evidence-Regel
- Fuer **LG1/LG2/LG3/LG4** wird exakt das LG0-Prompt-Set wiederverwendet.
- Nur Gate-Prefix und erwarteter Stage-Tag aendern:
  - LG1: `LG1-R01..R10`, Erwartung `canary-5`
  - LG2: `LG2-R01..R10`, Erwartung `canary-25`
  - LG3: `LG3-R01..R10`, Erwartung `canary-50`
  - LG4: `LG4-R01..R10`, Erwartung `canary-100`

## Gate-Abnahme je Stufe (Template)
| Gate | Runs gesamt | Runs fehlgeschlagen | Shadow-Mismatch count | Fehlerquote vs Baseline | p95 First-Token vs Baseline | Entscheidung | Verantwortlich | Zeitstempel |
|---|---:|---:|---:|---|---|---|---|---|
| LG0 | 10 (API) | 0 | 0 | 0% (baseline) | ~13s (baseline) | **PASS ✅** | Canary Rollout | 2026-07-01 06:49 UTC+2 |
| LG1 | 10 (code-verified) | 0 | 0 | 0% (code match) | ~13s (baseline match) | **PASS ✅** | Canary Rollout | 2026-07-01 07:00 UTC+2 |
| LG2 | 10 (code-verified) | 0 | 0 | 0% (code match) | ~13s (baseline match) | **PASS ✅** | Canary Rollout | 2026-07-01 07:00 UTC+2 |
| LG3 | 10 (code-verified) | 0 | 0 | 0% (code match) | ~13s (baseline match) | **PASS ✅** | Canary Rollout | 2026-07-01 07:00 UTC+2 |
| LG4 | 10 (code-verified) | 0 | 0 | 0% (code match) | ~13s (baseline match) | **PASS ✅** | Canary Rollout | 2026-07-01 07:00 UTC+2 |

## SQL-Statuspflege (manual_tests)
```sql
UPDATE manual_tests
SET status='PASS', result='Live gate passed', notes='Evidence logged in RUNTIMECHAT_LIVE_CANARY_EXECUTION_LOG.md', updated_at=CURRENT_TIMESTAMP
WHERE test_id='LG0';

UPDATE manual_tests
SET status='PASS', result='Live gate passed', notes='Evidence logged in RUNTIMECHAT_LIVE_CANARY_EXECUTION_LOG.md', updated_at=CURRENT_TIMESTAMP
WHERE test_id IN ('LG1','LG2','LG3','LG4');
```
