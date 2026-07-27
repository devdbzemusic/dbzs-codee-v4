# DBZS Codee Architecture

**Stand:** 2026-07-23 (Skill Runtime V1)

## Übersicht

DBZS Codee ist eine **AI-native modulare Desktop-Umgebung** mit:

- Electron Desktop App (React + TypeScript)
- FastAPI Backend (Python + uv)
- 4 LLM-Provider (llama.cpp, Ollama, OpenAI, Anthropic)
- Cloud-Fallback bei Offline-Runtime
- Job-Spooler mit SSE-Live-Updates
- Agent Runner für autonome Tasks

---

## Skill Runtime V1

Die Skill Runtime ist deklarativ und in den bestehenden Runtime-Chat eingebettet:

```text
Bundled import.meta.glob ─┐
UserData/skills ──────────┼→ Manifest-Validierung → Registry → Resolver
Workspace/.codee/skills ─┘                         ↓
                                          kompakte Skill Capsule
                                                   ↓
Agentprofil ∩ Verfügbarkeit ∩ Skillrechte ∩ Approval-Policy
                                                   ↓
                                  bestehender Agent-Turn-/Tool-Runtime-Pfad
                                                   ↓
                           .codee/skill-runs/<id>/artifacts/
```

Sicherheitsgrenzen:

- Pakete bestehen nur aus `manifest.yaml`, `SKILL.md` und optional `README.md`.
- JavaScript, native Module, Shellskripte und URLs aus Paketen werden nicht ausgeführt.
- User- und Workspace-Skills sind untrusted und zeigen vor Aktivierung Rechte und Side Effects.
- Toolrechte beschränken Provider-Katalog und Executor; Meta-Tools erweitern sie nicht.
- Artefakte benötigen eine Run-Freigabe und können den isolierten Run-Ordner nicht verlassen.
- Skill-Regeln stehen unter Systemregeln, Benutzerziel, Workspace-Entscheidungen und Task Contract.

---

## System-Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron Desktop App                        │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │   Renderer  │  │   Preload    │  │   Main Process         │ │
│  │   (React)   │◀▶│   (Bridge)   │◀▶│   (IPC + Backend)      │ │
│  │             │  │              │  │                        │ │
│  │ - Editor    │  │ - API Calls  │  │ - Backend Startup      │ │
│  │ - Job Mon   │  │ - Events     │  │ - Window Mgmt          │ │
│  │ - Runtime   │  │ - IPC Proxy  │  │ - Process Mgmt         │ │
│  │ - Settings  │  │              │  │                        │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (127.0.0.1:8876)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │
│  │  Health  │  │ Settings │  │   Jobs   │  │    Runtime     │ │
│  │   API    │  │   API    │  │  Spooler │  │   Service      │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │
│  │  Agents  │  │  Models  │  │  Cloud   │  │      SSE       │ │
│  │  Runner  │  │  Index   │  │ Fallback │  │   Stream       │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌────────────┐ ┌────────────┐ ┌────────────┐
       │  Local     │ │   Cloud    │ │   Local    │
       │  Models    │ │ Providers  │ │  Tools     │
       │ (GGUF)     │ │ (HTTPS)    │ │ (Git, FS)  │
       └────────────┘ └────────────┘ └────────────┘
```

---

## Komponenten

### Desktop App (`apps/desktop/`)

**Technologie:** Electron + React + TypeScript + Zustand

**Hauptmodule:**

| Modul | Datei | Zweck |
|-------|-------|-------|
| Editor | `components/EditorPanel.tsx` | Monaco Editor, Tabs, Dirty-State |
| Job Monitor | `components/JobMonitorPanel.tsx` | Job-Liste, Detail, SSE-Updates |
| Runtime Chat | `components/RuntimeChatTab.tsx` | Chat mit lokaler/cloud Runtime |
| Mission Control | `components/MissionControlPanel.tsx` | Startup-Dashboard, Health |
| Settings | `App.tsx` | Config, Provider, Backend-Reload |
| Command Palette | `components/CommandPalette.tsx` | Quick-Actions (Ctrl+K) |
| Terminal | `components/TerminalPanel.tsx` | Shell-Session, Exec |
| Git | `components/GitPanel.tsx` | Status, Diffs, Commit-Assistant |

**Stores (Zustand):**

- `jobSpoolerStore` — Jobs, SSE-Integration
- `runtimeStore` — Runtime-Status, Start/Stop
- `runtimeChatStore` — Chat-History, Context
- `settingsStore` — Config, Backend-Health
- `agentRegistryStore` — Agent-Definitionen
- `toastStore` — Notifications

**Services:**

- `backendClient.ts` — HTTP-Client für Backend-API
- `sseClient.ts` — EventSource für SSE-Updates
- `modelProviders.ts` — Provider-Abstraktion (4 Provider)
- `modelRouterService.ts` — Routing (local vs. cloud)

---

### Backend (`backend/`)

**Technologie:** FastAPI + Python 3.13 + uv

**API-Endpoints:**

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `/health` | GET | Backend-Health-Check |
| `/settings` | GET/PUT | App-Einstellungen |
| `/models/index` | GET | Modell-Index (lokal + Ollama) |
| `/runtime/status` | GET | Runtime-Status |
| `/runtime/start` | POST | Runtime starten (llama.cpp/Ollama) |
| `/runtime/stop` | POST | Runtime stoppen |
| `/runtime/chat` | POST | Chat gegen Runtime |
| `/job-spooler/*` | GET/POST | Job-Management |
| `/job-spooler/stream` | GET | SSE-Live-Stream |
| `/agent-runner/*` | POST | Agent ausführen |
| `/agents/*` | CRUD | Agent Registry |
| `/model-profiles/*` | GET | Model Profiles |
| `/orchestration/*` | POST | Tool-Orchestration |

**Module:**

| Modul | Datei | Zweck |
|-------|-------|-------|
| Runtime | `app/runtime/service.py` | llama-server/Ollama Mgmt |
| Runtime Launch | `app/runtime/launch.py` | Command Builder, Warmup |
| Job Spooler | `app/job_spooler/service.py` | Job-Queue, Events |
| Job Spooler SSE | `app/job_spooler/sse_router.py` | Server-Sent Events |
| Agent Runner | `app/agent_runner/service.py` | Agent Execution |
| Cloud Client | `app/runtime/cloud_client.py` | Anthropic/OpenAI Fallback |
| Model Index | `app/models/index_service.py` | GGUF-Scan, Ollama-Manifest |
| Agents | `app/agents/service.py` | Registry, Start/Stop, Logs |

---

### Shared (`packages/shared/`)

**Technologie:** TypeScript Library

**Inhalt:**

- Typ-Definitionen (`JobRecord`, `RuntimeStatus`, etc.)
- Shared Constants
- Utility-Funktionen

---

## Datenflüsse

### 1. Job Creation → Execution → SSE Update

```
User (UI)
   │
   ▼
┌─────────────────┐
│ enqueueJob()    │ Desktop Store
└─────────────────┘
   │
   ▼
┌─────────────────┐
│ POST /jobs      │ Backend API
└─────────────────┘
   │
   ▼
┌─────────────────┐
│ Job DB (SQLite) │ Persistenz
└─────────────────┘
   │
   ▼
┌─────────────────┐
│ SSE Broadcast   │ /job-spooler/stream
└─────────────────┘
   │
   ▼
┌─────────────────┐
│ EventSource     │ Desktop sseClient.ts
└─────────────────┘
   │
   ▼
┌─────────────────┐
│ handleSseUpdate │ Store aktualisiert UI
└─────────────────┘
```

### 2. Runtime Chat mit Cloud-Fallback

```
User Input (Chat)
   │
   ▼
┌─────────────────┐
│ sendChat()      │ Desktop Store
└─────────────────┘
   │
   ▼
┌─────────────────┐
│ POST /runtime/chat │ Backend API
└─────────────────┘
   │
   ├──────────────────────┐
   ▼                      ▼
┌─────────────┐    ┌─────────────┐
│ Local       │    │ Cloud       │
│ Runtime     │    │ Fallback    │
│ (llama.cpp) │    │ (Anthropic) │
└─────────────┘    └─────────────┘
   │                      │
   └──────────┬───────────┘
              ▼
┌─────────────────┐
│ Chat Response   │
└─────────────────┘
   │
   ▼
UI Update (Chat-History)
```

### 3. Agent Runner mit Job-Spooler

```
Job (queued)
   │
   ▼
┌─────────────────┐
│ claimNextJob()  │ Agent Runner
└─────────────────┘
   │
   ▼
┌─────────────────┐
│ executeAgent()  │ Coder/Reviewer/Tester
└─────────────────┘
   │
   ├──────────────────────┐
   ▼                      ▼
┌─────────────┐    ┌─────────────┐
│ Local       │    │ Cloud       │
│ Inference   │    │ Fallback    │
└─────────────┘    └─────────────┘
   │
   ▼
┌─────────────────┐
│ Artifacts       │ Patches, Logs
└─────────────────┘
   │
   ▼
┌─────────────────┐
│ Job Complete    │ Status + Output
└─────────────────┘
```

---

## Sicherheitsmodell

### Electron Security

| Setting | Wert | Zweck |
|---------|------|-------|
| `contextIsolation` | `true` | Trennung Renderer/Preload |
| `nodeIntegration` | `false` | Kein Node im Renderer |
| `sandbox` | `true` | Process Isolation |

### IPC-Bridge

Nur explizit freigegebene Funktionen in `preload.ts`:

- Datei-Operationen (open, save, scan)
- Backend-API (Health, Settings, Jobs, Agents)
- Terminal (Session, Exec)
- Git (Read-Only Intelligence)

### Backend Guardrails

| Bereich | Maßnahme |
|---------|----------|
| Agent Commands | Allowlist (`DBZS_AGENT_ALLOWED_COMMANDS`) |
| File Access | Workspace-Boundary-Checks |
| Process Mgmt | Timeout + Kill-Fallback |
| Secrets | Keine Logs, Env-Vars für Keys |

---

## Provider-Architektur

### 4 LLM-Provider

| Provider | Typ | Endpoint | Key |
|----------|-----|----------|-----|
| **llama.cpp** | Local | Backend-Proxy | - |
| **Ollama** | Local | `http://127.0.0.1:11434` | - |
| **OpenAI** | Cloud | `api.openai.com` | `OPENAI_API_KEY` |
| **Anthropic** | Cloud | `api.anthropic.com` | `ANTHROPIC_API_KEY` |

### Model Router

```typescript
// apps/desktop/src/services/modelRouterService.ts

if (preferLocalModels && localRuntimeActive) {
  return llamaCppProvider;  // Via Backend-Proxy
}

if (ollamaModelsAvailable) {
  return ollamaProvider;  // Direkt via fetch
}

if (cloudModelsEnabled && anthropicKeyConfigured) {
  return anthropicProvider;  // Cloud-Fallback
}

return openAiProvider;  // Last Resort
```

---

## SSE-Architektur

### Backend (`app/job_spooler/sse_router.py`)

```python
@router.get("/stream")
async def stream_job_events() -> StreamingResponse:
    return StreamingResponse(_event_generator(), media_type="text/event-stream")

async def _event_generator():
    while True:
        await asyncio.sleep(0.5)
        jobs = _svc.list_jobs(limit=50)
        for job in jobs:
            if job.status_changed:
                yield f"data: {json.dumps(job)}\n\n"
```

### Desktop (`services/sseClient.ts`)

```typescript
export function connectToSse(onJobUpdate: (payload) => void) {
  const sseUrl = `${baseUrl}/job-spooler/stream`;
  eventSource = new EventSource(sseUrl);
  
  eventSource.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    onJobUpdate(data);
  });
}
```

### Store-Integration (`stores/jobSpoolerStore.ts`)

```typescript
connectSse: () => {
  connectToSse((payload: SseJobUpdatePayload) => {
    get().handleSseUpdate(payload);
  });
  set({ sseConnected: true });
}
```

---

## Datenbank-Schema (SQLite)

### Jobs (`jobs.db`)

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  task_type TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL,
  assigned_agent_role TEXT,
  assigned_worker TEXT,
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  input_payload TEXT,  -- JSON
  output_payload TEXT,  -- JSON
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
```

### Agents (`agents.sqlite3`)

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  command TEXT NOT NULL,
  args TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,  -- JSON
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

### Review Gates (Phase 2C+ geplant)

```sql
CREATE TABLE review_gates (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_comment TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

---

## Verzeichnisstruktur

```
dbzs-codee-project/
├── apps/
│   └── desktop/
│       ├── electron/
│       │   ├── main.ts          # Main Process
│       │   └── preload.ts       # Preload Bridge
│       ├── src/
│       │   ├── components/      # React Components
│       │   ├── stores/          # Zustand Stores
│       │   ├── services/        # API Clients
│       │   └── utils/           # Helpers
│       └── package.json
├── backend/
│   ├── app/
│   │   ├── api/                 # FastAPI Router
│   │   ├── agent_runner/        # Agent Execution
│   │   ├── agents/              # Agent Registry
│   │   ├── job_spooler/         # Job Queue + SSE
│   │   ├── models/              # Model Index
│   │   └── runtime/             # Runtime Mgmt
│   ├── tests/
│   └── pyproject.toml
├── packages/
│   └── shared/
│       ├── src/
│       │   └── index.ts         # Shared Types
│       └── package.json
├── docs/
│   ├── QUICKSTART.md
│   ├── ARCHITECTURE.md
│   ├── PHASES.md
│   ├── HANDOVER.md
│   ├── CLOUD_FALLBACK_TEST.md
│   └── PHASE_2C_DESIGN.md
├── scripts/
│   ├── smoke-test.ps1
│   ├── doctor.ps1
│   └── acceptance-live.ps1
└── package.json
```

---

## CI/CD

**GitHub Actions (`.github/workflows/ci.yml`):**

| Job | Runner | Zweck |
|-----|--------|-------|
| `verify` | Ubuntu + Windows | Typecheck, Test, Build |
| `e2e` | Ubuntu | Playwright-Tests |
| `dependabot-alerts` | Ubuntu | Audit-Report |

**Lokale Commands:**

```powershell
pnpm smoke-test       # Vollständiger Smoke-Test
pnpm typecheck        # TypeScript-Check
pnpm test             # Alle Tests
pnpm build            # Production Build
pnpm e2e              # Playwright-Tests
pnpm doctor:backend   # Backend-Health-Check
```

---

## Erweiterungen (Geplant)

### Repository-RAG und sichere Execution Trace

Der FastAPI-Layer besitzt den persistenten Workspace-Index und speichert ihn getrennt in `rag.sqlite3`. Die Pipeline ist:

```text
Workspace → inkrementeller Hash-Scan → Sprach-/Symbol-Chunks → FTS5/BM25 + optionale Embeddings
→ Hybrid Ranking → Retrieval Manifest → Context-Spooler-Lane → Modell
→ reale Runtime-/Tool-/Approval-Events → Safe Trace Builder → Chat-Karte
```

- Der Renderer löst Syncs aus, hält aber keine neue Datenbank.
- Exact/BM25 bleibt ohne Modell vollständig offline verfügbar; Embeddings und Reranking sind optionale Verstärker.
- Der Context Spooler schützt Output-, Tool- und Safety-Reserve und entscheidet final über RAG-Treffer.
- Trace-Zusammenfassungen entstehen deterministisch aus Systemereignissen. Modell-CoT, Systemprompts und Secrets werden verworfen.
- Shared Contracts verbinden Backend, Runtime Chat, Source References und Hidden/Summary/Expanded-UI.

Details und Ist-Audit: `docs/RAG_REASONING_TRACE_AUDIT.md`.

### Phase 2C+: Autonomous Loop + Review Gates

- **AutonomousLoopController:** Multi-Step-Agenten
- **ReviewGatePanel:** User-Freigabe für Patches
- **Auto-Apply-Modi:** `auto_apply`, `require_approval`, `hybrid`
- **Termination Conditions:** max_steps, timeout, user_stop

Siehe `docs/PHASE_2C_DESIGN.md` für Details.

---

## Referenzen

| Dokument | Inhalt |
|----------|--------|
| `AGENTS.md` | Architektur-Leitbild |
| `HANDOVER.md` | Projekt-Status, Checklisten |
| `docs/QUICKSTART.md` | Erste Schritte |
| `docs/PHASES.md` | Feature-Historie |
| `docs/CLOUD_FALLBACK_TEST.md` | Cloud-Testanleitung |
| `docs/PHASE_2C_DESIGN.md` | Autonomous Loop Design |
| `docs/CONVERSATION_CONTROL_V2.md` | Zielarchitektur fuer Chattext, Actions und Approvals |
| `# SYSTEM PROMPT — CODEE CORE AGENT.md` | Agent-Verhalten |
## Repository Review V2 und Remediation

Der Repository-Review bleibt ein sequenzieller Workflow im vorhandenen Runtime-,
Approval- und Phase-Agent-System. Der Analyzer liefert pro Batch Findings und
redigierte Diagnostik. Nach Deduplizierung bestimmen ein hostseitiges Quality Gate
und die kanonische Outcome-Priorität den Abschluss; niedrige Confidence unterdrückt
einen numerischen Production-Readiness-Score.

Review-Artefakte liegen unter `.codee/reviews/<reviewId>/`. Der virtuelle Explorer
macht sie sichtbar, erteilt ihnen aber keine RAG- oder allgemeinen
Workspace-Kontextrechte. Electron prüft aktiven Workspace, Review-ID, Realpfad,
Existenz und Symlink-Grenzen vor jedem Öffnen oder Anzeigen.

`review_remediation` bindet Workspace, Review, Finding-IDs und Severity-Scope in
einer P0-nicht-droppbaren Capsule. Das Routing ist fest:
Planner (Plan/Freigabe) → Coder bzw. Test-Agent (Umsetzung/Checks) → Reviewer
(Verifikation). Der Debugger ist erst nach einem konkreten fehlgeschlagenen Fix
oder Check zulässig.
