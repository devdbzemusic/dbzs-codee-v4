# Executive Summary

## Das eigentliche Problem

Codee besitzt bereits viele brauchbare Einzelkomponenten:

- Workspace Explorer
- Monaco Editor
- Runtime Chat
- Job-Spooler
- Agent Runner
- Context Pack
- Planner
- Safe Patch Pipeline
- Review Gates
- Test Agent
- Terminal
- Trajectory Events
- Autonomous-Loop-Foundation

Der Engpass ist nicht das Fehlen einzelner Panels. Der Engpass ist die **fehlende gemeinsame Laufzeitidentität**.

Heute existieren mehrere voneinander getrennte Zustandsobjekte:

- Job
- Planner Plan
- Agent-Runner-Ergebnis
- Autonomous Session
- Runtime Chat
- Patch Proposal
- Review Gate
- Test Run
- Trajectory Event
- Editor Pending Change

Für einen verlässlichen Entwicklungsworkflow braucht Codee stattdessen ein zentrales Objekt:

## `AgentRun`

Ein `AgentRun` verbindet:

- Nutzerziel
- Workspace
- ausgewähltes Modell
- Plan
- Schritte
- Toolaufrufe
- Dateiänderungen
- Reviews
- Befehlsläufe
- Follow-ups
- Logs
- Abschlusszustand

## Zentrale Architekturentscheidung

Der **FastAPI-Backendkern** wird die Quelle der Wahrheit für Run, Plan, Schritte und Events.

Der **Electron Main Process** bleibt der privilegierte lokale Host für:

- Dateiänderungen
- Restore Points
- sichere Commands
- Git-Schreiboperationen
- Workspace Refresh

Der Renderer zeigt Zustand und nimmt Entscheidungen entgegen. Er darf nicht mehr selbst die autonome Ablaufsteuerung in flüchtigen `Map`-Objekten halten.

## Kein Enterprise-System

Da Codee nur für Ralf gebaut wird:

- eine lokale SQLite-Datenbank
- ein Desktop-Host
- ein aktiver Worker
- SSE statt komplexer Message Broker
- kein Login
- keine Mandantenfähigkeit
- keine verteilte Queue
- keine automatische Patch-Freigabe

Das reduziert den Aufwand deutlich, ohne Sicherheit und Wiederherstellbarkeit zu opfern.

## Phasen

1. **3A — Agent Run Backbone**
2. **3B — Event Spine und Worker Loop**
3. **3C — Context Retrieval und Tool Runtime**
4. **3D — Project Adapter und Command Bridge**
5. **3E — Patch, Review, Apply, Test, Debug**
6. **3F — Agent Workbench UI**
7. **3G — Follow-up, Resume und Hardening**

## Ab wann ist Codee wirklich nutzbar?

- Nach 3A–3C: sinnvoll für Analyse und kontrollierte Read-only-Arbeit.
- Nach 3D–3E: sinnvoll für kleine echte Änderungen mit Review und Tests.
- Nach 3F–3G: als persönliche tägliche Entwicklungsumgebung für kleine und mittlere Aufgaben realistisch nutzbar.
