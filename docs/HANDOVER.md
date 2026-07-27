# Übergabedokument: DBZS Codee

**Stand:** 27. Juli 2026

Dieses Dokument fasst den aktuellen Entwicklungsstand, die Architektur und die nächsten Schritte für das Projekt `dbzs-codee` zusammen.

## 1. Aktueller Status

Das Projekt befindet sich in einer kritischen Reparatur- und Stabilisierungsphase. Die jüngsten Arbeiten konzentrierten sich auf zwei Hauptbereiche:

1.  **Boot-Repair (Abgeschlossen):** Die Boot-Sequenz der Anwendung wurde von einem unvorhersehbaren, nebenläufigen Prozess zu einem strikt sequenziellen, deterministischen und beobachtbaren 17-Phasen-Ablauf umgebaut. Dies hat die Startzuverlässigkeit erheblich verbessert.

2.  **Routing-Repair (Laufend):** Die Analyse nach dem Boot-Repair (`DBZS_CODEE_V4_POST_REPAIR_ANALYSIS.md`) hat gezeigt, dass die Kernprobleme nun im Bereich des Intent-Routings, der Modell-Aktivierung (Warm-up) und der Zustandssynchronisation liegen. Die laufenden Arbeiten konzentrieren sich auf die Behebung dieser Punkte (siehe `TODO.md`).

**Gesamtzustand:** Die Basis-Architektur ist solide. Die intelligente Steuerung und Fehlerbehandlung im Kern der Anwendung wurde erheblich gehärtet, aber ein kritischer Bug im Repository Review erfordert sofortige Aufmerksamkeit.

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

### Aktueller, unmittelbarer Fokus: Behebung des Repository-Review-Bugs

Es gibt einen kritischen, bekannten Fehler im Repository-Review-Feature:

-   **Der Bug:** Das Starten eines "Full Repository Review" während eine Datei im Editor aktiv ist, führt fälschlicherweise zu einem leeren Review-Plan (`batches: []`), wodurch der Durchlauf fehlschlägt.
-   **Die Ursache:** `runtimeChatStore.ts` sendet fälschlicherweise den Pfad der aktiven Datei (`selectedPaths: [activeFile.path]`) an den Review-Orchestrator, selbst wenn der Benutzer einen vollständigen Repository-Review (`scope: "full_repository"`) beabsichtigt. Der `reviewBatchPlanner.ts` filtert dann strikt nach diesen `selectedPaths`, was zu einem leeren Satz von zu analysierenden Dateien führt.

Die nächsten Schritte zur Behebung dieses Fehlers sind in `TODO.md` unter "Nächster Fix" detailliert beschrieben.

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
