# DBZS Codee — Roadmap

**Stand:** 2026-07-01  
**Aktuelle Phase:** Coding Capability Hardening

Statuswerte folgen `docs/STATUS_MATRIX.md`: `REAL`, `PARTIAL`, `MOCK`, `BLOCKED`, `DEPRECATED`.

---

## 📍 Abgeschlossene Phasen

### Phase 0: Foundation (✅ Fertig)

- Electron Shell + React Renderer
- FastAPI Backend (Health, Settings)
- Secure Preload-Bridge
- Monaco Editor + Tabs

### Phase 1: AI Integration (✅ Fertig)

- Agent Runner MVP
- Runtime Doctor API
- Context Pack (Workspace-Kontext)
- Safe Patch Pipeline

### Phase 2A: Agent Execution (✅ Fertig)

- Agent Runner + LLM Integration
- Runtime-Chat
- Patch-Artefakte
- Job Monitor Apply

### Phase 2B: UX + Orchestration (✅ Fertig 2026-06-17)

- Command Palette (Ctrl+K)
- Toast-System
- Job-Task-Linking
- GPU-Erkennung + Benchmark
- SSE-Live-Updates
- Model-Download-Wizard
- Cloud-Fallback (Anthropic/OpenAI)
- 4 Provider (llama.cpp, Ollama, OpenAI, Anthropic)

---

## 🎯 Nächste Phase: 2C+ (Autonomous Agents)

### 2C.1: Loop Controller (Backend)

**Zeitraum:** 2026-06 – 2026-07  
**Status:** PARTIAL

**Liefergegenstände:**
- [x] `autonomous_controller.py` implementieren
- [x] Job-Schema um `execution_mode` erweitern
- [x] Step-Counter in Agent-Loop
- [x] Termination-Conditions
- [x] Unit-Tests
- [ ] Live-Modell-Langlauf dokumentieren

**Akzeptanzkriterien:**
- Agent kann 10 Steps autonom ausführen
- Loop terminiert bei `max_steps` oder `timeout`
- User kann Loop manuell stoppen

---

### 2C.2: Review Gates (Backend)

**Zeitraum:** 2026-06 – 2026-07  
**Status:** REAL

**Liefergegenstände:**
- [x] `review_gates/` Module erstellen
- [x] SQLite-Models + Migration
- [x] API-Endpoints (`/review-gates/*`)
- [x] Auto-Apply-Timeout-Logik
- [x] Tests schreiben

**Akzeptanzkriterien:**
- Review-Gates blockieren Apply bis Freigabe
- 3 Modi: `auto_apply`, `require_approval`, `hybrid`
- Toast bei neuem Review-Gate

---

### 2C.3: Desktop UI

**Zeitraum:** 2026-06-xx – 2026-06-xx  
**Status:** 📋 Geplant

**Liefergegenstände:**
- [ ] `ReviewGatePanel.tsx` Komponente
- [ ] `AutonomousJobWizard.tsx`
- [ ] IPC-Bridge für Review-Actions
- [ ] JobMonitor um Loop-Status erweitern
- [ ] Tests schreiben

**Akzeptanzkriterien:**
- Review-Panel zeigt Diffs klar an
- Loop-Status im JobMonitor sichtbar
- Job-Erstellung mit Loop-Config

---

### 2C.4: Integration

**Zeitraum:** 2026-06 – 2026-07  
**Status:** PARTIAL

**Liefergegenstände:**
- [x] Offline Coding-Loop-Acceptance (`pnpm test:coding-loop`)
- [x] Dokumentation erweitern
- [x] Smoke-Tests
- [ ] Playwright-E2E mit Live-Modell dokumentieren
- [ ] Performance-Tests (max_steps=10) regelmäßig im CI-Gate verankern

**Akzeptanzkriterien:**
- Alle Tests grün (Backend + Desktop)
- CI-Pipeline erweitert
- Dokumentation vollständig

---

## 🔮 Zukünftige Phasen (Vision)

### Phase 3: Multi-Agent Collaboration

**Ziel:** Mehrere Agents arbeiten parallel an einem Job

**Features:**
- Planner → Coder → Tester → Reviewer Pipeline
- Agent-to-Agent Communication
- Shared Context & Memory
- Conflict Resolution

**Offene Fragen:**
- Wie Agents koordinieren?
- Wer trifft Entscheidungen bei Konflikten?
- Wie State synchron halten?

---

### Phase 4: Advanced Tooling

**Ziel:** Erweiterte Developer-Tools

**Features:**
- Integrated Debugger (DAP)
- Performance Profiler
- Dependency Analyzer
- Security Scanner

---

### Phase 5: Plugin-System

**Ziel:** Erweiterbare Architektur

**Features:**
- Plugin-API für Agents
- Custom Tool-Integration
- Marketplace für Plugins
- Sandbox-Execution

---

## 📊 Metriken & Ziele

### Technische Ziele

| Metrik | Aktuell | Ziel 2C+ | Ziel Phase 3 |
|--------|---------|----------|--------------|
| Test-Abdeckung | ~70% | 80% | 85% |
| Build-Zeit | 53s | <50s | <45s |
| Startup-Zeit | ~3s | ~2s | ~2s |
| Max Steps (Agent) | 1 | 10 | ∞ (Loop) |

### UX-Ziele

- [ ] Time-to-First-Job < 5 Min (Quickstart)
- [ ] Review-Gate-Approval < 30 Sek
- [ ] Zero-Config für lokale Runtime
- [ ] Cloud-Fallback transparent

---

## 🚧 Risiken & Abhängigkeiten

| Risiko | Impact | Wahrscheinlichkeit | Gegenmaßnahme |
|--------|--------|-------------------|---------------|
| llama-server nicht verfügbar | Hoch | Mittel | Cloud-Fallback, Docs |
| Endlosschleifen (Phase 2C+) | Hoch | Mittel | Hard-Limits, Monitoring |
| Performance-Probleme | Mittel | Niedrig | Caching, Background-Jobs |
| API-Key-Management | Mittel | Niedrig | Env-Vars, Secure Storage |

---

## 📅 Meilensteine

| Datum | Meilenstein | Status |
|-------|-------------|--------|
| 2026-06-16 | Phase 2B abgeschlossen | ✅ Erledigt |
| 2026-06-17 | Smoke-Test + Docs | ✅ Erledigt |
| 2026-07-01 | Coding Capability Hardening P0/P1 | PARTIAL |
| 2026-07-xx | Live-Modell-E2E fuer Coding Loop | offen |
| 2026-07-xx | Phase 3 (Multi-Agent) | 🔮 Vision |

---

## 🔗 Referenzen

- [`docs/PHASE_2C_DESIGN.md`](docs/PHASE_2C_DESIGN.md) — Architecture Design
- [`LATER_TODO.MD`](LATER_TODO.MD) — Offene Aufgaben
- [`HANDOVER.md`](HANDOVER.md) — Projekt-Status
- [`docs/QUICKSTART.md`](docs/QUICKSTART.md) — Erste Schritte

---

**Letztes Update:** 2026-07-01
