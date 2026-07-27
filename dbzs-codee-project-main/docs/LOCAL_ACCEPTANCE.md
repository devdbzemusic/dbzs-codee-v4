# Local Acceptance — DBZS Code Assistant

Stand: 2026-06-18

Manueller Abnahmeablauf fuer lokale Entwicklung unter Windows.

## Automatisierte Gates

```powershell
pnpm install
cd backend
uv sync
cd ..
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:backend
pnpm doctor:backend
pnpm doctor
pnpm acceptance:live
```

Optional mit Backend-Start und Reload-Simulation:

```powershell
pnpm acceptance:live:start
```

Erwartung: alle Befehle gruen, `doctor` ohne ERROR-Zeilen, `acceptance:live` alle `[OK]`.

## Phase 0.4 — Golden Path (Runtime Acceptance)

Voraussetzung: lokale GGUF-/llama-server-Modelle und Runtime-Bundle unter dem konfigurierten `modelsPath`.

```powershell
git pull
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @dbzs/desktop dev
```

Mit laufendem Backend (Port **8876**):

```powershell
Invoke-RestMethod http://127.0.0.1:8876/runtime/doctor | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post http://127.0.0.1:8876/runtime/doctor/dry-run `
  -ContentType "application/json" `
  -Body '{"model_id":"DEINE_MODELL_ID","profile_name":"safe_cpu_coder"}' |
  ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post http://127.0.0.1:8876/runtime/doctor/probe `
  -ContentType "application/json" `
  -Body '{"allow_start":true,"model_id":"DEINE_MODELL_ID"}' |
  ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post http://127.0.0.1:8876/runtime/start `
  -ContentType "application/json" `
  -Body '{"model_id":"DEINE_MODELL_ID"}' |
  ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post http://127.0.0.1:8876/runtime/chat `
  -ContentType "application/json" `
  -Body '{"messages":[{"role":"user","content":"Sag kurz Hallo aus der lokalen Runtime."}]}' |
  ConvertTo-Json -Depth 8
```

### Golden-Path-Checkliste

| Schritt | API / UI | Status | Notiz |
|---------|----------|--------|-------|
| Gates | `pnpm typecheck/test/build` | pass | Frontend + Runtime-Backend-Tests |
| Doctor | `GET /runtime/doctor` | pass | 346 Modelle, 7 checks |
| Dry Run | `POST /runtime/doctor/dry-run` | pass | `safe_cpu_coder`, command preview OK |
| Probe | `POST /runtime/doctor/probe` | pass | Controlled probe auf Port 8091 |
| Start | `POST /runtime/start` | pass | state=running, llama.cpp |
| Chat | `POST /runtime/chat` | pass | Antwort: „Hallo aus der lokalen Runtime.“ |
| UI | Mission Control → Runtime Doctor | pass | RuntimeDoctorSection implementiert |
| Logs | `GET /runtime/logs` | pass | stderr/stdout tail verfügbar |

**Verwendete model_id:** `15c2cc058bd801db` (Base-Roblox-coder-Llama-3.2-3B-vLLM-Q3-K-M)

## Phase 0.4b — Runtime Chat Projektkontext

Nach dem Runtime-Golden-Path (API) separat prüfen, dass der **UI-Chat** den **offenen Workspace** ans Modell übergibt (Dateiinhalte, nicht nur Pfade).

**Vollständige Anleitung:** [`RUNTIME_CHAT_CONTEXT_ACCEPTANCE.md`](RUNTIME_CHAT_CONTEXT_ACCEPTANCE.md)

### Kurz-Checkliste (embedded)

1. Workspace = dieses Repo, Dateiscan fertig, Runtime `running`
2. Runtime Chat → **Panel** öffnen, Checkbox **Kontext** an
3. Prompt: `Zitiere wörtlich die erste Überschrift aus unserer README.md — nur die Überschrift, nichts erfinden.`
4. Activity: **Workspace-Kontext laden** → `N Dateien geladen` (N ≥ 1), Detail `✓ README.md …`
5. Activity: **Anfrage vorbereiten** → `… Kontextnachrichten` (≥ 1)
6. Antwort enthält echte README-Überschrift

### Automatisierter Unit-Gate

```powershell
cd apps\desktop
pnpm exec vitest run src/components/RuntimeChatTab.test.ts
```

Erwartung: 8/8 grün (`buildWorkspaceContextSystemMessage` liefert Code-Blöcke).

| Check | Status | Notiz |
|-------|--------|-------|
| Unit: Kontext-System-Nachricht mit Inhalt | | Vitest |
| UI A: README-Zitat embedded | | |
| UI C: Kontext aus → kein Kontext | | |
| UI E: Detached Fenster + IPC | | |

## Agent Trajectory (ATIF-light)

**Symptom:** Job Monitor → „Agent Trajectory / ATIF-light“ → `Failed to fetch`

**Ursache (Fix 2026-06-18):** Renderer-`fetch()` statt Electron-IPC zum Backend.

**Prüfen:**

```powershell
Invoke-RestMethod http://127.0.0.1:8876/health
Invoke-RestMethod "http://127.0.0.1:8876/trajectories/recent?limit=5"
cd apps\desktop
pnpm exec vitest run src/services/trajectoryService.test.ts
```

**UI-PASS:** Job wählen → Events oder „Noch keine Trajectory-Events“ — nicht `Failed to fetch`.

Workspace-Sync: [`WORKSPACE_SYNC.md`](WORKSPACE_SYNC.md).

## Interaktive Checks (manuell / teil-automatisiert)

Nach `pnpm dev`:

- [x] Desktop-Fenster startet (Electron + Vite `:5173`; Workspace-Scan im Log)
- [x] Backend Health erreichbar (`acceptance:live`, Port 8876)
- [x] Backend-Reload Recovery (`pnpm acceptance:live:start`)
- [ ] Settings → „Backend neu laden“ in der UI (IPC; Code in `main.ts` + Settings-Panel)
- [x] Model Index laedt (369 Modelle via Live-API)
- [x] Runtime Status laedt (`state=stopped|starting|running`)
- [x] Job Monitor in Sidebar (`JobMonitorPanel` in `App.tsx`; Jobs via `/job-spooler`)
- [ ] Runtime Doctor in Mission Control (Dry Run / Probe / Start / Stop)
- [x] Runtime starten + Runtime Chat (hardware/modellabhaengig; Golden Path 2026-06-18)
- [ ] Runtime Chat Projektkontext (README-Zitat, Activity-Panel; siehe `RUNTIME_CHAT_CONTEXT_ACCEPTANCE.md`)
- [ ] Terminal Panel startet (manuell in UI)
- [ ] Git Panel zeigt Repo-Status (manuell in UI)

## Diagnose bei Problemen

1. `pnpm doctor` — Node/pnpm/Python/uv, Pfade, Port 8876
2. `pnpm doctor:backend` — API-Endpunkte via TestClient (inkl. `/runtime/doctor`)
3. `GET /runtime/logs` — stderr/stdout tail bei Start-/Probe-Fehlern
4. Haengende Prozesse: Electron/Node/Python auf Port 8876 beenden, dann erneut `pnpm dev`

Siehe auch [`HANDOVER.md`](../HANDOVER.md), [`RUNTIME_DOCTOR.md`](RUNTIME_DOCTOR.md) und [`SETUP.md`](SETUP.md).
