# Handover

Stand: 2026-07-28

## Aktueller Arbeitsbranch

- aktiver Arbeitsbranch: `main` (Feature-Branch `codex/runtime-chat-overhaul-conversation-first` ist gemergt und geloescht)
- Sicherheits-Backup-Branch: `codex/backup-runtime-chat-overhaul-2026-07-27`
- physischer Snapshot:
  `C:\Users\ralle\source\repos\_backups\dbzs-codee-project-backup-2026-07-27-runtime-chat-overhaul`

## Repo-Wahrheit

- aktiver GitHub-Remote: `https://github.com/devdbzemusic/dbzs-codee-v4.git`
- lokaler Ordnername bleibt aktuell `dbzs-codee-project`
- `origin/main` zeigt auf `acca3bf` (Folgearbeit nach PR #4, direkt auf `main` committet)
- offene Pull Requests im Live-Repo: keine
- Branch Protection fuer `main`: aktuell nicht aktiv

## PR #4 gemergt + Folgearbeit direkt auf `main`

[PR #4](https://github.com/devdbzemusic/dbzs-codee-v4/pull/4) (Runtime-Chat-Overhaul + Personal Production Stabilization) ist gemergt. Danach wurden die aus der Verifikation vom 2026-07-28 (`Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_VERIFICATION_2026-07-28.md`) und aus diesem Handover offenen Restpunkte direkt auf `main` abgearbeitet (Commits `8f06ef8`, `dd31610`, `2d211cf`, `acca3bf`):

- **`atomicFileWrite.ts`-Typfehler behoben**: `AtomicWriteFs.mkdir` war gegen Nodes echte Recursive-Overload-Signatur zu eng typisiert. `npm run typecheck` ist seitdem erstmals vollstaendig fehlerfrei.
- **Vier lose Altaenderungen committet**: `skillRunPersistenceService.ts` (nutzt jetzt `writeFileAtomic`), `executionHandoff.ts`/`executionIntent.ts(.test)` (Intent-Klassifikation erkennt jetzt "Implementierungsplan"/"Umsetzungsplan"/"Fix-Plan"-Formulierungen als `plan_only`).
- **Vite-Importwarnungen aufgeloest**: zwei redundante dynamische Imports in `runtimeChatStoreRuntimeHelpers.ts` (`backendClient`, `providerRuntimeEvents`) waren bereits ueber Sibling-Stores statisch im selben Chunk — auf statische Imports umgestellt, `electron-vite build` ist jetzt warnungsfrei.
- **Repository-Review-Fehlerklassifikation**: neuer `RepositoryReviewOutcome`-Wert `"empty_plan"` ersetzt die generische `"failed"`-Klassifikation, wenn ein nicht-leeres Inventar auf null Batches faellt (z. B. `selectedPaths` matcht nichts oder keine Datei passt zum unterstuetzten Format-Filter). Grund wird jetzt in `review-state.json` persistiert (`ReviewStateFile.detail`) und im Chat ueber `currentBatchTitle` angezeigt. Neuer Regressionstest fuer den vorher ungetesteten Zweig.
- **Golden-Path-Verifikation konsolidiert**: siehe [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md) — wichtigster neuer Fund: **`env -u ELECTRON_RUN_AS_NODE` erlaubt einen echten Electron-GUI-Start in dieser Sandbox** (vorher als unmoeglich angenommen). `boot.spec.ts` und die UI-Chrome-Specs (`command-palette`, `job-monitor`, `mission-control`) laufen damit gruen; die vier Specs, die eine tatsaechlich verbundene lokale Modell-Runtime brauchen (`agent-capabilities`, `coding-assistant`, `context-integration`, `runtime-chat`), scheitern hier einheitlich mangels geladenem Modell — das ist Golden-Path-Kriterium 3 selbst, das die echte Maschine braucht.

### Personal Production Stabilization (PR #4) — zur Erinnerung

- **Runtime-Pfad**: Default-Bug in `backend/app/models/discovery_mode.py` behoben; `backend/app/runtime/doctor.py` prueft Ollama nicht mehr im Strict-Mode; G:/D:-Pfad-Fallbacks verifiziert; toter Ollama/Cloud-Code gekennzeichnet.
- **Review-/Index-Inventar**: gemeinsamer Exclude-Contract (`.cache`, `playwright-report`, `test-results`, `*.log`, `.env`) auf sieben Konsumenten migriert.
- **Diff/Snapshot/Rollback**: Freigabepflicht im `"full"`-Profil, `dbzs:fs:*`-IPC-Handler abgesichert, Crash-Flush-Hooks ergaenzt.
- **Automatisches Backup**: `backupService.ts` (Settings, Codee-DBs ohne `rag.sqlite3`, Workspace-`.codee` ohne Restore-Points, Modellprofile), Diagnostics-Tab-UI.
- **`.gitignore`-Bugfix**: `backend/app/models/` war versehentlich komplett ignoriert (8 Dateien nie versioniert), per Negation gefixt.

### Verifikation (kumulativ)

- `npm run typecheck` (apps/desktop) — **vollstaendig fehlerfrei**
- `electron-vite build` — erfolgreich, keine Warnungen mehr
- Backend-Pytest + Frontend-Vitest auf allen betroffenen Suiten — gruen
- Playwright-E2E (mit `ELECTRON_RUN_AS_NODE` unset): 11/41 automatisiert bestanden (Boot + UI-Chrome); Rest erfordert echte Modell-Runtime — siehe Verifikationsdokument

## Zusaetzlich umgesetzt (Runtime-Chat-Overhaul, aus der vorherigen Session, Teil von PR #4)

- [apps/desktop/src/components/RuntimeChatTab.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/RuntimeChatTab.tsx)
  - Hauptansicht auf `conversation first` umgestellt und in kleinere Einheiten zerlegt
- [apps/desktop/src/components/runtime-chat/RuntimeChatHeader.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/runtime-chat/RuntimeChatHeader.tsx)
  - kompakter Header mit Workspace-Kontext und sekundaeren Panel-Toggles
- [apps/desktop/src/components/runtime-chat/RuntimeChatConversationFeed.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/runtime-chat/RuntimeChatConversationFeed.tsx)
  - natuerlicher Leerzustand, ruhigerer Nachrichtenfluss, kompakter Run-Block
- [apps/desktop/src/components/runtime-chat/RuntimeChatComposer.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/runtime-chat/RuntimeChatComposer.tsx)
  - freierer Composer mit klarer Fortsetzungslogik fuer kurze Antworten
- [apps/desktop/src/components/runtime-chat/RuntimeChatSecondaryPanels.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/runtime-chat/RuntimeChatSecondaryPanels.tsx)
  - Diagnose, Slots, Approvals und Panels explizit in die Sekundaerebene verschoben
- [apps/desktop/src/services/conversationMetaIntent.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/conversationMetaIntent.ts)
  - Statusfragen wie `Wie weit bist du?` und `Wo stehen wir?` werden direkt als Meta-Intent erkannt
- [apps/desktop/src/services/workflowContinuation.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/workflowContinuation.ts)
  - `weiter` wird als natuerliche Fortsetzung eines aktiven Workflows behandelt

## Aktive offene Aufgaben

### P0

- GUI-Golden-Path manuell durchlaufen auf der echten Maschine — konsolidierte Checkliste (14 Punkte, 4 davon bereits automatisiert bestaetigt) in [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md)
- Backup-Restore einmal echt in der laufenden App durchklicken (Diagnostics-Tab) — kein E2E-Test dafuer vorhanden
- gepacktes-Build-Userdata-Verzeichnis fuer `backupService.ts` an einem echten Installer-Build verifizieren (bisher nur Dev-Pfad `%TEMP%\dbzs-codee-dev-user-data` bestaetigt)

### P1 — bewusst zurueckgestellt

Konsistent mit der Personal-Production-Plan-Philosophie ("vorerst nicht noetig", kein oeffentlicher Release, kein Team) bewusst nicht aktiv verfolgt:

- GitHub-CI-Strategie entscheiden/reaktivieren (ohnehin durch GitHub-Billing-Sperre blockiert; `ci.yml`/`live-runtime-validation.yml` bleiben absichtlich `workflow_dispatch`-only)
- Branch Protection / Merge-Gates fuer `main`
- Grosse strukturelle Backlog-Punkte ("weitere Zerlegung grosser Runtime-/Store-Dateien", "Contract-Parity zwischen Shared und Backend weiter haerten") — bleiben unpriorisierter Backlog

## Wichtige Hinweise

- Historische Papiere unter `Pläne/` oder `docs/archive/` koennen falsche Repo- oder PR-Annahmen enthalten.
- Die aktuellen Wahrheitsquellen sind `README.md`, `TODO.md`, `docs/STATUS_TODAY.md` und die Audits unter `docs/audits/`.
- Im Worktree liegen generierte Artefakte unter `.cache/backend-build/`; diese gehoeren nicht automatisch in den naechsten Commit.
- `.gitignore` hatte einen blinden Fleck bei Verzeichnissen namens `models/` egal wo im Baum — vor weiteren pauschalen Ignore-Regeln kurz mit `git status --ignored` gegenpruefen, ob echter Source darunter faellt.
- **Diese Sandbox kann einen echten Electron-GUI-Start**, wenn `ELECTRON_RUN_AS_NODE` fuer den Kindprozess entfernt wird (`env -u ELECTRON_RUN_AS_NODE ...`). Backend/Renderer-Dev-Server muessen dafuer manuell vorgestartet werden, da `uv` in dieser Shell fehlt (venv-Python direkt nutzen: `backend/.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8876`).
