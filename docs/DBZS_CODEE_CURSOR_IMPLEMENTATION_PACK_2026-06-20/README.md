# Division By Zeros (DBZS) Codee — Cursor Implementation Pack

**Stand:** 2026-06-20  
**Repo:** `devdbzemusic/dbzs-codee-project`  
**Zweck:** Codee so weit bringen, dass Ralf die Entwicklungsumgebung im persönlichen Alltag wirklich für Sourcecode-Projekte einsetzen kann.

## Einordnung

Dieses Paket ist **kein Auftrag, Cursor optisch oder technisch zu kopieren**.

Cursor dient ausschließlich als Vergleichsmaßstab für einen geschlossenen Entwicklungsworkflow:

`Ziel → Plan → Schritte → Toolaktionen → Dateiänderungen → Review → Build/Test → Korrektur → Abschluss`

Codee bleibt ein eigenständiges, lokales und modulares Division By Zeros (DBZS) Werkzeug.

## Persönlicher Einsatzrahmen

Codee wird für **einen Benutzer auf einem lokalen Rechner** gebaut. Deshalb werden bewusst nicht benötigt:

- Benutzerkonten, Rollenverwaltung oder Mandantenfähigkeit
- Team- und Kollaborationsfunktionen
- Remote-Worker-Cluster
- Abrechnung, Quoten oder Marketplace
- Enterprise-Telemetrie
- horizontale Skalierung
- öffentliche Serverbereitstellung

Trotzdem zwingend erforderlich:

- Workspace-Sandbox
- nachvollziehbare Dateiänderungen
- Restore Points und Rollback
- kontrollierte Befehlsausführung
- persistente Sessions
- ehrliche Statusmeldungen
- vollständige lokale Logs
- reproduzierbare Tests

## Inhalt

1. `00_EXECUTIVE_SUMMARY.md` — Ziel und zentrale Entscheidung
2. `01_CURRENT_STATE_SOURCE_TRUTH.md` — ehrlicher Sourcecode-Stand
3. `02_PERSONAL_SINGLE_USER_PRINCIPLES.md` — Vereinfachungen für den Eigengebrauch
4. `03_TARGET_WORKFLOW_AND_READINESS.md` — wann Codee wirklich benutzbar ist
5. `04_GAP_MATRIX_CURSOR_AS_BENCHMARK.md` — Funktionsvergleich ohne Kopierabsicht
6. `05_TARGET_ARCHITECTURE.md` — Zielarchitektur
7. `06_DATA_MODEL_AND_STATE_MACHINES.md` — persistente Kernmodelle
8. `07_EVENT_AND_SSE_CONTRACT.md` — Live-Aktivitätsmodell
9. `08_TOOL_RUNTIME_AND_HOST_BRIDGE.md` — sichere Tool- und Desktop-Ausführung
10. `09_PATCH_REVIEW_TEST_LOOP.md` — geschlossener Änderungszyklus
11. `10_PROJECT_ADAPTERS.md` — Node, Python, Rust, Gradle und CMake
12. `11_AGENT_WORKBENCH_UI.md` — funktionale Oberfläche
13. `12_MIGRATION_AND_COMPATIBILITY.md` — vorhandene Module weiterverwenden
14. `13_TEST_STRATEGY_AND_ACCEPTANCE.md` — Test- und Abnahmestrategie
15. `14_DEFINITION_OF_DONE_AND_GATES.md` — verbindliche Gates
16. `15_CURSOR_EXECUTION_ORDER.md` — Reihenfolge für Cursor
17. `16_DBZS_IMPLEMENTATION_RULES.md` — Quellcode- und Dokumentationsregeln
18. `PROMPTS/` — einzeln ausführbare Cursor-Aufträge
19. `SCHEMAS/` — Event- und API-Beispiele
20. `CHECKLISTS/` — Review und Daily-Use-Abnahme

## Empfohlener Start

In Cursor zuerst ausschließlich ausführen:

`PROMPTS/01_PHASE_3A_AGENT_RUN_BACKBONE.md`

Nicht mehrere Phasen in einem Lauf vermischen.

## Zielzustand

Codee gilt als alltagstauglich, wenn eine kleine reale Aufgabe dreimal hintereinander vollständig durchläuft:

1. Workspace öffnen
2. Ziel eingeben
3. Plan erzeugen
4. Schritte sichtbar ausführen
5. Dateien nur nach Review ändern
6. Tests wirklich ausführen
7. Fehler als Debugschritt behandeln
8. Run nach Neustart wiederherstellen
9. Abschlussbericht und vollständige Ereignishistorie liefern
