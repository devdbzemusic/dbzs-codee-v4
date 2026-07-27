# DBZS Codee — AI-Native Modular Desktop Environment

**CI:** Lokal via `pnpm ci:local` / `pnpm ci:local:win` (GitHub Actions nur manuell: `workflow_dispatch`, Billing-Lock seit 2026-07-23).

**Lokale Desktop-Umgebung für AI-Orchestrierung, Runtime-Management und modulare Agenten-Workflows.**

---

## 🎯 Aktueller Stand

**Datum:** 2026-07-23  
**Status:** PARTIAL — Developer Alpha / RC Hardening. Gate 1 (Capability Suite 30/30 + lokales CI) ist auf Branch `feat/context-intelligence-rc-hardening` erfüllt; Merge auf `main` und vollständige Windows-Installer-Abnahme bleiben offen.

### Kernfeatures

| Bereich | Status | Beschreibung |
|---------|--------|--------------|
| **Desktop Shell** | REAL | Electron + React + Monaco Editor |
| **4 LLM-Provider** | PARTIAL | llama.cpp/Ollama lokal, OpenAI/Anthropic konfigurationsabhängig |
| **Cloud-Fallback** | PARTIAL | Kontrollierter Fallback vorhanden, Live-Key-Abnahme optional |
| **Job-Spooler** | REAL | Queue + SSE-Live-Updates |
| **Agent Runner** | REAL | Single-Step Execution + Patch-Artefakte |
| **Command Palette** | REAL | Ctrl+K Quick-Actions |
| **Toast-System** | REAL | User Notifications |
| **Model Download** | REAL | HuggingFace GGUF Wizard |
| **GPU-Benchmark** | REAL | Hardware-Erkennung + Tests |
| **Git Intelligence** | REAL | Read-Only Status, Diffs, kontrollierte Commits |
| **Terminal** | PARTIAL | Shell-Sessions + Exec mit Policy-Gates |
| **Autonomous Loop** | PARTIAL | Multi-Step-Controller mit Termination; Live-Abnahme je Runtime offen |
| **Review Gates** | REAL | Backend-API + ReviewGatePanel |
| **ATIF-light Trajectory** | REAL | SQLite-Events, API, Replay |
| **Runtime Slot Management** | PARTIAL | UI + Service für CPU/GPU-Slots; Hardware-live abhängig |
| **Coding Loop Harness** | REAL | Offline-Acceptance via `pnpm test:coding-loop` |
| **Coding Capability Suite** | REAL | 30/30 Vitest-Szenarien; CI-pflichtig mit `RUN_CAPABILITY_SUITE=1` |

### Runtime Slots (Neu!)

DBZS verwendet 3 parallele Slots für optimale Performance:

| Slot | Zweck | Default-Modell | Port | Hardware |
|------|-------|----------------|------|----------|
| `fast_gpu` | Schnelle Chat-Antworten | Qwen2.5-Coder-3B | 8081 | NVIDIA GTX 1650 SUPER |
| `quality_cpu` | Code-Anfragen, großer Kontext | Qwen2.5-Coder-7B | 8082 | CPU/RAM |
| `utility` | Hilfsmodelle | Qwen2.5-Coder-1.5B | 8083 | CPU/RAM |

**Features:**
- ✅ Automatische Slot-Verwaltung im Runtime Chat
- ✅ Start/Stop/Restart-Buttons pro Slot
- ✅ VRAM-Auslastung (GPU-Slot) mit Fortschrittsbalken
- ✅ Intelligente Slot-Empfehlungen (Code → CPU, Chat → GPU)
- ✅ Auto-Start bei Bedarf

### Qualitäts-Gates

```powershell
# Vollständiges lokales CI (= GitHub required-gates)
pnpm ci:local:win

# Schneller Smoke (Teilmenge)
pnpm smoke-test      # Typecheck, Tests, Build, Backend Core, Doctor
pnpm typecheck
pnpm test
pnpm build
pnpm doctor:all

# Capability Suite (auch in ci:local enthalten)
$env:RUN_CAPABILITY_SUITE="1"
pnpm --filter @dbzs/desktop test:capabilities   # 30 Szenarien + Report

pnpm test:coding-loop
```

---

## 🚀 Quickstart

### Installation

```powershell
# 1. Repository klonen
git clone https://github.com/devdbzemusic/dbzs-codee-project.git
cd dbzs-codee-project

# 2. Dependencies installieren
pnpm install

# 3. Backend synchronisieren
cd backend
uv sync
cd ..
```

### Starten

```powershell
# Entwicklungsserver
pnpm dev

# Smoke-Test (alle Checks)
pnpm smoke-test
```

### Runtime Slots verwalten

1. **Runtime Chat öffnen** → RuntimeSlotPanel zeigt alle 3 Slots
2. **Slot starten** → Start-Button für `quality_cpu` oder `fast_gpu`
3. **Status prüfen** → "running" + "Chat Ready" abwarten
4. **Request senden** → Slot verarbeitet Anfrage automatisch
5. **Slot stoppen** → Nach Gebrauch stoppen (spart Ressourcen)

**Mehr:** [`docs/QUICKSTART.md`](docs/QUICKSTART.md)

---

## 🏗️ Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                  Electron Desktop App                       │
│  ┌───────────┐  ┌───────────┐  ┌─────────────────────────┐ │
│  │ Renderer  │  │  Preload  │  │   Main Process          │ │
│  │ (React)   │◀▶│ (Bridge)  │◀▶│   (IPC + Backend)       │ │
│  └───────────┘  └───────────┘  └─────────────────────────┘ │
│         │                │                       │          │
│         │                │                       │          │
│  ┌──────▼────────┐ ┌────▼──────┐     ┌──────────▼────────┐ │
│  │ RuntimeSlot   │ │ Runtime   │     │ Slot-Manager      │ │
│  │ Panel         │ │ Chat      │     │ (Auto-Start)      │ │
│  └───────────────┘ └───────────┘     └───────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                          │ HTTP (127.0.0.1:8876)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   FastAPI Backend                           │
│  Jobs │ Agents │ Runtime │ Models │ SSE │ Cloud-Fallback   │
│                    │                                        │
│         ┌──────────▼────────────────────────────┐          │
│         │  Runtime Slots (Parallel)             │          │
│         │  fast_gpu:8081 │ quality_cpu:8082     │          │
│         │  utility:8083                         │          │
│         └───────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

**Mehr:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## 📚 Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | Erste Schritte (5 Min) + Slot-Management |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System-Übersicht mit Slot-Architektur |
| [`HANDOVER.md`](HANDOVER.md) | Projekt-Status, Checklisten (aktualisiert 2026-06-27) |
| [`docs/PHASES.md`](docs/PHASES.md) | Feature-Historie |
| [`docs/CLOUD_FALLBACK_TEST.md`](docs/CLOUD_FALLBACK_TEST.md) | Cloud-Fallback Test |
| [`docs/PHASE_2C_DESIGN.md`](docs/PHASE_2C_DESIGN.md) | Autonomous Loop Design |
| [`LATER_TODO.MD`](LATER_TODO.MD) | Abgeschlossene Aufgaben + Nächste Schritte |
| [`docs/SCREENCAST_SCRIPT.md`](docs/SCREENCAST_SCRIPT.md) | Video-Aufnahme Skript |
| [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) | Performance-Ergebnisse |

---

## 🔧 Commands

### Entwicklung

```powershell
pnpm dev              # Electron + Backend
pnpm dev:backend      # Nur FastAPI
pnpm smoke-test       # Vollständiger Smoke-Test
```

### Qualitäts-Checks

```powershell
pnpm typecheck        # TypeScript (0 Fehler)
pnpm test             # Alle Tests (~500)
pnpm build            # Production Build
pnpm doctor:backend   # Backend-Health (6/6 Checks)
pnpm e2e              # Playwright-Tests
cd backend && uv run python build.py
```

### Slot-Management

```powershell
# Slot-E2E-Tests
scripts/test-slot-management.ps1

# Backend Doctor (inkl. Slot-Status)
pnpm doctor:backend
```

### Release

```powershell
pnpm build            # Build
pnpm release:win      # Windows Installer
```

---

## 🌐 Provider

| Provider | Typ | Endpoint | Key |
|----------|-----|----------|-----|
| **llama.cpp** | Local | Backend-Proxy | - |
| **Ollama** | Local | `http://127.0.0.1:11434` | - |
| **OpenAI** | Cloud | `api.openai.com` | `OPENAI_API_KEY` |
| **Anthropic** | Cloud | `api.anthropic.com` | `ANTHROPIC_API_KEY` |

**Cloud-Fallback:** Automatisch bei `cloudModelsEnabled=true` und gestoppter Runtime.

---

## 📦 Projektstruktur

```
dbzs-codee-project/
├── apps/desktop/          # Electron App
│   ├── electron/          # Main + Preload
│   └── src/               # React, Stores, Services
│       ├── components/
│       │   ├── RuntimeSlotPanel.tsx    # Neu: Slot-Management UI
│       │   ├── ReviewGatePanel.tsx
│       │   └── ...
│       └── services/
│           ├── runtimeSlotManager.ts   # Neu: Slot-Service
│           └── ...
├── backend/               # FastAPI Backend
│   ├── app/               # Modules (Jobs, Agents, Runtime, ...)
│   └── tests/             # Pytest Tests
├── packages/shared/       # Shared TypeScript Types
├── docs/                  # Dokumentation
├── scripts/               # PowerShell Helper
│   └── test-slot-management.ps1  # Neu: Slot E2E-Tests
└── .github/workflows/     # CI/CD
```

---

## 🛡️ Sicherheit

- **Electron:** `contextIsolation=true`, `nodeIntegration=false`
- **IPC:** Nur explizit freigegebene Funktionen
- **Agent Guardrails:** Command-Allowlist, Workspace-Boundary, Timeout
- **Secrets:** Keine Logs, Env-Vars für API-Keys
- **Slots:** Keine automatischen Änderungen ohne User-Action

**Mehr:** [`docs/SECURITY.md`](docs/SECURITY.md)

---

## 🗺️ Roadmap

### Phase 2C (✅ VOLLSTÄNDIG 2026-06-27)

**Completed:**
- ✅ Autonomous Loop Controller (Backend)
- ✅ Review Gate backend + API
- ✅ ReviewGatePanel + reviewGateService
- ✅ ATIF-light trajectory backend + hooks + frontend
- ✅ Runtime Slot Management (Service + UI + Tests)
- ✅ E2E coverage for autonomous loop + review gates
- ✅ Replay/export tooling

### Phase 3+ (Production-Hardening)

**Priorities:**
1. **Agent Workbench Production** — Crash-Recovery, SSE-Reconnect
2. **Runtime Chat Optimierung** — Tool-Selection, Context-Ranking
3. **Slot-Enhancements** — Model-Auswahl, Auto-Scale, VRAM-Optimierung
4. **E2E Coverage** — Runtime-Chat, Review-Gate, Multi-Agent
5. **Performance-Monitoring** — Response-Time, VRAM/CPU Dashboard

**Design:** [`docs/PHASE_2C_DESIGN.md`](docs/PHASE_2C_DESIGN.md)

---

## 🛠️ Troubleshooting

### Slot unavailable: `target_slot_unavailable: slot 'quality_cpu' is not running`

**Lösung:**
1. Runtime Chat öffnen → RuntimeSlotPanel
2. `quality_cpu` Slot mit "Start"-Button starten
3. Warten bis Status "running" + "Chat Ready"
4. Request erneut senden

**Auto-Start aktivieren:** RuntimeSlotPanel → Auto-Start konfigurieren

### Backend startet nicht

```powershell
pnpm doctor:backend   # Backend-Health prüfen
pnpm dev:backend      # Backend manuell starten
```

### Modell nicht gefunden

1. Settings → Models Path prüfen
2. `pnpm doctor:backend` → Models-Check
3. Model-Download-Wizard nutzen (HuggingFace GGUF)

### Cloud-Fallback funktioniert nicht

1. Settings → `cloudModelsEnabled=true` setzen
2. API-Keys prüfen (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`)
3. `CloudRuntimeClient.is_available()` debuggen

---

## 🤝 Contributing

1. Issue erstellen oder bestehendes kommentieren
2. Branch von `main` abzweigen
3. Änderung implementieren (TypeScript + Tests)
4. `pnpm smoke-test` lokal ausführen
5. PR erstellen

**Richtlinien:** [`AGENTS.md`](AGENTS.md), [`docs/SECURITY.md`](docs/SECURITY.md)

---

## 📄 Lizenz

Siehe [`LICENSE`](LICENSE) Datei.

---

## 🙏 Credits

- **DBZS Team** — Architecture & Vision
- **Electron** — Desktop Framework
- **FastAPI** — Backend Framework
- **Monaco Editor** — Code Editor
- **Playwright** — E2E Testing

---

**Letztes Update:** 2026-06-27 — Runtime Slot Management implementiert, Phase 2C vollständig
