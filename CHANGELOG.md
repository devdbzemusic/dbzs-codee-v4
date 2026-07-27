# Changelog

Alle wesentlichen Änderungen am DBZS Codee Projekt.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).

---

## [Unreleased]

### Hinzugefügt

- **Phase 3H Repair — Agent Workbench Real Local LLM Integration**
  - **Echter Modell-Turn:** Die unzuverlässige und simulierte Bypass-Logik (`DBZS_LIVE_LLM_ACCEPTANCE`) wurde komplett aus dem Worker entfernt.
  - **System Prompt & JSON Turn Contract:** Einführung eines typsicheren, strukturierten Systemprompts (`AGENT_WORKBENCH_SYSTEM_PROMPT`), welcher die Ausgabe des lokalen Modells streng per JSON-Schnittstelle in vier Kanäle (*tool_call*, *proposed_change*, *host_action*, *follow_up*) zerlegt.
  - **Runtime Binding Adapter:** Implementierung eines robusten Adapters (`DefaultAgentRuntimeAdapter`), der den Status des `RuntimeService` (lollama / llama.cpp / ollama) aktiv überwacht, GGUF-Modelle bei Bedarf bootet und die Verbindungswerte zurück in das SQLite-Schema synchronisiert.
  - **UI Live Runtime Display:** Anpassung des Desktop-Frontends zur dynamischen Visualisierung der GGUF-Portdaten, PID und des Health-Zustandes im Run-Header.
  - **Automatische On-Startup-Migrationen:** Einbindung der SQLite workbench-Tabellen-Bootstrapping beim Hochfahren des FastAPI App-Lifecycles (`main.py`).
  - **Turn & Adapter-Tests:** Neue Integrationstests für das Turn-Modell-Verhalten in `tests/test_agent_workbench_worker_turns.py` und den `RuntimeAdapter` in `tests/test_agent_workbench_runtime_adapter.py`. All 193 Backend-Tests laufen grün.

- **ATIF-light Trajectory System**
  - Backend: `backend/app/trajectories/` (SQLite, Service, API)
  - Endpoints: `POST /trajectories/events`, `GET /trajectories/jobs/{job_id}`, `GET /trajectories/recent`
  - Hooks in `AutonomousLoopController` (step_started, completed/cancelled/error)
  - Hooks in `ReviewGateService` (create/approve/reject, einmaliges auto_apply_checked)
  - Desktop: `trajectoryService.ts`, `TrajectoryMiniPanel.tsx` im JobMonitor

### Phase 2C status

Implemented foundation, hardening in progress.

**Completed:**
- AutonomousLoopController
- ReviewGate backend
- ReviewGate API
- Initial ReviewGatePanel
- ATIF-light trajectory backend

**Needs hardening:**
- Full visual Review Cockpit
- Deeper JobMonitor integration
- Replay/export tooling
- E2E coverage for autonomous loop + review gates

---

## [0.2.0] — 2026-06-17

### Hinzugefügt

- **SSE-Live-Updates** für Job-Spooler
  - Backend: `app/job_spooler/sse_router.py`
  - Desktop: `services/sseClient.ts`, `stores/jobSpoolerStore.ts`
  - Echtzeit-Statusänderungen im JobMonitor

- **Smoke-Test Skript**
  - `scripts/smoke-test.ps1` für automatisierte Vorab-Prüfung
  - Command: `pnpm smoke-test`

- **Cloud-Fallback Testdokumentation**
  - `docs/CLOUD_FALLBACK_TEST.md` mit Schritt-für-Schritt-Anleitung

- **Phase 2C+ Design-Dokument**
  - `docs/PHASE_2C_DESIGN.md` mit Architektur-Entwurf

- **QUICKSTART.md**
  - Erste Schritte in 5 Minuten

- **ARCHITECTURE.md Überarbeitung**
  - Vollständige System-Dokumentation mit Diagrammen

- **ROADMAP.md**
  - Phasen-Planung bis Phase 5

### Geändert

- **CI-Workflow erweitert**
  - Build-Matrix: Ubuntu + Windows
  - pnpm audit im Verify-Job
  - E2E-Artifakte Upload (Playwright-Report)
  - Dependabot-Audit-Report als Artifact

- **README.md überarbeitet**
  - Modernisiertes Layout mit Tables und Badges
  - Aktuelle Feature-Übersicht (Phase 2B)

- **LATER_TODO.MD aufgeräumt**
  - Abgeschlossene Aufgaben dokumentiert
  - Phase 2C+ Tasks strukturiert

### Verbessert

- **Test-Auswahl optimiert**
  - Smoke-Test verwendet Core-Tests (17 statt 64)
  - Vermeidet Permission-Errors in CI

- **Dokumentation**
  - Alle Docs konsolidiert und aktualisiert
  - Checklisten in HANDOVER.md vervollständigt

### Behoben

- **pytest-Cache-Probleme**
  - Cache wird vor Tests bereinigt
  - Vermeidet Permission-Errors auf Windows

---

## [0.1.0] — 2026-06-16

### Hinzugefügt

- **4 LLM-Provider**
  - llama.cpp (lokal via Backend-Proxy)
  - Ollama (lokal direkt)
  - OpenAI (Cloud HTTPS)
  - Anthropic (Cloud HTTPS)

- **Cloud-Fallback**
  - Automatische Umschaltung bei Offline-Runtime
  - Konfigurierbar via `cloudModelsEnabled`

- **Command Palette**
  - Ctrl+K für Quick-Actions
  - Fuzzy-Suche

- **Toast-System**
  - Notifications für User-Feedback

- **Job-Task-Linking**
  - Verknüpfung von Jobs und Tasks
  - Link/Unlink-UI

- **Model-Download-Wizard**
  - HuggingFace GGUF-Downloads
  - Fortschrittsanzeige

- **GPU-Erkennung + Benchmark**
  - Hardware-Presets
  - Latenz + Tokens/s-Messung

- **SSE-Router** (Backend)
  - `app/job_spooler/sse_router.py`
  - Server-Sent Events für Job-Updates

### Geändert

- **Electron-Start optimiert**
  - Fenster öffnet sofort
  - Backend startet asynchron danach

- **Runtime-Chat synchronisiert**
  - Live-Status vor Chat
  - 15s-Polling für Runtime-Status

- **llama.cpp Warmup**
  - 90s Retry-Logik für langsames Modell-Laden
  - Stderr-Capture für Diagnose

### Behoben

- **agent_logs Migration**
  - Legacy-DB mit timestamp NOT NULL → Agents 500
  - Dual-column Insert in `agents/service.py`

- **Docs Workspace Root**
  - `projectPath` statt Tab-Parent in `App.tsx`

- **Mission Control leere Fläche**
  - `MissionControlPanel.tsx` mit Fallback-Logik

- **TypeScript-Fehler**
  - `openFileDialog`/`writeProjectFile` Fixes

---

## [0.0.0] — 2026-05-12

### Hinzugefügt

- **Phase 0: Stabilisierung**
  - Electron Preload-Bridge
  - FastAPI Backend (Health, Settings)
  - Monaco Editor + Tabs
  - Workspace-Integration

- **Phase 0.1: Job-Spooler IPC**
  - Electron-Bridge für Job-Operations

- **Phase 0.2: Doctor Scripts**
  - `scripts/doctor.ps1`
  - `backend/scripts/doctor_backend.py`

- **Phase 1A: Agent Runner MVP**
  - `backend/app/agent_runner/`
  - API + Tests

- **Phase 1B: Runtime Doctor**
  - `backend/app/runtime/doctor.py`
  - Hardware-Presets, Dry-Run, Probe

- **Phase 1C: Context Pack**
  - `backend/app/context_pack/`
  - Workspace-Kontext für Agents

- **Phase 1D: Safe Patch Pipeline**
  - `patchPipelineService.ts`
  - IPC + Restore-Point-Integration

- **Git Intelligence**
  - Read-Only Git-Service
  - GitPanel mit Status, Diffs, Commits
  - Restore Points für Safety

- **Terminal-Integration**
  - Shell-Sessions (persistent)
  - Einzel-Exec-Modus

- **Project Memory**
  - SQLite-Persistenz für Workspace-Memory
  - Tags + Keys

- **Task Board**
  - Operative Aufgabenpflege
  - Status (todo, in_progress, done) + Priorität

- **Docs-Analyse**
  - `GET /docs/analyze` mit TODO/FIXME-Erkennung
  - `POST /docs/generate` für Markdown

---

## Versionierung

- **Major:** Breaking Changes
- **Minor:** Neue Features (abwärtskompatibel)
- **Patch:** Bugfixes (abwärtskompatibel)

## Release-Zyklus

- **Nightly:** Development-Builds von `main`
- **Minor:** Alle 2-4 Wochen
- **Major:** Nach Bedarf (Architektur-Änderungen)

## Links

- [Unreleased]: https://github.com/devdbzemusic/dbzs-codee-project/compare/v0.1.0...HEAD
- [0.1.0]: https://github.com/devdbzemusic/dbzs-codee-project/compare/v0.0.0...v0.1.0
- [0.0.0]: https://github.com/devdbzemusic/dbzs-codee-project/releases/tag/v0.0.0
