# LATER TODO — DBZS Codee

**Stand:** 2026-07-23
**Aktueller Branch:** `feat/context-intelligence-rc-hardening` (PR [#51](https://github.com/devdbzemusic/dbzs-codee-project/pull/51))
**Handover:** `HANDOVER.md`

---

## P0 Integration Hardening — Gate 1

Master-Prompt: `CURSOR_MASTERPROMPT_DBZS_CODEE_P0_HARDENING.md`

### Umgesetzt (Gate 1)

- [x] `contextBudgetManager`: `repositoryTokens` = Budget, `repositoryTokensUsed` = Verbrauch
- [x] Capability-Harness: Runtime-Slot-, Broker-, Clarification- und Execution-Gate-Mocks
- [x] Tool-Call-Fixtures auf `<CODEE_TOOL_CALL>`-Envelope
- [x] Capability Suite **30/30** deterministisch (`RUN_CAPABILITY_SUITE=1`)
- [x] Capability Suite in CI Required-Gates (`.github/workflows/ci.yml`)
- [x] Lokales CI: `pnpm ci:local` / `pnpm ci:local:win`
- [x] `pnpm ci:local` lokal grün (Typecheck, 813 Desktop, 344 Backend, Build, Smoke, Audit)

### Offen — erst nach Merge Gate 1 auf `main`

- [ ] PR #51 reviewen und mergen
- [ ] GitHub CI (ubuntu + windows) nach Push bestätigen
- [ ] **Phase 2** Security-Migration (Cloud-API-Schlüssel) — gesperrt bis Gate 1 auf `main`
- [ ] **Phase 3** Build-Heap / Packaging-Härtung
- [ ] **Phase 4–6** Docs, ADR, Modul-Split

### Harness-Hinweise (für Maintainer)

- Agent-Routing-Szenarien nutzen `setCapabilityBrokerAgentOverride` im Test-Harness
  (Broker ist autoritativ; Szenario-`targetAgent` wird für deterministische Assertions gesetzt).
- Clarification- und Execution-Gates sind im Harness gemockt, nicht Produktcode geändert.

---

## Skill Runtime V1

### Umgesetzt

- [x] V1-Contracts, striktes YAML/Zod-Schema und Größen-/Aliasgrenzen
- [x] Bundled/User/Workspace Loader und Registry mit Override-Transparenz
- [x] Sicherer Ordnerimport; ZIP, Symlink und Paketcode blockiert
- [x] Resolver, Preconditions, Konflikte, Komposition und Skill Capsule
- [x] Technisch erzwungene Tool-Schnittmenge und `skill_tool_policy_violation`
- [x] Persistente Skill Runs, Snapshots, Artefakte, Resume/Cancel, Events und Metriken
- [x] `write_skill_artifact` mit einmaliger Run-Freigabe und Workspace-Grenze
- [x] Bestehende Built-ins als V1-Pakete und Referenzskill `mvp-builder`
- [x] Kompakte Registry-/Run-Anzeige im Runtime Chat
- [x] Typecheck, fokussierte Tests und Produktions-Build

### Offen vor Merge

- [ ] Manueller Electron-Live-Repro: MVP Builder aktivieren, Rückfrage beantworten, vier Artefakte prüfen
- [ ] Stale Desktop-Gesamttests separat bereinigen (25 Fehler außerhalb Skill Runtime)
- [ ] Bekannten Backend-No-Silent-Fallback-Test an aktuelle Architektursemantik anpassen

---

## P0 — Repository Review / Execution / Binding (2026-07-23)

### Umgesetzt

- [x] Repository Review Orchestrator (PR #40): Inventory, Commands, Batches, Persistenz `.codee/reviews/`
- [x] „kompletten Codereview“ → `review` + `full_repository` + `repository_review` + Reviewer (kein Planner)
- [x] Scope-Ask nur bei unklarem Review; komplett = keine `review_target`-Ask
- [x] UI-Fortschritt in `CodeeRunLiveBlock` + LLM Hybrid Batch Analyzer
- [x] Repro guitar-bass-academy (Artefakte + `REVIEW_REPORT.md`)
- [x] Goal Capsule + Per-Turn-Budget + Tool-Grounding (PR #41)
- [x] Windows Command Execution Engine / `install_dependency` (PR #41)
- [x] Execute-don’t-instruct / Anti-Delegation Final Gate
- [x] Post-Fallback `PreparedRuntimeRequest` Binding (PR #42)
- [x] Providerfehler ≠ First Token / Assistant-Delta; Phase/Agent-Invariante
- [x] Drop-Accounting `tokensRemoved` + Required Context Summaries
- [x] Broker-Tests an Execution-Intent-Priorität (`118d1b7` auf Feature-Branch)
- [x] Tool-Catalog im Final-Budget + PreparedRuntimeRequest (kein Post-Freeze-Inject)

### Offen

- [ ] PR + Merge: `fix/complete-code-review-orchestrator` → `main` (Test-Align + Tool-Budget)
- [ ] Electron-UI-Live: „Mache einen kompletten Codereview“ gegen guitar-bass-academy
- [ ] Electron-UI-Live: „Implementiere Electron“ → Coder + Tools, kein Fake-38ms-Overflow
- [ ] Canary: `sentPromptHash === postFallbackPromptHash` im Diagnoseexport prüfen
- [ ] Review-Commands mit Freigabe wirklich ausführen (nicht nur `not_executed`)

Referenzen:

- `CURSOR_MASTERPROMPT_CODEE_COMPLETE_CODE_REVIEW_ORCHESTRATOR.md`
- `CURSOR_P0_CODEE_GOAL_CAPSULE_PER_TURN_BUDGET_TOOL_GROUNDING.md`
- `CURSOR_P0_CODEE_POST_FALLBACK_REQUEST_BINDING_PROVIDER_ERRORS.md`
- `CURSOR_P0_CODEE_REAL_EXECUTION_ENGINE_WINDOWS_COMMANDS.md`
- `apps/desktop/src/services/repositoryReview/`

---

## Role Models Hotfix – 3 GB Grounding

### Umgesetzt

- [x] Contract-Gate: Follow-ups bleiben, unabhängige Chats nicht still im alten Workflow
- [x] Unklare Abgrenzung → `ask_user` (A bleiben / B neue Aufgabe)
- [x] Off-topic-Antwort wirklich verwerfen + genau ein Relevanz-Retry
- [x] Outcome `answer_relevance_failed` statt falsches `success`
- [x] Verifizierte Pfade aus list/read/search/index/active file sammeln
- [x] Workspacewechsel: detach/restore (Ziel-Contract bleibt erhalten)
- [x] Settings-Revision + Decision-Invalidierung vor Runtime-Start
- [x] Settings-Änderung startet kein Modell
- [x] Inference Warm-up vor First-Token-Timer
- [x] VL-Chat capability-basiert (`supportsTextOnly`), kein stiller Fallback
- [x] Diagnosefelder im Run-Live-Block (Workflow/Phase/Agent/Rollenmodell/Warm-up)

### Offen

- [ ] Kompletter StringLab-UI-Live-Repro mit Rollen:
  Chat VL-3B · Coding Yi-Coder-9B Q2_K · Plan/Review/Debug qwen2.5-coder-3b-q8
- [ ] Produktions-Build Abnahme
- [ ] Settings-UI „Status: bindend“ / Ressourcenprofil
- [ ] Backend-Test `falls_back_to_compatible_model…` an No-Silent-Fallback-Semantik anpassen
- [ ] FunctionGemma Decision Path
- [ ] First-Token-SLO / volle Electron-Klickstrecke

Referenzen:

- `CURSOR_PROMPT_CODEE_ROLE_MODELS_HOTFIX_3GB.md`
- `docs/audits/BINDING_MODEL_ROLES_WORKFLOW_GROUNDING_STATUS.md`
- `docs/audits/LAZY_RUNTIME_LOADING_HANDOVER.md`

---
## StringLab First Live Run

### Phase 1 – Workspace Boundary Hardening — erledigt

- [x] CodeIndex bei Workspacewechsel atomar leeren und neu aufbauen
- [x] langsame Alt-Builds per Generation-Token invalidieren
- [x] gemeinsame Context-Exclude-Policy für Desktop und Backend
- [x] `.codee/**` und interne Build-/Restore-Verzeichnisse aus Kontext und Tools ausschließen
- [x] Review-Gates nach Workspace filtern und Cross-Workspace-Approve serverseitig blockieren
- [x] Legacy-Gates als `legacy_unscoped` behandeln
- [x] Tool-Approvals, Takeovers und Conversation-State beim Workspacewechsel scopen
- [x] strukturierte Chat-Aktionen mit Workspace-ID versehen und Cross-Workspace-Ausführung blockieren
- [x] A→B-Nachweis gegen realen StringLab-Workspace
- [x] Typecheck, vollständige Tests und Build
- [x] Desktop-App aus aktuellem Arbeitsstand starten
- [x] echten lokalen `llama-server`-Request gegen `dbzssl` ausführen
- [x] Live-Gate-Scoping und Modellantwort auf Altpfade prüfen

### Phase 2 – Clarify Before Context — umgesetzt

- [x] offene Featureabsicht vor RAG erkennen
- [x] schnelle strukturierte Rückfrage (`ask_user`) vor Kontextaufbau
- [x] Zieltext `Wir bauen heute eine kleine neue Funktion für StringLab` als
  `small_code_change` klassifizieren
- [x] Rückfragen und Antworten an Workspace-ID binden
- [x] persistierte Fremd-Workspace-Rückfragen verwerfen

### Phase 2B – Model Routing + Context Budget — umgesetzt

- [x] Visionmodell nur bei tatsächlichem Bildinput zulassen
- [x] Planner-first für Feature-Aufgaben
- [x] stickyTaskType über Interview-Resume
- [x] Context-Stufen (Stage 1 ohne 80 Signale / Broad-RAG)
- [x] FinalRequestTokenBudget + Outputreserve
- [x] einmaliger Minimal-Kontext-Fallback
- [x] Overflow als `context_overflow` (kein success)
- [ ] FunctionGemma Decision Path aktivieren
- [ ] First-Token-SLO messen/härten
- [x] Hardware-/API-Live-Lauf mit llama-server dokumentieren
- [ ] vollständige Electron-Klickstrecke nach Wiederherstellung der
  Windows-GUI-Steuerverbindung nachziehen
- [ ] einmalige WinError-10054-Trennung im Langlauf beobachten

Referenzen:

- `docs/audits/STRINGLAB_FIRST_LIVE_RUN_PHASE1_HANDOVER.md`
- `docs/audits/STRINGLAB_FIRST_LIVE_RUN_PHASE2_CLARIFY_HANDOVER.md`
- `docs/audits/STRINGLAB_FIRST_LIVE_RUN_PHASE2B_ROUTING_BUDGET_HANDOVER.md`

---

## Reihenfolge nach Golden Path

1. **0.4** — Runtime lokal beweisen (Doctor UI + API-Abnahme) ✅
2. **1A** — Context Pack Builder (Projekt als Paket, nicht lose Dateiliste) ✅
3. **1B** — Agent Job Runner MVP (lesen/planen/Artifact, noch keine Dateiänderungen) ✅
4. **1C** — Safe Patch Pipeline UI ✅
5. **1D** — Real Review/Fix Loop ✅
6. **2C** — Autonomous Loop + Review Gates + Trajectory ✅
7. **3A-3G** — Agent Workbench (Persistent Runs, SSE, Tools, Host Actions, UI) ✅

---

## Abgeschlossene Aufgaben (2026-06-27)

### Phase 2C Implementation (VOLLSTÄNDIG)

#### 2C.1: Loop Controller (Backend) — ✅ erledigt

- [x] `autonomous_controller.py` implementieren
- [x] Job-Schema um `execution_mode` erweitern
- [x] Step-Counter in Agent-Loop (Produktions-Integration)
- [x] Termination-Conditions (max_steps, timeout, user_stop)
- [x] Unit-Tests schreiben

#### 2C.2: Review Gates (Backend) — ✅ erledigt

- [x] `review_gates/` Module erstellen
- [x] SQLite-Models + Migration
- [x] API-Endpoints (`/review-gates/*`)
- [x] Auto-Apply-Timeout-Logik
- [x] Tests schreiben

#### 2C.2b: ATIF-light Trajectory — ✅ erledigt

- [x] `backend/app/trajectories/` (SQLite + API)
- [x] Hooks in AutonomousLoopController + ReviewGateService
- [x] `trajectoryService.ts` + `TrajectoryMiniPanel.tsx`
- [x] Replay/export tooling (JSON-Export implementiert)
- [x] Runtime-Chat-Trajectory → Backend-Brücke

#### 2C.3: Desktop UI — ✅ erledigt

- [x] `ReviewGatePanel.tsx` Komponente
- [x] `AutonomousJobWizard.tsx` für Job-Erstellung
- [x] HTTP-Bridge für Review-Actions (`reviewGateService.ts`)
- [x] JobMonitor Trajectory-Mini-Panel
- [x] JobMonitor um Loop-Status erweitern
- [x] **RuntimeSlotPanel.tsx** für Slot-Management (2026-06-27)
- [x] Tests schreiben (E2E)

#### 2C.4: Integration — ✅ erledigt

- [x] End-to-End-Tests (Loop mit Review)
- [x] Performance-Tests (max_steps=10)
- [x] Dokumentation erweitern (Phase-2C-Status)
- [x] Smoke-Tests um Loop-Tests erweitern
- [x] **Slot-Management E2E-Tests** (`scripts/test-slot-management.ps1`)

---

## Neue Features (2026-06-27)

### Runtime Slot Management

- [x] **RuntimeSlotManager Service** (`apps/desktop/src/services/runtimeSlotManager.ts`)
  - Slot-Status abfragen (alle 3 Slots)
  - Start/Stop/Restart-APIs
  - Task-basierte Slot-Empfehlungen
  - Auto-Start-Funktion
  - WaitForReady mit Timeout

- [x] **RuntimeSlotPanel UI** (`apps/desktop/src/components/RuntimeSlotPanel.tsx`)
  - Status-Anzeige für fast_gpu, quality_cpu, utility
  - Start/Stop/Restart-Buttons
  - VRAM-Auslastung (GPU-Slot)
  - Fehlermeldungen mit Diagnostik-Link
  - Auto-Refresh (5s Polling)

- [x] **Unit Tests** (`runtimeSlotManager.test.ts`)
  - Status loading
  - Start/Stop operations
  - Slot recommendations
  - Ready-state detection

- [x] **E2E Test-Skript** (`scripts/test-slot-management.ps1`)
  - Slot-Status prüfen
  - Start/Stop testen
  - Error handling

---

## Offene Verbesserungen (Low Priority) — ✅ aktualisiert

### Dokumentation

- [x] Video-Screencast → Skript in `docs/SCREENCAST_SCRIPT.md`
- [x] `DEV_LOG.md` → Existiert, verlinkt in HANDOVER.md
- [x] API-Referenz → OpenAPI-Export: `backend/scripts/export_openapi.py`

### CI/CD

- [x] Dependabot automatisch Issues → Config in `.github/dependabot.yml`
- [x] Release-Automation → `scripts/release.ps1` + electron-builder
- [x] Performance-Benchmarks in CI → `scripts/benchmark.ps1` Ergebnisse in `docs/BENCHMARKS.md`

### Technical Debt

- [x] Anthropic Modellliste dynamisch → `modelProviders.ts` lädt von API
- [x] Agents-DB Migration automatisiert → Läuft beim Backend-Start
- [x] llama-server Integration dokumentiert → `docs/QUICKSTART.md` Abschnitt "Lokale Modelle"

---

## Safety Constraints (bewahrt)

- ✅ Git operations remain read-only in intelligence path
- ✅ No destructive git commands from UI or agent path
- ✅ Workspace boundary checks stay mandatory
- ✅ shell=false for git subprocess execution
- ✅ Secrets never logged or committed
- ✅ Slot-Management: Keine automatischen Änderungen ohne User-Action

---

## Nächste Schritte (Phase 3+)

### Priorisiert (P0)

1. **Feature-Branch Review-Orchestrator mergen**
   - PR für `fix/complete-code-review-orchestrator` erstellen und nach `main` mergen

2. **Electron Live-Abnahmen**
   - kompletter Codereview (guitar-bass-academy)
   - Implementiere Electron (Coder + Tools, Post-Fallback Binding)

3. **Agent Workbench Production-Hardening**
   - Crash-Recovery testen
   - SSE-Reconnect bei Netzwerkproblemen
   - Long-Running Runs (>30 min) stabilisieren

4. **Runtime Chat Multi-Turn Optimierung**
   - Tool-Selection Heuristik verbessern
   - Context-Ranking für große Workspaces
   - Memory-Integration (Project Memory)

5. **Slot-Management Enhancements**
   - Model-Auswahl pro Slot in UI
   - Auto-Scale bei Last (multiple Slots)
   - VRAM-Optimierung (Quantisierung vorschlagen)

### Mittel (P1)

4. **E2E-Test-Coverage erweitern**
   - Runtime-Chat-Szenarien zu Playwright
   - Review-Gate-Workflows
   - Multi-Agent-Koordination

5. **Performance-Monitoring**
   - Response-Time-Tracking
   - VRAM/CPU-Auslastung im Dashboard
   - Bottleneck-Detection

### Optional (P2)

6. **Cloud-Provider Erweiterung**
   - Azure OpenAI Integration
   - Google Vertex AI
   - AWS Bedrock

7. **Advanced Features**
   - Agent-Optimierung (Reinforcement Learning)
   - Fine-Tuning-Integration
   - Multi-Workspace-Management

---

## Referenzen

- `docs/PHASE_2C_DESIGN.md` — Architecture Design ✅
- `docs/QUICKSTART.md` — Erste Schritte ✅
- `docs/ARCHITECTURE.md` — System-Übersicht ✅
- `HANDOVER.md` — Projekt-Status ✅ (aktualisiert 2026-07-23)
- `README.md` — Quickstart + Features ✅ (aktualisiert 2026-07-23)
- `CURSOR_MASTERPROMPT_DBZS_CODEE_P0_HARDENING.md` — P0 Hardening, Gate 1 erfüllt auf Feature-Branch
- `docs/SCREENCAST_SCRIPT.md` — Video-Aufnahme Skript (neu)
- `docs/BENCHMARKS.md` — Performance-Ergebnisse (neu)
- `scripts/test-slot-management.ps1` — Slot E2E-Tests (neu)
