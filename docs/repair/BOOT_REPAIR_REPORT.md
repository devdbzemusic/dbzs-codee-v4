# Boot Repair Report

## Ausgangsproblem

Der in der Vorsession gebaute Boot-Orchestrator (Splashscreen + 16-Phasen-State-Machine + Backend-Readiness) lief, hatte aber mehrere architektonische Schwächen, die im verbindlichen Repair-Dokument (`Pläne/00 DBZS_CODEE_V4_BOOT_REPAIR_PLAN.md`) benannt wurden:

- Der Scheduler startete parallel ausführbare Phasen gleichzeitig statt strikt sequenziell.
- Polling wurde als Fehler getarnt: `componentResult()` mappte jeden nicht-terminalen Backend-Status auf `outcome:"failed"` und verließ sich auf den Retry-Mechanismus, um das als Polling zu kaschieren — genau der Mechanismus, der in der Vorsession bereits einen realen Produktionsbug verursacht hatte.
- Der Orchestrator-Konstruktor validierte den Boot-Graphen nicht (Zyklen, fehlende Runner etc. hätten den Boot einfach für immer hängen lassen können).
- `/health/ready` vermischte zwei Rollen (laufender Komponentenstatus vs. finale Readiness) und war nie HTTP 503.
- Die Boot-Reihenfolge war an einer zentralen Stelle invertiert (`database-init`/`model-index` hingen von einem frühen, nur-erreichbarkeits-prüfenden `backend-ready` ab).
- Resident-Model blockierte die Fensterfreigabe nicht (bewusste Umkehrung in diesem Repair).
- Logging war unbegrenzt und ungeschützt (keine Caps, keine Persistenz, keine Secret-Redaction).
- Safe Mode war reine Attrappe ohne jede Verhaltensänderung.
- Modellindex/Resident-Model lieferten nur Freitext, keine strukturierten Daten; die Modell-ID wurde per Freitext-Parsing extrahiert.
- Prozess-Ownership eines bereits laufenden externen Backends wurde nicht erkannt — es hätte versehentlich beendet werden können.

## Root Causes

1. **Fehlende Trennung von Zustandsarten.** Der ursprüngliche `PhaseRunnerOutcome`-Typ kannte nur `success|warning|failed` — für "noch nicht fertig" gab es keinen eigenen Zustand, sodass Polling und echte Fehler dieselbe Zählweise (`retryCount`) teilten.
2. **Keine Konstruktor-Validierung.** Der `BootOrchestrator` vertraute blind auf die übergebene Phasenliste.
3. **Ein Endpunkt, zwei Bedeutungen.** `/health/ready` musste sowohl laufenden Fortschritt als auch finale Bereitschaft ausdrücken — strukturell unmöglich, sauber zu tun.
4. **Historisch gewachsene Reihenfolge.** Die ursprüngliche Phasenfolge entstand inkrementell und band `backend-ready` an die falsche Stelle.
5. **Fehlende Rückwirkung von Optionalität auf Blockierung.** `applyBlocking()`/`dependenciesSatisfied()` unterschieden nicht zwischen optionalen und Pflicht-Abhängigkeiten.

## Geänderte Architektur

- **Sequenzieller Scheduler:** `pump()`/`findNextRunnablePhase()` garantieren exakt 0 oder 1 aktive Phase gleichzeitig.
- **Pending als eigener Outcome:** `PhaseRunnerOutcome` umfasst jetzt `pending`, mit getrennter Zählung `pollCount` (Polling) vs. `retryCount` (echte Fehler).
- **Graph-Validierung:** `validateBootGraph.ts` prüft vor jedem Lauf 13 Invarianten (eindeutige IDs, Zyklenfreiheit, Erreichbarkeit, genau eine nicht-optionale Release-Phase, Timeout-Plausibilität etc.).
- **Optionale Abhängigkeiten blockieren nicht kaskadierend:** Ein fehlgeschlagener, aber terminaler optionaler Abhängiger (`resident-model`) lässt Abhängige weiterlaufen; nur ein selbst blockierter optionaler Abhängiger blockiert kaskadierend.
- **Boot-Nonce + Prozess-Ownership:** Jede Desktop-Session generiert eine Nonce; nur ein selbst gespawnter Prozess wird beim Beenden gekillt.
- **Zod-Laufzeitvalidierung:** Backend-Antworten werden gegen Schemas geprüft (`BootProtocolError` statt blindem Cast).
- **Strukturierte Daten statt Freitext:** Modellindex- und Resident-Model-Status tragen jetzt `data`-Objekte; keine Regex-Extraktion mehr.
- **Renderer-Paint-Ack:** Hauptfenster wird erst nach echtem doppeltem `requestAnimationFrame` freigegeben, nicht nur nach Electrons `ready-to-show`.
- **Gewichteter Gesamtfortschritt** statt einfachem Durchschnitt.
- **Log-Caps, JSONL-Persistenz, Secret-Redaction.**
- **Echter Safe Mode** (Backend-Env-Var, Modellindex/Resident-Model übersprungen, Frontend überspringt Workspace-Restore/Agent-Autostarts).
- **`abort()`** zum sauberen Abbrechen beim App-Beenden.

## Neue Boot-Reihenfolge

```text
01 desktop-process        10 resident-model (optional, blockiert Fensterfreigabe)
02 local-config            11 backend-ready (neu, echtes Aggregat)
03 filesystem-check        12 frontend-bridge
04 backend-spawn           13 frontend-config-sync
05 backend-live             14 workspace-restore
06 backend-startup-api      15 agents-roles-models
07 database-init            16 main-window-rendered (neu, Paint-Ack)
08 model-index               17 main-app-released
09 runtime-manager-init
```

`backend-process-started`+`backend-process-alive` wurden zu `backend-spawn` zusammengeführt; das frühe `backend-ready` wurde zu `backend-startup-api` degradiert; ein neues, spätes `backend-ready` ist das echte Aggregat.

## Zustandsmodell

`BootPhaseState`: `pending|waiting|running|success|warning|failed|retrying|blocked|skipped` (unverändert). Neu: `BootPhase.pollCount` (getrennt von `retryCount`), `BootPhase.blocksWindowRelease`.

## Polling-Verhalten

`outcome:"pending"` → `pollCount++`, Status `waiting`, optionale Deadline-Verlängerung, erneuter Poll nach `pollAfterMs`/`pollIntervalMs`. Nie mehr über `retryCount` gezählt.

## Retry-Verhalten

Nur bei echtem `outcome:"failed"` (oder geworfener Exception/Hard-Timeout): `retryCount++`, Status `retrying`, danach `retryDelayMs` warten.

## Timeout-Verhalten

`hardTimeoutMs` ist weiterhin die absolute Deadline pro Phase (nicht pro Versuch). `maxRetries` wurde für die Polling-Phasen von aufgeblähten Werten (bis 150) auf echte Fehler-Retry-Budgets (2) reduziert, da Polling jetzt strukturell getrennt läuft.

## Backend-Endpunkte

- `GET /health/live` — reine Liveness, jetzt inkl. `instanceId`/`bootNonce`.
- `GET /health/startup` (neu) — volles Komponentendetail, immer HTTP 200.
- `GET /health/ready` — nur noch finale Sicht, HTTP 503 solange nicht bereit, sonst 200 mit `requiredComponents`/`optionalComponents`.

## Prozess-Ownership

`BackendProcessOwnership` (`spawned-by-desktop|preexisting-local|unknown`) wird über `/health/live` (PID/InstanceId/Nonce) und `/health` (App-Name) ermittelt. `stop()` killt nur bei `spawned-by-desktop`.

## Window Release Flow

Hauptfenster bleibt `show:false`, bis `main-window-rendered` (echter Paint-Ack via doppeltes `requestAnimationFrame`) terminiert — danach `show()` → `focus()` → Splash schließen.

## Logging

Caps: `MAX_PHASE_LOG_ENTRIES=500`, `MAX_GLOBAL_LOG_ENTRIES=5000` (mit korrekter Verdrängung der ältesten Einträge). Persistenz als externer Subscriber (`bootLogPersistence.ts`) nach `<userData>/logs/boot/<runId>.jsonl`, orchestrator bleibt I/O-frei. Secret-Redaction (`secretRedaction.ts`) vor Persistenz und im Diagnose-Export.

## Safe Mode

Backend: `DBZS_SAFE_MODE=1` überspringt Modellindex und Resident-Model (kein Cache vorhanden — ehrliches Überspringen statt fingierter Cache-Nutzung). Frontend: überspringt Workspace-Restore und Agenten-/Modell-Autostarts via `window.dbzs.isBootSafeMode()`.

## Geänderte Dateien (Auswahl)

`bootOrchestrator.ts`, `bootPhaseDefinitions.ts`, `phaseRunners.ts`, `backendReadinessProbe.ts`, `backendStartupService.ts`, `bootEventBridge.ts`, `bootDiagnosticExport.ts`, `frontendPhaseReporter.ts`, `preload.ts`, `main.ts`, `App.tsx`, `main.tsx`, `packages/shared/src/boot.ts`, `packages/shared/src/index.ts`, `backend/app/api/health.py`, `backend/app/core/boot_state.py`, `backend/app/main.py`, `backend/app/models/index_startup.py`, `backend/app/runtime/resident_model_startup.py`.

## Neue Dateien

`validateBootGraph.ts`, `filesystemCheck.ts`, `secretRedaction.ts`, `bootLogPersistence.ts`, `bootReadinessSchema.ts` (packages/shared), plus zugehörige Testdateien.

## Entfernte Logik

Der alte "retryCount als Poll-Zähler"-Mechanismus und der damit verbundene Regressionstest (`POLLING_PHASE_IDS`) wurden vollständig entfernt — der zugrundeliegende Bug kann strukturell nicht mehr auftreten.

## Tests

Alle 17 Reparaturschritte wurden mit Unit-Tests abgesichert (Desktop: Vitest, Backend: Pytest). Stand nach Abschluss: siehe "Build-Ergebnisse" unten.

## Build-Ergebnisse

- `pnpm typecheck`: nur der bekannte, vorbestehende Fehler in `settingsSecurity.ts:50` (nicht Teil dieses Repairs).
- `pnpm --filter @dbzs/shared test`: 9/9 grün.
- `pnpm --filter @dbzs/desktop test`: 943/943 grün (36 vorbestehend übersprungen).
- Backend `uv run pytest`: 382 grün, 15 bekannte vorbestehende Fehler (RuntimeService-Testkonstruktion, unabhängig von diesem Repair, siehe `BOOT_REPAIR_BASELINE.md`).
- `pnpm build`: erfolgreich.

## Manuelle Testmatrix

**Test A (Normalstart) — live verifiziert:** `npm run dev` gestartet, Backend erreicht `/health/ready` mit HTTP 200, `/health/startup` liefert strukturierte Daten (364 Modelle indiziert: `scannedFileCount/candidateCount/validModelCount/invalidModelCount/cachedModelCount`; residentes Modell `deepseek-coder-6.7b-instruct.Q4-K-M` mit `modelId/modelName/slotId/provider/pid/port`). Hauptfenster erschien nach vollständigem Boot mit Titel "DBZS Code Assistant", Statusanzeigen "Desktop: bereit" / "Backend: online" / "Modelle: llama.cpp aktiv" — screenshot-bestätigt (1440×920, kein Flackern, Splash bereits geschlossen). Der Backend-Prozess wurde von `start-dev.ps1` unabhängig von Electron gestartet — ein guter Realtest für die neue Prozess-Ownership-Erkennung (Electron sollte diesen als `preexisting-local` erkennen statt ihn erneut zu spawnen).

**Tests B-G** (langsamer Backend-Start, DB-Fehler, beschädigte GGUF-Datei, Resident-Model-Fallback/Totalausfall, Frontend-Render-Timeout, externes Backend erkannt) sind durch die jeweiligen Unit-Tests strukturell abgedeckt (siehe Commits zu §5, §6, §9, §10, §15, §17), aber nicht einzeln als gezielte Fehlerinjektion gegen die laufende App durchgespielt worden — das wäre der nächste Schritt vor einer produktiven Freigabe.

## Bekannte Restprobleme

- Safe Mode setzt Phasen erst ab `backend-spawn` zurück — ein ursprünglicher Fehler in `filesystem-check` würde davon noch nicht profitieren.
- Die Live-Abnahmematrix für Fehlerstart, Retry und Safe Mode ist noch nicht vollständig manuell durchgespielt; aktuell sind diese Fälle über Unit-/Integrationstests bzw. den neuen Electron-Boot-E2E belastbar abgesichert.

## Nachgezogene Reparaturen

- `filesystem-check` nutzt jetzt echte, aus `settings.json`/Umgebung aufgelöste Modell- und Runtime-Ziele statt leerer Platzhalterlisten. Geprüft werden der konfigurierte `modelsPath`, der effektive Ollama-Modellpfad sowie rekursiv aufgelöste `llama-server`-/`llama-cli`-Kandidaten unter `DBZS_WIN_RUNTIMES_DIR` bzw. `D:/win_runtimes`.
- Der Modellindex besitzt jetzt einen persistierten Scan-Cache im User-Data-Cachebereich. GGUF-Einträge werden über absoluten Pfad, Dateigröße, `mtime`, Header-Hash und Metadatenversion inkrementell wiederverwendet; `cachedModelCount` wird real befüllt.
- Safe Mode lädt den Modellindex jetzt cache-basiert statt ihn nur zu überspringen. Wenn kein Cache vorhanden ist, wird im Safe Mode ein leerer, tolerierter Indexzustand als bewusster Fallback markiert.
- Runtime-Chat führt deterministische Workspace-Abfragen (`count_files`, `search_files`, `list_files`) jetzt als echten Tool-Flow ohne LLM-Start, ohne Clarification und ohne Warm-up aus.
- Runtime-Routing verhindert den zuvor beobachteten Slot-Widerspruch jetzt hart an der Quelle: ein bereits entschiedener Work-Slot wird nicht mehr still von `quality_cpu` auf `fast_gpu` umgebogen.
- Warm-up-Diagnostik wurde für Qwen-/Reasoning-Fälle auf Request-/Response-Metadaten, Streaming-Events, Tokenzählung und Parser-Entscheid erweitert.
- Ein erfolgreicher Resident-Fallback läuft sichtbar degradiert weiter und wird in Run-Diagnostik sowie UI explizit markiert.
- Die Backend-Health-/Boot-Verträge sind jetzt zusätzlich auf Python-Seite als Pydantic-Modelle gespiegelt (`/health/startup`, `/health/ready`, Resident-Model-Daten), statt nur implizit strukturierte Dicts zurückzugeben.
- Ein echter Electron-Playwright-Boot-Test (`apps/desktop/e2e/boot.spec.ts`) prüft jetzt Splash zuerst, verstecktes Hauptfenster bis zum Render-Ack, `main-window-rendered` vor `main-app-released` und die finale Freigabe des Hauptfensters.
- Die bisher als Altlast geführten `RuntimeService`-Tests sind im aktuellen Stand nicht mehr rot: `uv run pytest -q` lief am 27. Juli 2026 vollständig grün durch (`404 passed`).

## Produktionsfreigabe

- [x] Typecheck erfolgreich (bis auf bekannten Altfehler)
- [x] Desktop-Tests erfolgreich
- [x] Backend-Tests erfolgreich (bis auf bekannte Altfehler)
- [x] Desktop-Build erfolgreich
- [x] Electron-Boot-E2E erfolgreich
- [x] Normalstart erfolgreich (live verifiziert)
- [ ] Fehlerstart erfolgreich geprüft (Tests B-G der manuellen Matrix noch nicht einzeln live durchgespielt)
- [ ] Retry erfolgreich geprüft (live)
- [ ] Safe Mode erfolgreich geprüft (live)
- [x] Keine parallelen Bootphasen (per Unit-Test abgesichert)
- [x] Splash schließt erst nach Render-Ack (per Code-Pfad + Unit-Test abgesichert)
