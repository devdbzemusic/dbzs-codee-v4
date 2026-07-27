# Übergabedokument: DBZS Codee

**Stand:** 27. Juli 2026

Dieses Dokument fasst den aktuellen Entwicklungsstand, die Architektur und die nächsten Schritte für das Projekt `dbzs-codee` zusammen.

## 1. Aktueller Status

Das Projekt befindet sich in einer kritischen Reparatur- und Stabilisierungsphase. Die jüngsten Arbeiten konzentrierten sich auf zwei Hauptbereiche:

1.  **Boot-Repair (Abgeschlossen):** Die Boot-Sequenz der Anwendung wurde von einem unvorhersehbaren, nebenläufigen Prozess zu einem strikt sequenziellen, deterministischen und beobachtbaren 17-Phasen-Ablauf umgebaut. Dies hat die Startzuverlässigkeit erheblich verbessert.

2.  **Routing-Repair (Laufend):** Die Analyse nach dem Boot-Repair (`DBZS_CODEE_V4_POST_REPAIR_ANALYSIS.md`) hat gezeigt, dass die Kernprobleme nun im Bereich des Intent-Routings, der Modell-Aktivierung (Warm-up) und der Zustandssynchronisation liegen. Die laufenden Arbeiten konzentrieren sich auf die Behebung dieser Punkte (siehe `TODO.md`).

**Gesamtzustand:** Die Basis-Architektur ist solide. Die intelligente Steuerung und Fehlerbehandlung im Kern der Anwendung wurde erheblich gehärtet. Der zuvor dokumentierte Repository-Review-Bug ist im gemergten Stand bereits enthalten; offen ist jetzt vor allem die praktische End-to-End-Verifikation des Review-Flows am Fixture.

## 2. Kernarchitektur & Konzepte

### Boot-Orchestrator
Der Start der Anwendung wird durch einen zentralen Orchestrator gesteuert, der eine feste Abfolge von Phasen durchläuft. Dies stellt sicher, dass alle Dienste und Zustände in einer vorhersagbaren Reihenfolge initialisiert werden.

### Model-Routing & Broker
Die Auswahl des zu verwendenden LLM erfolgt durch einen `modelSelectionBroker`. Dieser berücksichtigt den `taskType` (z.B. `coding`, `chat`), die Fähigkeiten der verfügbaren Modelle (z.B. `vision`) und die Hardware-Gegebenheiten.

**Wichtig:** Die vom Broker getroffene Entscheidung (`ResolvedRuntimeRoute`) soll als alleinige Wahrheit für den gesamten Lebenszyklus einer Anfrage dienen.

### Direct Intent Classifier
Für einfache, deterministische Anfragen (z.B. "Zähle alle Dateien") wurde ein "Fast-Path" implementiert. Der `directIntentClassifier` fängt solche Anfragen ab und leitet sie direkt an ein Tool weiter, ohne ein LLM zu involvieren. Dies spart Ressourcen und verbessert die Antwortzeit.

### Residenter Fallback
Fällt das primär ausgewählte Modell beim Start aus (z.B. durch einen Warm-up-Fehler), versucht das System, auf ein bereits laufendes ("residentes"), kompatibles Modell auszuweichen. Dieser `degraded`-Modus erhöht die Ausfallsicherheit. Die Kompatibilität (z.B. Vision-Fähigkeit) wird durch `isResidentModelCompatible` sichergestellt.

### Diagnose-Komponenten
Die Anwendung verfügt über umfangreiche Diagnose-Werkzeuge, die zur Laufzeit Einblick in die Systementscheidungen geben:
- **`RoutingDiagnosticsCard`:** Zeigt die komplette Kette der Routing-Entscheidung an, inklusive Ablehnungsgründe für Fallbacks.
- **`TokenBudgetVisualizer`:** Visualisiert die Token-Nutzung einer Anfrage und warnt vor Kontext-Überläufen.

## 3. Laufende Arbeiten & Nächste Schritte

Die Prioritäten sind klar in der `TODO.md` definiert. Die meisten P0-Tasks sind abgeschlossen.

### Aktueller, unmittelbarer Fokus: Bereinigung des Offline-Repository-Review-Inventars

Der zuvor bekannte Fehler im Repository-Review-Feature wurde im gemergten Stand bereits adressiert:

-   `runtimeChatStore.ts` hängt `selectedPaths` bei `scope: "full_repository"` nicht mehr an den Review-Request.
-   `reviewBatchPlanner.ts` verwendet `selectedPaths` nur noch für `active_file` und `selected_paths`.
-   Ein Regressionstest deckt den Fall `full_repository` plus versehentlich gesetzte `selectedPaths` bereits ab.

Die praktische Bestätigung des Flows gegen das Fixture `test-fixtures/coding-capability-project` lief erfolgreich durch. Dabei wurde aber sichtbar, dass der Offline-Review-Pfad vorhandene `.codee`-Artefakte in das Inventory aufnimmt. Der nächste sinnvolle Schritt ist deshalb die Bereinigung dieses Pfads, damit neue Reviews keine alten Review-Artefakte mitanalysieren.

### Fortschritt bei den P0-Aufgaben (Kernfunktionalität reparieren)

Die meisten der kritischen P0-Aufgaben aus der `TODO.md` wurden bereits erfolgreich implementiert und getestet:

-   **Direct-Tool-Routing:** Implementiert und durch Unit-Tests abgedeckt.
-   **Eindeutige Runtime-Route:** Implementiert und durch Unit-Tests abgedeckt.
-   **Warm-up-Diagnose & Modellkompatibilität:** Detaillierte Warm-up-Diagnose implementiert und in der `RoutingDiagnosticsCard` sichtbar. Schemata für `ModelRuntimeCompatibility` definiert. (Verifizierung für `Qwen3.5` noch ausstehend).
-   **Residenter Fallback:** Implementiert und durch Unit-Tests abgedeckt.
-   **Konsistenter Backend-Status:** Implementiert und durch Unit-Tests abgedeckt.
-   **Tests:** Umfassende Unit-Tests für neue und refaktorisierte Komponenten erstellt.
-   **E2E-Test:** Ein grundlegendes E2E-Testgerüst für den 17-Phasen-Boot ist vorhanden.

### Fortschritt bei den P1-Aufgaben (Weitere Verbesserungen)

Auch bei den P1-Aufgaben wurden bereits wichtige Schritte unternommen:

-   **Modell-Index-Cache:** Implementiert und durch Unit-Tests abgedeckt.
-   **Pfad-Validierung:** Implementiert und durch Unit-Tests abgedeckt.
-   **Safe Mode:** Implementiert und durch Unit-Tests abgedeckt.
-   **Protokollvertrag:** Ein gemeinsamer Zod-/Pydantic-Protokollvertrag wurde beispielhaft für `ResolvedRuntimeRoute` erstellt.

## 4. Wichtige Dateien für den Einstieg

- **Analyse & Planung:**
  - `docs/archive/COPILOT_CODEE_RUNTIME_ROUTING_ABORT_HARDENING.md`
  - `docs/DBZS_CODEE_V4_POST_REPAIR_ANALYSIS.md`
- **Zustandsverwaltung:**
  - `apps/desktop/src/stores/runtimeChatStore.ts`
- **Service-Logik:**
  - `apps/desktop/src/services/fallbackHandler.ts`
  - `apps/desktop/src/services/residentModelHelpers.ts`
- **UI-Komponenten:**
  - `apps/desktop/src/components/RoutingDiagnosticsCard.tsx`
  - `apps/desktop/src/components/TokenBudgetVisualizer.tsx`
