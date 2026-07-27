# Model Runtime Strategy and E2E Workflows

## Ziel
Eine produktionsreife, reversible Strategie fuer:
- Model-Nutzung je Aufgabentyp
- Model-Laden und Queue-Verhalten
- Tool- und Policy-Gates
- verifizierbare E2E-Workflows als Release-Gates

## Leitprinzipien
1. Reversibel per Feature-Flags, kein Big-Bang.
2. Deterministische Routing-Entscheidung pro Run.
3. Toolzugriff immer policy-gesteuert (least privilege).
4. Klare Fehlermodi statt stiller Fallbacks.
5. Canary + Shadow als Pflicht vor Full Rollout.

## Architektur-Bausteine
- **ModelRouter**: mappt Task-Typ auf Modellprofil.
- **LoadManager**: prewarm, queue, concurrency, cold-start handling.
- **PolicyEngine**: erlaubt/verbietet Tools, Dateisystem, Terminal.
- **ExecutionSupervisor**: timeout/retry/abort/circuit-breaker.
- **Diagnostics Spine**: begruendet Routing- und Policy-Entscheidungen.

## Modellstrategie (v1)
| Task-Typ | Primarmodell | Sekundaer/Fallback | Tools standard | Timeouts (Richtwert) |
|---|---|---|---|---|
| Planner/Architektur | reasoning-heavy | coding-strong | aus | FT 8s / total 90s |
| Coder/Implementierung | coding-strong | reasoning-heavy | an (policy-gated) | FT 6s / total 120s |
| Debug/Incident | reasoning-heavy | coding-strong | an (logs/read zuerst) | FT 8s / total 120s |
| Quick QA/UI | fast-small | coding-strong | aus | FT 3s / total 30s |
| Long context Synthesis | long-context | reasoning-heavy | aus | FT 10s / total 180s |

### Fallback-Regeln
1. Primary Fehler (5xx/timeout/hard reject) -> Secondary einmalig versuchen.
2. Bei erneutem Hard-Fail: kontrollierter Abbruch mit actionable Hinweis.
3. Keine endlosen Retries, kein "still success"-Fake.

## Lade- und Queue-Strategie
- Prewarm fuer Kernprofile: planner, coder, fast-small.
- Queue-Prioritaet: interactive > debugging > batch.
- Concurrency-Limits je Modellklasse (konfigurierbar).
- Circuit-Breaker bei gehauften 5xx/timeout Ereignissen.
- Abort priorisiert und idempotent durch den gesamten Turn propagieren.

## Policy- und Tool-Matrix
| Modus | Dateisystem | Tools | Terminal | Approval |
|---|---|---|---|---|
| ReadOnly | read/search im workspaceRoot | read-only tools | aus | nicht notwendig |
| DevSafe | + write innerhalb workspaceRoot | patch/write tools erlaubt | allowlist-only | write + terminal mit approval |
| FullDev | wie DevSafe | alle freigegebenen Runtime-Tools | allowlist + denylist | approval fuer kritische Aktionen |

## Dateisystem-Guardrails (Pflicht)
1. Harte `workspaceRoot`-Grenze.
2. Path-Normalisierung vor jeder Tool-Ausfuehrung.
3. Traversal/outside-root immer deny.
4. Jede denied/approved Aktion wird auditierbar geloggt.

## Rollout-Steuerung (reversibel)
Bestehende Flags:
- `runtimeChatUseBroker`
- `runtimeChatShadowMode`
- `runtimeChatCanaryPercent`
- `runtimeChatStopOnShadowMismatch`
- `runtimeChatEnableDiagnostics`
- `runtimeChatEnableSlotValidation`
- `runtimeChatEnableStrictFallback`
- `runtimeChatEnableAgentTurnLoop`

Rollout-Stufen: `0 -> 5 -> 25 -> 50 -> 100` mit Shadow-Vergleich.

## E2E-Workflows (Release-Gates)
### WF-1 Plan -> Code -> Patch
- Input: Feature/Refactor Prompt.
- Erwartung: konsistenter Plan, korrekte Dateiaenderung, nachvollziehbarer Patch.
- Gate: keine policy-Verletzung, Ergebnis kompilierbar/testbar.

### WF-2 Runtime Tooling Stabil
- Input: Job mit Toolnutzung (claim/run once).
- Erwartung: kein HTTP 400/500 Loop, strukturierter Tool-Output.
- Gate: >=95% erfolgreiche Tool-Laeufe in Testserie.

### WF-3 Filesystem Security
- Input: read/write inside-root + outside-root Versuch.
- Erwartung: inside-root erlaubt (wenn Policy passt), outside-root deny.
- Gate: 0 Policy-Escapes, audit logs vollstaendig.

### WF-4 Fallback/Resilience
- Input: simuliertes Primary-Fail.
- Erwartung: deterministischer Secondary-Fallback, keine Endlosschleife.
- Gate: Fallback-Pfad reproduzierbar, klare Fehlerklassifikation.

### WF-5 Canary/Shadow
- Input: Traffic je Stage 0/5/25/50/100.
- Erwartung: korrekte stage-tags, Shadow-Mismatch sichtbar.
- Gate: bei aktivem Stop-Gate sofortiger Stopp bei Mismatch.

### WF-6 Queue/Lasttest
- Input: 50+ Jobs mit gemischten Task-Typen.
- Erwartung: keine passive Queue, keine Zombie-Runs.
- Gate: SLA-Metriken in Zielkorridor, stabile Throughput-Kurve.

## Abnahmekriterien fuer "Production Ready (local)"
- E2E Erfolgsrate >= 95%.
- Keine unklassifizierten Runtime/Tool-Fehler.
- Keine Policy-Escapes.
- P95 First-Token und Total-Latenz je Workflow im Zielkorridor.
- Rollback ueber Flags in <5 Minuten moeglich.

## Implementierung in 4 Iterationen
1. **I1 - Orchestrierung**: ModelRouter + PolicyEngine + Diagnostikfelder.
2. **I2 - Runtime Stability**: LoadManager + Retry/Timeout/Circuit-Breaker.
3. **I3 - E2E Automation**: Workflows als reproduzierbare Testlaeufe.
4. **I4 - Rollout**: Canary/Shadow mit Stop-Kriterien und Go/No-Go.

## Verknuepfte Runbooks
- `docs/RUNTIMECHAT_CANARY_RUNBOOK.md`
- `docs/RUNTIMECHAT_LIVE_CANARY_CHECKLIST.md`
- `docs/RUNTIMECHAT_HANDOVER_TODO.md`
