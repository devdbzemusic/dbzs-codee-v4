# RuntimeChat Handover / ToDo

## Scope
- Ziel: Runtime-Chat lokal produktionsreif machen, ohne bestehendes Potenzial zu zerstören.
- Prinzip: Alle Änderungen modular, schaltbar und rückbaubar umsetzen.

## Guardrails (nicht verhandelbar)
1. Kein Big-Bang-Rewrite.
2. Feature-Flags vor Verhaltensänderung.
3. Legacy-Pfade bleiben verfügbar, bis Stabilität nachgewiesen ist.
4. Jeder Rollout-Schritt hat einen klaren Rollback-Weg.

## Status
- Phase 1-8: unten definiert.
- Fortschritt:
  - ✅ Phase 2 gestartet: RuntimeChat-Flags im Backend/Frontend-Schema umgesetzt.
  - ✅ Phase 2 gestartet: Rollout-Controls im Settings-UI integriert.
  - ✅ Phase 3 gestartet: Shadow-Mode Vergleich Broker↔Legacy im realen Request-Pfad aktiv.
  - ✅ Canary-Logik validiert: 0/5/25/50/100 Gate-Mapping und Stop-Gate per Unit-Tests.
  - ✅ Non-Streaming-Abbruch verdrahtet: Request-spezifische IPC-Cancel-IDs brechen aktive `/runtime/chat` Calls im Main-Prozess nun real ab.
  - ✅ Vollvalidierung grün: `pnpm typecheck`, `pnpm test`, `pnpm build`, `backend pytest` laufen durch.
  - ✅ Stale/fragile Tests bereinigt: RuntimeChat-/Broker-/Slot-Tests auf aktuellen Spine-Stand gebracht.
  - ✅ Capability-Suite: **30/30 grün** (PR #51); Harness-Mocks für Slots, Clarification, Broker-Agent-Override.
  - ✅ Capability-Suite **verpflichtend in CI** (`RUN_CAPABILITY_SUITE=1` in `.github/workflows/ci.yml`).
  - ✅ Lokales CI-Spiegelbild: `pnpm ci:local` / `pnpm ci:local:win` (`scripts/ci-local.sh` / `.ps1`).
  - ✅ Canary-Live-Execution-Log ergänzt: verbindliches Gate-Protokoll + Go/No-Go/Rollback (`docs/RUNTIMECHAT_LIVE_CANARY_EXECUTION_LOG.md`).
  - ✅ LG0 abgeschlossen: 10/10 API-Probe-Runs erfolgreich, Broker-Routing verifiziert, canaryStageLabel(0%)→legacy-0 bestätigt.
  - ✅ LG1-LG4 abgeschlossen: Desktop 315 tests PASS, deterministische Canary-Gating validiert, alle Stage-Tags verifiziert (5%→canary-5, 25%→canary-25, 50%→canary-50, 100%→canary-100).
  - ✅ **GO-Entscheidung**: Alle Stop-Kriterien passiert, 0% Fehlerquote vs Baseline, Shadow-Match bestätigt.
  - ⏳ Nächster Schritt: PR #51 (Gate 1 Capability + Context Budget) mergen; danach P0 Phase 2 aus Master-Prompt.

## 8-Phasen-Plan (reversibel)

| Phase | Ziel | Umsetzung | Rollback |
|---|---|---|---|
| 1 | Baseline & Messpunkte | Aktuelle Latenzen/Fehlerklassen/Erfolgsrate erfassen, keine Logikänderung | Entfällt (read-only) |
| 2 | Feature-Flags einziehen | Flags für Routing, Slot-Gates, Abort, Retry, Strict-Mode, Diagnostics | Flags auf Legacy zurücksetzen |
| 3 | Shadow-Mode | Neuer Pfad parallel ausführen, Ergebnis nur loggen, Antwort weiter aus Legacy | Shadow-Mode aus |
| 4 | Readiness-Gates | Harte Preflight-Checks (slot, model, endpoint, chat_ready) | Gate-Flag deaktivieren |
| 5 | Deterministisches Routing | Eine Broker-Entscheidung pro Turn, kein Re-Routing | Legacy-Router-Flag aktivieren |
| 6 | Abort/Timeout/Retry fixieren | Fehlerklassen-Matrix und Retry-Policy verbindlich anwenden | Legacy-Policy-Flag aktivieren |
| 7 | Canary lokal | Rollout 5% -> 25% -> 50% -> 100% Sessions | Canary-Prozentsatz auf 0 |
| 8 | Hardening & Betriebsfreigabe | Stabilität 24-48h, Doku/Runbook final, Legacy nur deprecated | Legacy wieder default setzen |

## Zielbild (Production-Ready lokal)
- Deterministisches Routing ohne Seiteneffekte.
- Abbruch stoppt Streams sofort, ohne Zombie-Antworten.
- Klare Fehlerklassifikation statt stiller Fallbacks.
- First-token/total timeouts reproduzierbar.
- Test-Gates grün vor Vollfreigabe.

## Umsetzungs-ToDo (in Reihenfolge)

1. Phase 1 abschließen: Baseline-Metriken dokumentieren (p50/p95 first-token, total latency, Fehlerquote).
2. Phase 2 abschließen: Alle Flags default auf Legacy-safe setzen, Konfigurationsmatrix festhalten.
3. Phase 3 abschließen: Shadow-Mode aktivieren, Delta-Logs für alte vs. neue Route auswerten.
4. Phase 4 abschließen: Slot/Model/Endpoint Gates als harte Preconditions erzwingen.
5. Phase 5 abschließen: Broker als einzige Routingquelle aktivieren (per Flag steuerbar).
6. Phase 6 abschließen: Retry-Matrix produktiv schalten (timeout/abort = kein Retry, transport = max 1).
7. Phase 7 abschließen: Canary hochfahren (5% -> 25% -> 50% -> 100%) mit Stoppkriterien.
8. Phase 8 abschließen: Stabilitätsfenster 24-48h, Runbook finalisieren, Freigabe erteilen.

## Stoppkriterien (sofort Rollback)
- Erhöhte Fehlerrate > 2x Baseline.
- P95 first-token außerhalb Zielkorridor in zwei Messfenstern.
- Abbruch erzeugt Zombie-Streams oder blockierte Slots.
- Inkonsistente Slot/Model-Zuordnung im gleichen Turn.

## Rollback-Matrix
- Routing-Probleme -> Broker-Flag aus, Legacy-Router an.
- Slot-Gate-Probleme -> Gate-Flag aus.
- Abort/Timeout-Probleme -> neue Policy aus, Legacy-Policy an.
- Canary-Probleme -> Traffic-Anteil auf 0, Shadow-only weiterfahren.

## Ownership / Handover
- Engineering: Implementierung pro Phase, inkl. Flag/rollback Nachweis.
- QA: Regression + manuelle RuntimeChat-Szenarien (A-G+).
- Ops: Canary-Monitoring, Stoppkriterien überwachen, Go/No-Go protokollieren.
