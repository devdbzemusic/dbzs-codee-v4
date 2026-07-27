# DBZS Codee - Aktuelle Aufgaben

Dieses Dokument listet die priorisierten Aufgaben zur Stabilisierung und Weiterentwicklung der Anwendung. Es basiert auf der `DBZS_CODEE_V4_POST_REPAIR_ANALYSIS.md`.

## P0: Kernfunktionalität reparieren (Definition of Done)

Der Task ist erst abgeschlossen, wenn alle folgenden Punkte erfüllt sind. (Stand: 27. Juli 2026)

- [x] **Direct-Tool-Routing:** Deterministische Workspace-Aufgaben (`Zähle alle gguf...`) benötigen kein LLM.
  - [x] Die GGUF-Zählung funktioniert direkt und exakt.
  - [x] Es erscheint keine zweckfremde Planner-Frage.

- [x] **Eindeutige Runtime-Route:** Slot, Profil und Modell stammen aus genau einem `ResolvedRuntimeRoute`-Objekt.
  - [x] Routing-Widersprüche (`reason` vs. `resolved`) werden erkannt und führen zu einem Fehler.

- [x] **Warm-up-Diagnose & Modellkompatibilität:**
  - [ ] Das Modell `Qwen3.5` liefert im isolierten Test eine verwertbare Antwort. (Noch ausstehend)
  - [x] Warm-up-Diagnosen enthalten die Rohantwort und den gewählten Parser-Pfad.
  - [x] Reasoning-, Tool- und Streaming-Ausgaben werden im Warm-up korrekt als Erfolg erkannt.

- [x] **Residenter Fallback:** Ein residentes, kompatibles Modell wird automatisch als Fallback verwendet, wenn das primäre Rollenmodell scheitert.

- [x] **Konsistenter Backend-Status:** Der UI-Header zeigt ausschließlich ehrliche Readiness-Zustände an (`startet`, `online`, `beeinträchtigt`, `Fehler`).

- [x] **Tests:** Alle relevanten TypeScript- und Python-Tests sind grün. (Neue Tests für refaktorierte Komponenten sind grün; 15 alte `RuntimeService`-Tests noch offen)

- [ ] **E2E-Test:** Ein Electron-E2E-Test bestätigt den vollständigen 17-Phasen-Boot.

## P1: Weitere Verbesserungen (nach P0)

Diese Punkte sollten erst nach Abschluss der P0-Aufgaben angegangen werden. (Stand: 27. Juli 2026)

- [x] **Modell-Index-Cache:** Einen persistenten Cache für den Modell-Index implementieren, um die Startzeit zu verkürzen.

- [x] **Pfad-Validierung:** Echte Modellpfade und Runtime-Executables vor dem Start prüfen.

- [x] **Safe Mode:** Den Safe Mode auch bei Fehlern im `filesystem-check` wirksam machen.

- [ ] **Test-Reparatur:** Die 15 bestehenden `RuntimeService`-Testfehler reparieren.

- [ ] **Protokollvertrag:** Einen gemeinsamen Zod-/Pydantic-Protokollvertrag für die API-Kommunikation herstellen.

## Aktuell verifizierter Review-Status

- [x] Der frühere `full_repository`-Bug mit versehentlich gesetzten `selectedPaths` ist im aktuellen `main` bereits behoben.
- [x] Der zielgerichtete Repository-Review-Vitest-Lauf ist grün.
- [x] Die praktische End-to-End-Verifikation des Review-Flows gegen `test-fixtures/coding-capability-project` wurde erneut ausgeführt; `review-plan.json`, `REVIEW_REPORT.md` und `findings.json` wurden erzeugt.
- [ ] Der Offline-Review-Pfad sollte `.codee`-Artefakte aus dem Inventory ausschließen, weil der Fixture-Lauf aktuell alte Review-Zustände und Reports mit in neue Batches zieht.

## P2: Zukünftige Erweiterungen

- [ ] **Interaktiver Trajectory-Visualizer:** Eine dedizierte UI zur Analyse von Agenten-Abläufen.

- [ ] **Workflow-Editor:** Eine grafische Oberfläche zur Konfiguration von Agenten-Ketten und Routing-Regeln.

- [ ] **Erweitertes Modell-Management:** UI zur Konfiguration von Kompatibilitätsprofilen, GPU-Layer-Benchmarks und VRAM-Budgets.

- [ ] **Kontext-Inspektor:** Eine UI zur Anzeige des finalen, an das Modell gesendeten Prompts.
