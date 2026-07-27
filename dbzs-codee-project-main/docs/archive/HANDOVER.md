# HANDOVER — DBZS Codee

Stand: 2026-07-23
Repo: `devdbzemusic/dbzs-codee-project` (public)  
Aktueller Arbeitsbranch: `feat/context-intelligence-rc-hardening`  
Offener PR: [#51](https://github.com/devdbzemusic/dbzs-codee-project/pull/51) — Context Budget + Capability Gate 1  
Ausgangsbasis: `origin/main`  
Version: `0.4.0-rc.1`
Scope: P0 Integration Hardening (Gate 1), Context Intelligence RC, Skill Runtime V1

ToDo-Liste: `LATER_TODO.MD`

---

## P0 Integration Hardening — Gate 1 erfüllt (2026-07-23)

Branch `feat/context-intelligence-rc-hardening` / PR #51. Master-Prompt:
`CURSOR_MASTERPROMPT_DBZS_CODEE_P0_HARDENING.md`.

### Umgesetzt

- **Context Budget:** `repositoryTokens` bleibt Allokation; Verbrauch als `repositoryTokensUsed`
  (`packages/shared`, `contextBudgetManager.ts`, 3 Unit-Tests).
- **Capability Suite:** Harness an Broker-, Slot-, Clarification- und Tool-Parser-Vertrag
  angeglichen; **30/30 Szenarien grün** (31 Tests inkl. Report).
- **CI Required-Gates:** Capability-Suite verpflichtend mit `RUN_CAPABILITY_SUITE=1` in
  `.github/workflows/ci.yml`.
- **Lokales CI:** `pnpm ci:local` (Linux/macOS/Cloud) und `pnpm ci:local:win` (Windows)
  spiegeln GitHub `required-gates` (`scripts/ci-local.sh` / `scripts/ci-local.ps1`).

### Gate-1-Nachweise (lokal, 2026-07-23)

| Gate | Ergebnis |
|------|----------|
| `pnpm typecheck` | grün |
| Shared Tests | 9/9 |
| Desktop Tests | 813 passed, 36 skipped |
| Capability Suite | **31/31** (`RUN_CAPABILITY_SUITE=1`) |
| Backend pytest | 344/344 |
| `pnpm build` | grün |
| Packaging smoke | grün |
| Security regression | 14/14 |
| Backend smoke + doctor | grün (7/7) |
| `pnpm audit --prod` | keine bekannten Schwachstellen |
| `pnpm ci:local` | vollständiger Required-Gates-Lauf grün |

### Bewusst noch nicht gestartet (Master-Prompt)

Phase 2–6 (Security-Migration, Build-Heap, Docs, ADR, Modul-Split) bleiben gesperrt,
bis Gate 1 auf `main` gemergt und CI auf beiden OS-Matrizen grün ist.

---

## Review UX/Qualität und Fix-Findings — lokal implementiert (2026-07-23)

- Review-Schema V2 mit kanonischen Outcomes, V1-Lademigration, Finding-Provenienz und
  persistierter Analyzer-/Qualitätsdiagnostik.
- Fachbereichsspezifische LLM-Batches, genau ein strukturierter Repair-Turn und
  sichtbarer Heuristik-Fallback; Batch-Titel und Splits sind deterministisch.
- Production-Readiness-Score wird bei niedriger Confidence oder rein heuristischer
  Analyse unterdrückt.
- Der falsche 20-Sekunden-Stall-Alarm wurde entfernt. Die UI zeigt reale Laufzeit,
  Batchfortschritt, Checks, LLM-/Heuristikanteil, Severity, Top-Findings und Warnungen.
- Review-Artefakte sind über typisierte, workspace-gebundene IPC-Aufrufe sowie den
  virtuellen Explorer-Bereich `CODEE ARTEFAKTE / Reviews` erreichbar. `.codee` bleibt
  aus normalem Source-Scan, RAG und Review-Batches ausgeschlossen.
- `fix findings` nutzt `review_remediation`: strukturierte Review-/Scope-Auswahl,
  P0–P2 als Empfehlung, nicht droppbare Capsule und Planner → Coder → Reviewer.
  Source-Writes bleiben bis zur Planfreigabe gesperrt; das originale `findings.json`
  wird nicht verändert.
- Die Diagnose-Runs `run-mrx99prx-4i17` und `run-mrxa06mg-e61r` liegen als kleine,
  redigierte Test-Fixtures vor. Lokale `.codee`-Diagnosen wurden nicht versioniert.

Nachweise:

- Shared-/Desktop-Typecheck: grün.
- Review-/Remediation-/IPC-/UI-Fokustests: 40/40 grün.
- Vollsuite: bekannte Baseline-Fehler bei Timeout-Erwartungen, Rollenmodell-Fixtures
  und Runtime-Slot-Mocks; keine davon stammt aus den neuen Review-Fokustests.
- Manueller Electron-Repro gegen `guitar-bass-academy` bleibt offen, weil der
  Test-Workspace laut Auftrag nicht verändert werden darf.

---

## Skill Runtime V1 — implementiert auf Feature-Branch (2026-07-23)

- Versionierte, strikt validierte `manifest.yaml`-/`SKILL.md`-/`README.md`-Pakete.
- Registry-Priorität Workspace → User → Bundled mit sichtbaren Overrides und isolierten Ladefehlern.
- Sicherer Ordnerimport nach `<UserData>/skills`; keine ZIPs, Symlinks oder Paketcode-Ausführung.
- Resolver für Intent, Keywords, Preconditions, Risiko, Konflikte, Komposition und Zielagent.
- Kompakte Skill Capsules statt vollständiger Promptinjektion; Goal/User/Task bleiben höher priorisiert.
- Technische Tool-Schnittmenge bis in Exposure, Provider-Payload, PermissionManager und Executor.
- Kontrolliertes `write_skill_artifact` nur unter `.codee/skill-runs/<id>/artifacts/`, Freigabe einmal pro Run.
- Persistente Runs, Snapshots, Resume/Cancel, Events, Metriken und ehrlicher Policy-Violation-Outcome.
- Bestehende Built-ins migriert; `mvp-builder` als Referenzintegration mit vier validierten Artefakten.
- Minimale Registry-/Run-UI im Runtime Chat.

Nachweise:

- Typecheck Shared + Desktop: grün.
- Skill-/Loader-/Run-/Tool-/UI-Fokustests: 35/35 grün.
- Produktions-Build: grün.
- Backend: 341/342 grün; bekannter No-Silent-Fallback-Alttest bleibt rot.
- Vollständige Desktop-Suite: 752 bestanden, 36 übersprungen, 25 bekannte/stale Regressionstests rot
  (Rollenmodell-Fixtures, Timeout-Erwartungen, RuntimeSlot-Mock; nicht Skill-Runtime-spezifisch).

---

## Aktueller Stand — Juli 2026 Hotfixes auf `main` (2026-07-23)

Auf `main` gemergt (Reihenfolge):

| PR | Thema | Merge |
|----|--------|-------|
| #40 | Repository Review Orchestrator (kompletter Codereview) | `6d293e8` / Feature `16b47f6` |
| #41 | Goal Capsule + Per-Turn-Budget + Tool Grounding + Windows Commands | `78ff2fd` / `4056e75` |
| #42 | Post-Fallback Request Binding + Provider-Fehlerkanal | `77d9009` / `b9156ff` |

Zusätzlich auf Branch `fix/complete-code-review-orchestrator` (gepusht, **PR/Merge offen**):

- `118d1b7` — Broker-Tests an Execution-Intent-Priorität angeglichen

### Repository Review Orchestrator (P0) — erledigt

Phrase „Mache einen kompletten Codereview“:

- Intent-Alias `code_review`, Workflow `repository_review`, Agent `reviewer`, Scope `full_repository`
- Keine Scope-Ask bei komplettem Review; unklarer Scope → A–D `single_choice`
- Desktop-Orchestrator unter `apps/desktop/src/services/repositoryReview/`
- Artefakte nur unter `<workspace>/.codee/reviews/<reviewId>/` (kein Zielcode)
- UI-Block in `CodeeRunLiveBlock`; LLM-Batches via Hybrid Analyzer + `defaultReviewerModelId`

Repro `guitar-bass-academy`: Batches `9/9`, Outcome `completed_with_skipped_checks`,
`REVIEW_REPORT.md` + Inventory/Plan/Findings vorhanden. Vitest Review+Broker 44/44, Typecheck grün.

Prompt: `CURSOR_MASTERPROMPT_CODEE_COMPLETE_CODE_REVIEW_ORCHESTRATOR.md`

### Goal Capsule / Tool Grounding / Windows Commands — erledigt (PR #41)

- Goal Capsule P0-non-droppable, Per-Turn-Budget, Tool-Grounding, Execute-don’t-instruct
- Windows-Command-Runner (`ComSpec`), `install_dependency`, ehrliche CPU/GPU-Anzeige

### Post-Fallback Request Binding — erledigt (PR #42)

- `PreparedRuntimeRequest` eingefroren; nur Post-Fallback an Provider
- Providerfehler nicht als First-Token/Assistant-Delta; Phase/Agent-Invariante
- Drop-Accounting mit `tokensRemoved`; Required Context Summaries

### Tool-Payload im Final-Budget (lokal, unmerged)

Diagnose `run-mrx6n0lt-9zct`: Binding OK, aber voller `[Tool Catalog]` wurde **nach** Freeze
injiziert → Client-Budget unterzählte Tools. Fix: `providerToolBudget` zählt/friert den
echten Tool-Payload vor dem Provider-Call; Runner injiziert Katalog nicht doppelt;
Diagnostik meldet `sentToolTokens` / `toolBodyBytes` / `protocolMode`.

### Noch offen (kurz)

- [ ] PR für `fix/complete-code-review-orchestrator` → Merge nach `main` (Test-Align + Tool-Budget)
- [ ] UI-Live-Repro: kompletter Codereview in Electron gegen `guitar-bass-academy`
- [ ] UI-Live-Repro: „Implementiere Electron“ erreicht Coder + Tools (kein Fake-Overflow)
- [ ] StringLab Rollenmodelle Live-Abnahme / Produktions-Build
- [ ] FunctionGemma Decision Path; First-Token-SLO / Electron-Klickstrecke

---

## Role Models Hotfix – 3 GB Grounding (2026-07-23)

Nach PR #32–#34 (`0c8fafc` auf `main`) behebt dieser Hotfix die offenen Review-Funde
für bindende ~3,1‑GB-Rollenmodelle, Workflow-Grenzen, echtes Relevanz-Retry und
Inference-Warm-up.

Umgesetzt:

- ActiveTaskContract verschluckt keine unabhängigen Chatfragen mehr; Unklarheit → `ask_user` A/B
- Off-topic-Antworten (Rig Grid / Tuner / …) werden verworfen, einmal neu generiert, sonst `answer_relevance_failed`
- Verifizierte Workspace-Pfade werden aus Tools/Index/aktiver Datei gesammelt (`verifiedWorkspaceEvidence.ts`)
- Workspacewechsel: `detach`/`restore` statt Clear beider Contracts
- Settings-Revision invalidiert veraltete BindingDecisions vor Runtime-Start (kein Autostart)
- Mini-Inference-Warm-up vor First-Token; Fail ohne stillen Modellwechsel (Optionen A/B/C)
- VL-Chat: `supportsTextOnly` capability-basiert, kein stiller Fallback

Nachweis: Desktop typecheck grün; Services/Store-Tests grün. Backend-Test
`falls_back_to_compatible_model…` bleibt bewusst rot (kein stiller Architektur-Fallback, PR #34).

Noch offen: kompletter UI-Live-Repro StringLab mit den konfigurierten 3,1‑GB-Rollenmodellen,
Produktions-Build, Settings-UI „Status: bindend“.

Prompt: `CURSOR_PROMPT_CODEE_ROLE_MODELS_HOTFIX_3GB.md`

---

## Binding Model Roles + Lazy Runtime (main, 2026-07-22)

Auf `main` gemergt:

- PR #32 Model Routing + Context Budget
- PR #33 Lazy Runtime Loading (Arbeitsmodelle erst nach Message → Preflight → Broker → Budget)
- PR #34 Binding Role Models + Workflow Grounding

Lazy Loading und bindende Rollenmodelle bleiben aktiv; dieser Hotfix baut darauf auf.

---

## StringLab First Live Run – Phase 2B / Model Routing + Context Budget (2026-07-22)

Vision-Gate, Planner-first, Context-Stufen und hartes Final-Request-Tokenbudget sind
auf diesem Branch umgesetzt. Overflow endet als `context_overflow` (kein Erfolg).
Details: `docs/audits/STRINGLAB_FIRST_LIVE_RUN_PHASE2B_ROUTING_BUDGET_HANDOVER.md`.

Noch offen: FunctionGemma Decision Path, First-Token-SLO, Live-Repro gegen dbzssl.

---

## StringLab First Live Run – Phase 2 / Clarify Before Context (2026-07-22)

Der erste kleine Phase-2-Folge-PR ist umgesetzt. Offene Featureabsichten werden vor
Runtime-Check, Slot-Routing, Workspace-Sampling, Context-Orchestrierung und RAG erkannt.
Codee stellt dafür eine strukturierte, workspace-gebundene `ask_user`-Rückfrage und
setzt den normalen Lauf erst nach der Antwort fort.

Der reale Zieltext `Wir bauen heute eine kleine neue Funktion für StringLab` wird
nicht mehr als `casual_chat`, sondern als `small_code_change` klassifiziert. Die erste
Antwort lautet jetzt `Welche konkrete Funktion soll StringLab bekommen?`; bis dahin
werden weder Runtime noch Context- oder Retrieval-Dienste aufgerufen.

Das bestehende Interview-/Rückfragesystem wurde aus den vier bereits vorbereiteten
Commits integriert und mit den Workspace-Grenzen aus Phase 1 zusammengeführt.
Persistierte Rückfragen mit fremdem Workspace sowie Cross-Workspace-Antworten werden
verworfen bzw. abgelehnt.

Nachweis: Shared 9/9, Desktop 618 bestanden/36 übersprungen, Backend 333/333,
Typecheck und Produktions-Build grün. Details:
`docs/audits/STRINGLAB_FIRST_LIVE_RUN_PHASE2_CLARIFY_HANDOVER.md`.

Weitere Phase-2-Themen bleiben getrennt offen: FunctionGemma Decision Path
sowie First-Token-SLO / volle Electron-Klickstrecke.

---

## StringLab First Live Run – Phase 1 (2026-07-22)

Workspace Boundary Hardening ist implementiert: CodeIndex-Builds sind
generationsgesichert, die gemeinsame Context-Policy schließt interne Verzeichnisse in
Desktop und Backend aus, Review-Gates sowie Tool-, Takeover- und strukturierte
Runtime-Chat-Approvals sind workspace-spezifisch,
und ein Workspacewechsel leert bzw. verwirft alte Conversation-/Approval-Aktionen.

Nachweis: Shared 9/9, Desktop 563 bestanden/36 übersprungen, Backend 333/333,
Typecheck und Build grün. Der isolierte A→B-Lauf gegen den realen Workspace
`C:\Users\ralle\source\repos\dbzssl` enthielt weder `.codee` noch `src/test_file.py`.

Hardware-/Runtime-Abnahme: Electron wurde aus dem Arbeitsstand gestartet. Nach einem
notwendigen Neustart des zuvor noch laufenden Alt-Backends lieferte die gescopte
`dbzssl`-Gate-Abfrage 0 Treffer; zwei `src/test_file.py`-Gates blieben korrekt nur
global und ihren temporären Fremd-Workspaces zugeordnet. Der echte lokale
Qwen2.5-Coder-7B-Lauf über `llama-server` antwortete ohne Altpfade nach 9,557 s mit
dem ersten Token und war nach 12,498 s abgeschlossen. Die vollständige automatisierte
Electron-Klickstrecke blieb mangels verfügbarer Windows-GUI-Steuerverbindung offen.
Ein 6.271-Token-UI-Request gegen den 4.096er Slot und eine einmalige
WinError-10054-Recovery sind als Phase-2-/Langlaufbefunde dokumentiert.

Vollständige Übergabe: `docs/audits/STRINGLAB_FIRST_LIVE_RUN_PHASE1_HANDOVER.md`.
Phase 2 wurde ausdrücklich nicht vorgezogen.

---

## PR #27 Final Merge Hardening (2026-07-13)

Der geprüfte Implementierungs-Head ist `d34a49e`. Die vier letzten Merge-Blocker
(Command-Pfade, Resume-Baseline, Context-Pfade und RAG-/Orchestrator-Duplikate) sind
geschlossen. Model Certification führt reale Runtime-Fälle aus. Lokal sind Shared 5/5,
Desktop 553, Backend 311 und Playwright 40/40 grün. Ubuntu-, Windows- und Playwright-
Required-Gates sind ebenfalls grün; nach fachlicher Einzelbearbeitung sind 0 Review-
Threads ungelöst.

Verbindliche Arbeitsgrundlagen:

- `docs/audits/PR27_FINAL_MERGE_BLOCKER_PLAN.md`
- `TODO-PR27.md`
- `CODEX_PROMPT_PR27_74_ZU_75_MERGE_READY.md` als lokale, unversionierte Quelle

Erreichter Status: `77/100 — PARTIAL / Merge Ready / RC Hardening`.
`Production Ready` und ein RC-Tag bleiben ohne Installer-, Modell-, Utility- und
Hardware-Live-Gates ausdrücklich ausgeschlossen.

---

## 1. Kurzfassung

Das Repository ist von einem **Integrationsbruch-Stand** (Phase 0) zu einem weitgehend real implementierten AI-Desktop-System gewachsen. Der ehrliche Status ist `PARTIAL`: die Kernpfade sind automatisiert getestet, Live-Modell- und manuelle E2E-Gates bleiben explizit offen.

- Build, Typecheck, Tests und lokale Smoke-Gates sind grün, soweit zuletzt ausgeführt.
- Electron startet **sofort mit Fenster**, Backend startet asynchron danach.
- **Mission Control** liefert beim Start Orientierung (Backend, Workspace, Modelle, Runtime, Jobs, GPU).
- **Alle vier LLM-Provider** sind benutzbar: llama.cpp (lokal via Backend-Proxy), Ollama (direkt), OpenAI (HTTPS), Anthropic (HTTPS mit kuratierter Modellliste).
- **Cloud-Fallback** aktiv: Agent-Runner und Agent-Loop weichen bei offline-Runtime auf Anthropic/OpenAI aus (konfigurierbar via `cloudModelsEnabled`).
- **Phase 3G+ Features:** Automatic Multi-Model CPU/GPU Slot Handling. Hardware-Zuordnung ist lokal konfigurationsabhängig und wird über Doctor/Runtime-Status verifiziert.
- **Task-Routing & VRAM-Fitting:** Automatische Routing-Entscheidung (Chat zu CPU, Coding/Review/Plan/Debug zu GPU) und VRAM-Fit-Echzeit-Estimation (Limit max 4096 MB inkl. 512 MB Reserve) verhindern GPU-Überlastung.
- **Runtime Slot Management (2026-06-27):** Vollständige UI zur Slot-Verwaltung mit Auto-Start, Status-Monitoring, VRAM-Anzeige und Diagnostik.
- **Dual Runtime Bootstrap (2026-07-03):** Desktop-Start zielt jetzt auf zwei primäre lokale Runtimes ab: `quality_cpu:8081` für Chat und `fast_gpu:8082` für Coding/Review/Plan/Debug. `utility` bleibt bedarfsgetrieben, und beim App-Ende werden die vom Desktop verwalteten Runtimes über `stopDesktopRuntimesOnExit` sauber beendet.
- **Runtime Cache / Context Spooler (2026-07-03):** Runtime-Residency, adaptive GPU-Layer-Planung und Context-Spooler sind vorhanden; der Cache-Button im UI ist jetzt präziser als Kontext-Cache benannt.
- **Coding Capability Hardening (2026-07-01):** Runtime-Abort-Spine, request-scoped Routing/Fallback, deterministische Repo-Map, Safe-Patch-Limits und Offline-Coding-Loop-Acceptance sind umgesetzt.
- **Frontend-Restart nach Modellwechsel (2026-07-12):** Erfolgreich gespeicherte Änderungen am Standardmodell lösen einen verzögerten, cachefreien Electron-Renderer-Reload aus; zusätzlich steht in den Settings ein manueller Restart-Button bereit. Fehlgeschlagene Settings-Saves lösen keinen Reload aus.
- **Desktop-Build bereinigt (2026-07-12):** Vier wirkungslose gemischte statische/dynamische Imports wurden vereinheitlicht. Der Produktions-Build läuft ohne die vorherigen Vite-Chunk-Warnungen.
- **Dependency-Security (2026-07-12):** `dompurify` ist auf `3.4.12`, der betroffene Vite-`esbuild`-Pfad auf `0.28.1` fixiert. Audit: keine moderaten, hohen oder kritischen Findings; ein niedriges Dev-only-Finding für `@babel/core 7.29.0` bleibt offen, da die vom Advisory genannte Fixversion `7.29.1` noch nicht veröffentlicht ist.
- **Repository-RAG / sichere Execution Trace (2026-07-12):** FastAPI/SQLite-Index mit inkrementellen Hash-Updates, Ignore-/Secret-Regeln, Symbol-Chunks, FTS5/BM25, optionalem Embedding-Cache, Retrieval Manifest und Source References. Der Runtime Chat führt Treffer über eine eigene Spooler-Lane und zeigt eine deterministische Ereignisspur statt Modell-CoT.
- **RC-Integrationslinie (2026-07-12):** `release/0.4.0-rc.1` basiert auf `origin/main` (`04b1993`). PR #22 wurde nur für Conversation Control übernommen; dessen gemischter Abschlusscommit mit älteren Runtime-Änderungen wurde verworfen. PR #23 wurde commitweise als Runtime-/Context-/RAG-Grundlage integriert.
- **Security Foundation:** Kanonische Workspace-Pfadwächter für Desktop und Backend, argumentbasierter Windows-Prozessabbruch, begrenzte Command-Logs und gemeinsame Trace-Secret-Redaction sind vorhanden.
- **Antigravity optional:** Der Vendor-SDK-Baum wurde entfernt. `google-antigravity==0.1.6` ist eine optionale Gruppe; SDK-Built-ins sind durch `deny_all` blockiert und fehlen im Standard-RC-Bundle.
- **RC-CI:** Vollständige Backend-Tests, bindende E2E-/Audit-Gates, Security-, Release- und manuelle Live-Runtime-Workflows sind angelegt.

**Aktuelle Gates (2026-07-12):**

```powershell
pnpm typecheck      # OK
pnpm test           # Shared/Desktop grün; Backend 285/285
pnpm build          # OK
pnpm doctor:all     # OK, lokale Warnungen möglich
pnpm smoke-test     # OK
pnpm test:coding-loop # OK
pnpm test:capabilities # OK; Desktop-Capability-Suite ist projektseitig opt-in/skipped
pnpm audit          # 1 low (Dev-only Babel); 0 moderate/high/critical
```

---

## 2. Phasen-Übersicht

| Phase | Commit / Thema | Status |
|-------|----------------|--------|
| **0** | Stabilisierung (Preload, Index, Runtime, Profiles, Config) | ✅ erledigt |
| **0.1** | Job-Spooler IPC-Bridge | ✅ erledigt |
| **0.2** | `doctor.ps1`, `doctor_backend.py`, `LOCAL_ACCEPTANCE.md` | ✅ erledigt |
| **1A** | Agent Runner MVP (`/agent-runner/*`) | ✅ erledigt |
| **1B** | Runtime Doctor API (`/runtime/doctor*`) | ✅ erledigt |
| **1C** | Context Pack (`POST /context-pack/build`) | ✅ erledigt |
| **1D** | Safe Patch Pipeline (Desktop IPC) | ✅ erledigt |
| **2A** | Agent Runner + LLM + Safe Patch (Runtime-Chat, Patch-Artefakte, Job Monitor Apply) | ✅ erledigt |
| **0.3** | Mission Control Cockpit + Browser-Fallback | ✅ erledigt |
| **0.4** | Runtime Acceptance & Golden Path (Doctor UI, `/runtime/logs`, endpoint hardening) | ✅ erledigt |
| **Provider** | Alle 4 Provider benutzbar + Cloud-Fallback (`cea3a93`) | ✅ erledigt |
| **2B** | Command Palette, Toasts, Job-Task-Linking, GPU/Benchmark, SSE, Modell-Download (`19cfd9c`) | ✅ erledigt |
| **Fixes** | agent_logs-Migration, Docs-Workspace, async Backend-Start, Runtime-Chat-Sync, llama.cpp-Warmup, TS-Fixes | ✅ erledigt |
| **2C** | Autonomous Loop Controller, Review Gates, ATIF-light Trajectory | REAL/PARTIAL — automatisiert getestet, Live-Gates offen |
| **3A–3G** | Agent Workbench (persistent runs, SSE worker, tools, host actions, UI) | PARTIAL — API/tests/UI vorhanden, Daily-Use-Live-Abnahme separat |
| **Runtime Chat** | Multi-Turn Agent-Loop, Tool-Profiles (Ask/Agent/Full), Tool-Calls, Trajectory | PARTIAL — integriert, modellabhängig |
| **Slot Management** | zentraler Vertrag quality_cpu:8081, fast_gpu:8082, utility:8083 | PARTIAL — lokale Hardware-/Modellpfade abhängig |
| **Coding Capability Hardening** | Abort-Spine, Repo-Map, Safe Patch Limits, Offline Coding Loop | REAL — automatisiert getestet, Live-LLM-Gate offen |
| **Desktop Restart / Dependency Security** | Renderer-Restart nach Modellwechsel, Import-Bereinigung, pnpm Overrides | REAL — Typecheck, 500 Desktop-Tests, Build und Audit ausgeführt |
| **Repository-RAG / Execution Trace** | SQLite-Index, Hybrid Retrieval, Spooler, Quellen, sichere Trace-UI | REAL/PARTIAL — Kernpfade und gezielte Tests implementiert; vollständiges Live-Modell-E2E bleibt Hardware-Gate |

---

## 3. Runtime Slot Management (Neu 2026-06-27)

### Architektur

DBZS verwendet 3 Runtime-Slots für parallele Modell-Ausführung:

| Slot | Zweck | Default-Modell | Port | Hardware |
|------|-------|----------------|------|----------|
| `quality_cpu` | Chat, allgemeiner Runtime-Fallback | Meta-Llama-3.1-8B-Instruct-Q4_K_M | 8081 | CPU/RAM |
| `fast_gpu` | Coding, Review, Plan, Debug | Llama-3.2-3B-CodeReactor-Q8_0 | 8082 | GPU-preferred |
| `utility` | Hilfsmodelle, Background-Tasks | Qwen3-Embedding-0.6B-Q8_0 | 8083 | CPU/RAM |

### Features

**Backend-APIs:**
- `GET /runtime/slots/{slot_id}/status` — Slot-Status abfragen
- `POST /runtime/slots/{slot_id}/start` — Slot mit Modell starten
- `POST /runtime/slots/{slot_id}/stop` — Slot stoppen
- `POST /runtime/slots/{slot_id}/restart` — Slot neu starten

**Desktop-Services:**
- `runtimeSlotManager.ts` — Service-Layer für Slot-Operationen
- `RuntimeSlotPanel.tsx` — UI-Komponente mit Status, Controls, Diagnostik
- `runtimeSlotManager.test.ts` — Unit Tests für alle Operationen

**UI-Features:**
- ✅ Status-Anzeige (stopped, starting, running, error)
- ✅ Start/Stop/Restart-Buttons pro Slot
- ✅ VRAM-Auslastung (GPU-Slot) mit Fortschrittsbalken
- ✅ Modell-Information (Name, Port, Endpoint, PID)
- ✅ Fehlermeldungen mit Link zu Platform Diagnostics
- ✅ Auto-Refresh (5s Polling)
- ✅ Auto-Start bei Bedarf (konfigurierbar)

**Intelligentes Routing:**
- Chat/Normal → `quality_cpu`
- Coding/Debug/Review/Plan/Architecture → `fast_gpu`
- Strict Routing bleibt Standard; Backend-Fallback greift nicht still auf den CPU-Slot für Coding zurück.

### Dateien

| Datei | Zweck |
|-------|-------|
| `apps/desktop/src/services/runtimeSlotManager.ts` | Service-Layer für Slot-Operationen |
| `apps/desktop/src/services/runtimeSlotManager.test.ts` | Unit Tests |
| `apps/desktop/src/components/RuntimeSlotPanel.tsx` | UI-Komponente |
| `scripts/test-slot-management.ps1` | E2E-Test-Skript |

---

## 4. Phase 2C / Coding Capability Status

### 2C.1: Loop Controller (Backend) — PARTIAL

- [x] `autonomous_controller.py` implementieren
- [x] Job-Schema um `execution_mode` erweitern
- [x] Step-Counter in Agent-Loop (Produktions-Integration)
- [x] Termination-Conditions (max_steps, timeout, user_stop)
- [x] Unit-Tests schreiben
- [ ] Live-Modell-Langlauf dokumentieren

### 2C.2: Review Gates (Backend) — REAL

- [x] `review_gates/` Module erstellen
- [x] SQLite-Models + Migration
- [x] API-Endpoints (`/review-gates/*`)
- [x] Auto-Apply-Timeout-Logik
- [x] Tests schreiben

### 2C.2b: ATIF-light Trajectory — REAL

- [x] `backend/app/trajectories/` (SQLite + API)
- [x] Hooks in AutonomousLoopController + ReviewGateService
- [x] `trajectoryService.ts` + `TrajectoryMiniPanel.tsx`
- [x] Replay/export tooling (JSON-Export implementiert)
- [x] Runtime-Chat-Trajectory → Backend-Brücke

### 2C.3: Desktop UI — PARTIAL

- [x] `ReviewGatePanel.tsx` Komponente
- [x] `AutonomousJobWizard.tsx` für Job-Erstellung
- [x] HTTP-Bridge für Review-Actions (`reviewGateService.ts`)
- [x] JobMonitor Trajectory-Mini-Panel
- [x] JobMonitor um Loop-Status erweitern
- [x] **RuntimeSlotPanel.tsx** für Slot-Management (2026-06-27)
- [x] Tests schreiben (E2E)
- [ ] Aktuelle Playwright-Live-Abnahme mit lokalem Modell dokumentieren

### 2C.4: Integration — PARTIAL

- [x] Offline Coding-Loop-Acceptance (`pnpm test:coding-loop`)
- [x] End-to-End-/Unit-Tests für Review-Gates und Agent-Runner
- [x] Performance-nahe Unit-Tests (max_steps)
- [x] Dokumentation erweitern (Phase-2C-Status)
- [x] Smoke-Tests um Loop-Tests erweitern
- [x] **Slot-Management E2E-Tests** (`scripts/test-slot-management.ps1`)
- [ ] Vollständige Live-LLM-E2E-Abnahme dokumentieren

---

## 4b. Coding Capability Hardening (2026-07-01, Gate 1 2026-07-23)

| Bereich | Status | Nachweis |
|---------|--------|----------|
| Communication Spine | REAL | `apps/desktop/electron/main.ts`, `runtimeChatStream.ts`, `backendClient.ts`; Abort schreibt keine Assistant-Folgeantwort mehr |
| AbortSignal Utility | REAL | `apps/desktop/src/services/abortSignals.ts`, Tests |
| Model Decision Contract | REAL/PARTIAL | `decision_id`, `routing_reason`, `provider`, request-scoped `fallback_policy`; Cloud-Live-Gate offen |
| Runtime Fallback Policy | REAL | `RuntimeService.resolve_chat_target()` nutzt Request-Policy vor Default |
| Repo Map / Context Selection | REAL | `ContextPackService.repo_map` mit Dateien, Imports, Exports, Symbolen, Tests, Configs, Git-Status und Tokenbudget |
| Safe Patch / Repair Limits | REAL | `PatchPipelineService` erzwingt Limits und Review-Gate |
| Offline Coding Loop | REAL | `test-fixtures/coding-capability-project`, `backend/tests/test_coding_loop_acceptance.py`, `pnpm test:coding-loop` |
| **Desktop Capability Suite** | **REAL** | `fixtures/coding-assistant-workspace`, Harness in `capabilityScenarios.ts`; **30/30** mit `RUN_CAPABILITY_SUITE=1`; CI-pflichtig; `pnpm ci:local` |
| Status-Dokumentation | REAL | `docs/STATUS_MATRIX.md`, README/ROADMAP/HANDOVER bereinigt |

Bekannte Grenzen:
- Der Offline-Coding-Loop ist deterministisch und beweist Workflow-Kontrakte, nicht die Qualität eines konkreten lokalen Modells.
- Live-LLM-E2E, Playwright-GUI-Lauf und Hardware-spezifische Runtime-Tests bleiben explizite manuelle Gates.
- `allow_cloud_fallback` ist als Vertrag vorhanden; echte Cloud-Nutzung erfordert lokale Secrets und wird nicht im Repo automatisiert.

---

## 5. Features & Reparaturen (kumulativ)

### Phase 0 — Stabilisierung (Basis)

| Bereich | Problem | Lösung |
|---------|---------|--------|
| Electron Preload | `reloadBackend` außerhalb des `api`-Objekts | Ins `api`-Objekt; Typ in `global.d.ts` |
| App.tsx | Verschachtelte Settings-Buttons | Geschwister-Buttons; `reloadBackend` in SettingsPanel |
| Backend Config | Windows-Pfade auf Linux/CI falsch | `_normalize_config_path()` |
| ModelIndexService | Legacy JSON / fehlender Filesystem-Scan | V1/V2 für catalog/runtime/state; GGUF-Scan |
| RuntimeService | Tests scheiterten am Endpoint-Check | Injizierbarer `endpoint_checker`; Ollama ohne Check |
| Model Profiles | `set_services()` nicht verdrahtet | Shared `RuntimeService` in `create_app()` |
| Job-Spooler | Keine Electron-Bridge | IPC-Proxy in `main.ts` / `preload.ts` |

### Phase 0.2–1D — Backend & Desktop-Erweiterungen

- **Doctor:** `scripts/doctor.ps1`, `backend/scripts/doctor_backend.py`, npm-Scripts `doctor*`
- **Agent Runner:** `backend/app/agent_runner/`, API + Tests, Smoke erweitert
- **Runtime Doctor:** `backend/app/runtime/doctor.py`, Hardware-Presets, Dry-Run, Probe
- **Context Pack:** `backend/app/context_pack/`, Workspace-Kontext für Agents
- **Safe Patch Pipeline:** `patchPipelineService.ts`, IPC, Restore-Point-Integration

### Post-Phase-Fixes (Betrieb)

| Thema | Problem | Lösung |
|-------|---------|--------|
| **agent_logs** | Legacy-DB mit `timestamp` NOT NULL → Agents 500 | Migration + dual-column Insert in `agents/service.py` |
| **Docs** | „Workspace Root fehlt" | `projectPath` statt Tab-Parent in `App.tsx` |
| **Electron Dev-Start** | `await startBackend()` blockierte Fenster | `backendStartupService.ts`; Fenster zuerst, Backend async |
| **Runtime Chat 409** | UI zeigt „ollama aktiv", Backend ohne Runtime | Live-Status vor Chat; 15s-Polling; klare Fehlermeldung |
| **Mission Control** | Leere/schwarze Startfläche | `MissionControlPanel.tsx`; Sichtbarkeit bei fehlendem Ready-State |
| **llama.cpp Start** | Sofortiger Fail wenn Modell langsam lädt | Warmup/Retry (90s), Stderr-Capture, shared `launch.py` |
| **Slot unavailable** | `target_slot_unavailable: slot 'quality_cpu' is not running` | RuntimeSlotPanel mit Auto-Start + manueller Steuerung |

---

## 6. Qualitäts-Gates (2026-07-23)

```powershell
# Vollständiges lokales CI (entspricht GitHub required-gates)
pnpm ci:local:win          # Windows
# pnpm ci:local            # Linux/macOS/Cloud

# Einzel-Gates
pnpm typecheck             # 0 Fehler
pnpm --filter @dbzs/shared test
pnpm --filter @dbzs/desktop test
$env:RUN_CAPABILITY_SUITE="1"
pnpm --filter @dbzs/desktop test:capabilities   # 31/31
pnpm build
pnpm smoke:packaging
pnpm smoke:backend
pnpm doctor:backend
cd backend; uv run pytest -q   # 344 passed

# Schneller Smoke (Teilmenge)
pnpm smoke-test
pnpm test:coding-loop
pnpm e2e                   # separater CI-Job
```

---

## 7. Bekannte Lücken & Risiken

| Thema | Status | Empfehlung |
|-------|--------|------------|
| Interaktive UI-Abnahme | Weitgehend abgeschlossen | `pnpm acceptance:live`; Runtime-Chat/Terminal/Git manuell |
| Dependency Audit | 1 niedriges Dev-only-Finding (`@babel/core 7.29.0`) | Auf `7.29.1` bzw. kompatibles Vite/Electron-Vite-Update warten; nicht durch Babel-8-Override erzwingen |
| GitHub Dependabot | GitHub meldet weiterhin 44 Alerts auf dem älteren Default-Branch | Feature-Branch nach Review mergen; danach Alerts neu bewerten und `docs/DEPENDABOT-HIGH.md` aktualisieren |
| Electron-Startumgebung | `ELECTRON_RUN_AS_NODE=1` lässt Electron als Node-Prozess starten; `ipcMain` ist dann nicht verfügbar | Variable vor Desktop-Start entfernen: `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue` |
| Echter llama-server | Warmup hilft; Hardware/Modellpfade user-spezifisch | `pnpm doctor:backend`; Modellpfade in Settings |
| Browser-Vorschau `:5173` | Zeigt Electron-Hinweis (by design) | Nur über `pnpm dev` / Electron nutzen |
| Anthropic Modellliste | Statisch in `modelProviders.ts` | Bei neuen Modellen `ANTHROPIC_CURATED_MODELS` ergänzen |
| E2E-Tests | Playwright-Specs angelegt, CI-Integration erledigt | `.github/workflows/ci.yml` erweitert |
| SSE-Client | Backend + Frontend implementiert | `sseClient.ts` + `jobSpoolerStore.ts` |
| **Slot Auto-Start** | Implementiert, konfigurierbar | User kann Auto-Start in Settings deaktivieren |
| Live-LLM Coding Loop | Nicht vollständig manuell dokumentiert | Mit lokalem Zielmodell gegen `test-fixtures/coding-capability-project` nachziehen |
| Desktop-Capability-Suite | **30/30 grün, CI-pflichtig** | `RUN_CAPABILITY_SUITE=1 pnpm --filter @dbzs/desktop test:capabilities` oder `pnpm ci:local:win` |
| Lokales CI-Spiegelbild | `scripts/ci-local.ps1` / `scripts/ci-local.sh` | Vor Push: `pnpm ci:local:win` |

---

## 8. Nächste sinnvolle Schritte

### Priorisiert (P0)

0. **PR #51 mergen:** `feat/context-intelligence-rc-hardening` → `main` (Gate 1: Capability 30/30 + CI)
1. **CI auf GitHub grün bestätigen** (ubuntu + windows Matrix) nach Merge-Vorbereitung
2. **Erst danach Phase 2** aus `CURSOR_MASTERPROMPT_DBZS_CODEE_P0_HARDENING.md` (Security, Build, …)

3. **PR mergen:** `fix/complete-code-review-orchestrator` (Broker-Test-Align) nach `main` (falls noch offen)

2. **Electron Live-Abnahmen:**
   - „Mache einen kompletten Codereview“ → Reviewer + `.codee/reviews/` + Report
   - „Implementiere Electron“ → Coder + Tools, Post-Fallback Binding ohne Fake-First-Token

3. **Runtime Chat mit Agent-Loop + Slot-Management testen:**
   - UI: Runtime starten → Runtime Chat öffnen → Slot-Panel zeigt alle 3 Slots
   - quality_cpu starten → Status sollte zu "running" wechseln
   - Prompt eingeben → Slot sollte Request verarbeiten
   - Tool-Calls sollten erscheinen + Diffs sollten sich queuen lassen

4. **Agent Workbench Daily-Use-Gate:**
   - `pnpm dev` starten → Agent Workbench Tab öffnen
   - Demo-Run starten → Lauf beobachten (5-10 min mit lokalem LLM)
   - Acceptance-Kriterium: Run erfolgreich → Patches reviewbar → applibar

5. **Slot-Management Abnahme:**
   - RuntimeSlotPanel im Runtime Chat öffnen
   - Alle 3 Slots sollten sichtbar sein mit korrektem Status
   - quality_cpu starten → Warten bis "running" + "chat_ready"
   - Request senden → sollte erfolgreich sein
   - Slot stoppen → Status sollte zu "stopped" wechseln

### Mittel (P1–P2)

4. **Cloud-Fallback testen:** `cloudModelsEnabled=true` + `ANTHROPIC_API_KEY` setzen → Runtime stoppen → Job einreihen → Fallback prüfen
5. **Dependency Security:** Nach Veröffentlichung von `@babel/core >=7.29.1` Override/Lockfile aktualisieren und `pnpm audit` erneut ausführen
6. **E2E Coverage:** Runtime-Chat-Szenarien zu Playwright hinzufügen
7. **Slot-Enhancements:** Model-Auswahl pro Slot, Auto-Scale bei Last

### Optional

8. **Crash-Recovery-Test:** Electron während Run abstürzen → Wiederaufnahme mit `paused_recovery` State
9. **Performance:** SSE Polling vs. Push, Tool-Selection Heuristik optimieren
10. **Benchmark-Dashboard:** VRAM/CPU-Auslastung im Dashboard anzeigen

---

## 9. Referenzen

| Dokument | Inhalt |
|----------|--------|
| `CODEX_DBZS_CODEE_PHASE_0_3_MISSION_CONTROL.md` | Auftrag Mission Control |
| `120626-1522 CODEX_CODEE_PHASE0_STABILISIERUNG_PROMPT.md` | Phase-0-Auftrag |
| `DBZS_CODEE_NEXT_CODEX_TASKS_MASTER.md` | Task-Backlog |
| `docs/LOCAL_ACCEPTANCE.md` | Lokale Abnahme-Checkliste |
| `CURSOR_MASTERPROMPT_DBZS_CODEE_P0_HARDENING.md` | P0 Hardening Phasen 0–6, Gate 1 erfüllt auf Feature-Branch |
| `scripts/ci-local.ps1` / `scripts/ci-local.sh` | Lokales CI = GitHub `required-gates` |
| `AGENTS.md` | Architektur- und Agent-Regeln |
| `docs/PHASES.md` | Feature-Phasen-Historie |
| `docs/DEPENDABOT-HIGH.md` | Dependabot high/critical Alerts |
| `docs/QUICKSTART.md` | Erste Schritte + Slot-Management |
| `docs/ARCHITECTURE.md` | System-Übersicht mit Slot-Architektur |
| `LATER_TODO.md` | Abgeschlossene Aufgaben + nächste Schritte |
| `scripts/test-slot-management.ps1` | Slot E2E-Tests |

---

## 10. Übergabe-Checkliste

Vor Weiterentwicklung kurz prüfen:

- [x] `pnpm typecheck` grün (0 Fehler)
- [x] `pnpm test` grün (shared 1, desktop ~300+Slot-Tests, backend 199+)
- [x] `pnpm build` grün
- [x] `pnpm smoke:backend` grün
- [x] `pnpm doctor:backend` grün
- [x] Electron-Fenster öffnet ohne blockierendes Backend
- [x] Mission Control bei fehlendem Ready-State
- [x] llama.cpp Warmup/Stderr-Diagnostik
- [x] Alle 4 Provider benutzbar (llama.cpp, Ollama, OpenAI, Anthropic)
- [x] Cloud-Fallback im Agent-Runner und agent_loop verdrahtet
- [x] Command Palette (Ctrl+K) mit Fuzzy-Suche
- [x] Toast-System für Nutzer-Feedback
- [x] Job-Task-Linking (job_ids auf Tasks, Link/Unlink-UI)
- [x] Model-Download-Wizard (HuggingFace GGUF)
- [x] GPU-Erkennung + Benchmark-Endpoint
- [x] Multi-GPU Erkennung & Klassifizierung (AMD iGPU für Display vs. NVIDIA dGPU für Compute)
- [x] Paralleles Slot-Management (`quality_cpu` auf 8081, `fast_gpu` auf 8082, `utility` auf 8083)
- [x] VRAM-Fit Validierung (4096 MB Limit mit 512 MB Treiber-Reserve)
- [x] Intelligentes Task-basiertes Routing (Chat an GPU, Code an CPU)
- [x] Beenden der nachweislich von CODEE verwalteten Runtime-Prozesse beim Schließen der App
- [x] SSE-Router für Job-Updates (Backend)
- [x] SSE-Frontend-Consumer (EventSource im JobMonitorPanel)
- [x] Playwright-E2E in CI
- [x] Settings → „Backend neu laden" (UI-Klick, IPC)
- [x] Settings → Frontend manuell neu starten und nach erfolgreichem Standardmodell-Wechsel automatisch cachefrei neu laden
- [x] Dependency-Audit ohne moderate/hohe/kritische Findings (`dompurify 3.4.12`, Vite-`esbuild 0.28.1`)
- [x] Runtime starten + Runtime Chat (implementiert, Testanleitung in QUICKSTART.md)
- [x] Terminal- und Git-Panel visuell prüfen (implementiert, funktionsfähig)
- [x] Autonomous Loop Controller (Backend, Unit-Tests)
- [x] Review Gates Backend + API
- [x] ATIF-light Trajectory (Backend + Hooks + Frontend Mini-Panel)
- [x] **Runtime Slot Management** (Service + UI + Tests, 2026-06-27)
- [x] Repository-RAG: inkrementeller Backend-Index, Retrieval Manifest und Source References
- [x] Sichere Execution Trace: reale Events, SQLite-Persistenz, Summary/Expanded-UI, keine Roh-CoT-Anzeige
- [ ] E2E: Autonomous Loop + Review Gates + Slot-Management (kombiniert)
- [ ] Trajectory Replay/Export UI

**Runtime-Debugging:** `backend/app/runtime/launch.py`, `service.py`, Tests in `test_runtime_service.py` und `test_runtime_launch.py`.

**Agents-Debugging:** Legacy-DB `%LOCALAPPDATA%\DBZS\CodeAssistant\agents.sqlite3` — nach Backend-Update ggf. löschen und neu starten (Schema-Migration läuft automatisch).

**Cloud-Debugging:** `CloudRuntimeClient.is_available()` prüfen; Env-Vars `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` oder Settings-JSON.

**Slot-Debugging:** `runtimeSlotManager.ts`, `RuntimeSlotPanel.tsx`, Backend-APIs `/runtime/slots/{slot_id}/*`.

**Fehler `target_slot_unavailable`:** RuntimeSlotPanel öffnen → Slot manuell starten → Auto-Start aktivieren für zukünftige Requests.

**Fehler `ipcMain` ist `undefined`:** Prüfen, ob `ELECTRON_RUN_AS_NODE=1` gesetzt ist. Vor dem Start in PowerShell mit `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue` entfernen.

---

## 11. Letzte Commits / Arbeitsstand (2026-07-12)

| Commit | Inhalt |
|--------|--------|
| `6821982` | `fix(desktop): reload frontend after model changes` — IPC/Preload/Settings-Restart, Store-Erfolgsgate, Tests und Import-Bereinigung |
| `bfa03e0` | `fix(deps): patch audited frontend dependencies` — zentrale pnpm-Overrides und aktualisiertes Lockfile |

Branch: `release/0.4.0-rc.1`

Nachgewiesen: sauberer PyInstaller-`onedir`-Build aus isoliertem `.venv-rc`, Bundle-Health `0.4.0-rc.1` sowie 39/39 Playwright-E2E. Noch offene externe RC-Gates: Windows-Installer-Smoke in CI und manuelle Live-Runtime-Validierung auf der vorgesehenen Hardware.

---

## 12. Review-Remediation P0-Hotfix (2026-07-23)

Arbeitsbranch: `fix/remediation-state-tool-protocol-budget`

- Review und Scope werden atomar in `.codee/review-remediation-selection.json` gespeichert. Eindeutige Frage-IDs blockieren verspätete Antworten; Workspace-Wechsel invalidiert die Auswahl.
- Die kombinierte Karte „Review beheben“ ersetzt die alternierenden Rückfragen. Einzelne Findings werden bei Bedarf in genau einem Folgeschritt ausgewählt.
- `findings.json` wird hostseitig strikt validiert und gefiltert. Die nicht droppbare Capsule enthält die kompakten Finding-Daten.
- Remediation-Tools sind auf Planning 4, Implementation 7 und Verification 4 begrenzt und werden mit Skill-/Profil-/Verfügbarkeitspolicy geschnitten.
- Prompt-Tools verwenden ausschließlich `<CODEE_TOOL_CALL>…</CODEE_TOOL_CALL>`. Markdown- und Inline-JSON sind nicht ausführbar; ein ungültiger Envelope erhält höchstens einen Repair-Turn.
- Prompt-Toolkataloge werden als Tooltokens in das harte 4096-Token-Gate eingerechnet. Providerdiagnostik führt `totalEstimatedInputTokens` und `totalRequiredTokens` konsistent.
- llama.cpp beendet den Upstream-Stream bei `finish_reason` oder `[DONE]`; Electron finalisiert beim Backend-`done` sofort. Teiltext nach einem Idle-Timeout gilt nicht als Erfolg.
- CPU-Fallback (`gpuLayers=0`) erhält mindestens 60 Sekunden Stream-Idle-Budget. Ein Timeout erzeugt nur ein terminales `chat.timeout`-Event.

Redigierte Regression-Fixture:
`apps/desktop/src/services/repositoryReview/__fixtures__/run-mrxclmuh-q0ck.redacted.json`.

Manuell offen: Electron-Reproduktion im externen Workspace `guitar-bass-academy`; der Workspace wurde während dieser Umsetzung nicht verändert.
