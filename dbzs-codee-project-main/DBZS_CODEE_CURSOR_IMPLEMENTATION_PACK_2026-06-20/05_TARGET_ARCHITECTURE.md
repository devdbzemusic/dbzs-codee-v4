# Zielarchitektur

## Übersicht

```text
React Renderer
  ├── Agent Workbench
  ├── Workspace Explorer
  ├── Monaco Editor
  ├── Review Dock
  └── Output / Diagnostics
           │
           │ HTTP + SSE
           ▼
FastAPI Backend
  ├── AgentRunService
  ├── AgentWorker
  ├── PlanService
  ├── ContextRetrieval
  ├── ToolCoordinator
  ├── ReviewGateService
  ├── ProjectAdapterRegistry
  ├── EventRepository
  └── HostActionQueue
           │
           │ Host Actions
           ▼
Electron Main Process
  ├── PatchPipelineService
  ├── FileChangeService
  ├── RestorePointService
  ├── SafeCommandService
  ├── GitService
  └── WorkspaceService
```

## Verantwortungsgrenzen

### FastAPI Backend

Quelle der Wahrheit für:

- AgentRun
- AgentStep
- AgentEvent
- Plan
- Tool Call
- Patch Proposal
- Review-Verknüpfung
- Host Action Request
- Command Result
- Follow-up
- Run-Termination

Das Backend darf in Phase 3 keine privilegierten Dateiänderungen direkt ausführen.

### Electron Main Process

Einziger privilegierter Host für:

- Datei schreiben
- Datei umbenennen/löschen
- Restore Point
- Patch anwenden
- sichere Commands
- Git Branch/Commit
- Workspace Refresh

### Renderer

Verantwortlich für:

- Anzeigen
- Nutzereingaben
- Review-Entscheidungen
- Start/Pause/Resume/Cancel
- Host Executor aktiv halten
- Editor- und Explorer-Navigation

Keine autonome Ablaufsteuerung in lokalen Maps.

## Host Action Bridge

Da Backend und Electron getrennte Prozesse sind, wird eine kleine persistente Host-Action-Queue eingeführt.

Beispiel:

```text
Backend erzeugt HostAction(apply_patch)
    ↓
Renderer erhält host_action.requested per SSE
    ↓
Renderer ruft Electron IPC applyPatchWithRestorePoint auf
    ↓
Renderer meldet Resultat an Backend
    ↓
Backend erzeugt file.applied und command/test Events
```

## Minimaler Betriebsmodus

- ein aktiver schreibender Run
- ein `desktop-primary` Host Executor
- ein SQLite-Repository
- ein SSE-Stream pro Run
- Hintergrundworker als einfacher Backend-Task/Thread
- keine verteilte Infrastruktur
