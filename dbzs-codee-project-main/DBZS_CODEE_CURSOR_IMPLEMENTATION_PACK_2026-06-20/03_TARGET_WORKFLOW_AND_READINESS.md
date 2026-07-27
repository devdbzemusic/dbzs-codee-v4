# Zielworkflow und Readiness-Stufen

## Zielworkflow

```text
Nutzer erstellt AgentRun
    ↓
Workspace wird validiert und erkannt
    ↓
Kontext- und Projektadapter werden vorbereitet
    ↓
Planner erzeugt persistente AgentSteps
    ↓
User bestätigt den Plan oder startet im supervised mode
    ↓
Worker startet Step
    ↓
Agent liest/sucht gezielt Dateien
    ↓
Agent erzeugt Tool Calls oder Patch Proposal
    ↓
Dateiänderung erzeugt Review Gate
    ↓
User genehmigt oder lehnt ab
    ↓
Desktop Host erzeugt Restore Point und wendet Patch an
    ↓
Projektadapter führt Build/Test/Lint aus
    ↓
Ergebnis wird ausgewertet
    ├── grün: nächster Step
    └── rot: echter Debug-Step
    ↓
Run abgeschlossen, pausiert oder fehlgeschlagen
```

## Readiness-Stufen

### R0 — aktueller Zustand: Komponenten-Prototyp

- viele Einzelteile vorhanden
- kein gemeinsamer persistenter Run
- manuelle Übergaben
- Autonomy teilweise Renderer-basiert
- kein garantierter Closed Loop

Nicht für größere Aufgaben vertrauenswürdig.

### R1 — analysierender Assistent

Erreicht nach Phase 3A–3C:

- persistenter Run
- persistenter Plan
- Live Events
- echte Read-only-Tools
- Pause/Stop/Resume
- Context Retrieval

Dann sinnvoll für:

- Projektanalyse
- Review
- Fehlerlokalisierung
- Planung
- Dokumentation
- Patch-Vorschläge ohne Apply

### R2 — sicherer Änderungsassistent

Erreicht nach Phase 3D–3E:

- Projektadapter
- echte Commands
- Patch Review
- Restore Point
- Apply
- Build/Test
- Debug-Step bei Fehlern

Dann sinnvoll für:

- kleine Bugfixes
- kleine Features
- Dokumentationsänderungen
- überschaubare Refactorings
- Tests ergänzen

### R3 — tägliche persönliche Entwicklungsumgebung

Erreicht nach Phase 3F–3G:

- Agent Workbench
- vollständiger Activity Stream
- Follow-ups im laufenden Run
- Session Resume nach Neustart
- Recovery nach Prozessabbruch
- aussagekräftiger Abschlussbericht

Dann ist Codee realistisch täglich nutzbar.

## Verbindlicher Daily-Use-Test

Codee gilt erst als R3, wenn der folgende Ablauf dreimal hintereinander ohne manuelle Datenbank- oder Dateireparatur funktioniert:

1. Test-Workspace öffnen.
2. Eine Änderung mit zwei bis vier Dateien beauftragen.
3. Plan bestätigen.
4. Agent liest relevante Dateien.
5. Agent schlägt Änderungen vor.
6. User genehmigt.
7. Restore Point wird erstellt.
8. Dateien werden geändert.
9. Tests werden real ausgeführt.
10. Bei absichtlichem Testfehler entsteht ein Debug-Step.
11. Nach Fix werden Tests erneut ausgeführt.
12. App wird während eines zweiten Runs neu gestartet.
13. Run wird korrekt wiederhergestellt.
14. Abschlussbericht enthält Dateien, Diffs, Commands und Ergebnis.
