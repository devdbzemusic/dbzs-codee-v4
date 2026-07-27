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
- `origin/main` zeigt auf `934d907650b75855bd5d6487fa5ceaa850ac5a64` (Merge-Commit von PR #4)
- offene Pull Requests im Live-Repo: keine
- Branch Protection fuer `main`: aktuell nicht aktiv

## PR #4 gemergt: Runtime-Chat-Overhaul + Personal Production Stabilization

[PR #4](https://github.com/devdbzemusic/dbzs-codee-v4/pull/4) buendelt zwei Arbeitsbloecke und ist ueber regulaeren Merge-Commit in `main`:

1. **Runtime-Chat-Overhaul** (Vorarbeit aus der vorherigen Session, siehe unten)
2. **Personal Production Stabilization** (heute umgesetzt, Basis: `Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_PLAN.md`)

### Personal Production Stabilization — was umgesetzt wurde

- **Runtime-Pfad**: Default-Bug in `backend/app/models/discovery_mode.py` behoben (Fallback war `local_with_ollama` statt `project_local_strict`); `backend/app/runtime/doctor.py` prueft Ollama-Binary/-Port nicht mehr im Strict-Mode; G:/D:-Pfad-Fallbacks in `backend/app/core/config.py` gegen die echte Maschine verifiziert (existieren, keine Aenderung noetig); toter Ollama/Cloud-Code in `apps/desktop/src/services/modelProviders.ts` / `modelRouterService.ts` mit Warnkommentaren gekennzeichnet.
- **Review-/Index-Inventar**: `packages/shared/src/context-excludes.json` (+ TS/Python-Policy) um `.cache`, `playwright-report`, `test-results`, `.next`, `.turbo` sowie einen neuen `excludedFilePatterns`-Glob-Mechanismus (`*.log`, `.env`, `.env.*`) erweitert. Sieben vormals unabhaengige Exclude-Listen (`repositoryReview/reviewPathUtils.ts`, `nodeReviewWorkspaceIo.ts`, `workspaceService.ts`, `rag/service.py`, `docs_analysis/service.py`, `context_pack/service.py`, `agent_workbench/tools.py`) darauf migriert.
- **Diff/Snapshot/Rollback**: Freigabepflicht im `"full"`-Agent-Profil fuer `write_file`/`apply_patch`/`create_file`/`rename_file` ergaenzt (`agentToolProfile.ts`); die ungeschuetzten `dbzs:fs:*`/`dbzs:file:save`-IPC-Handler in `main.ts` sind jetzt auf Workspace- **oder** App-userData-Grenzen beschraenkt (wichtig: `modelIndexCacheService` liegt bewusst ausserhalb des Workspace) plus Restore-Point vor Ueberschreiben; Crash-Flush-Hooks (`uncaughtException`/`unhandledRejection`/`will-quit`) mit Secret-Redaction ergaenzt.
- **`.env`-Leseausschluss**: verifiziert und eine echte Bypass-Luecke in `nodeReviewWorkspaceIo.ts` gefunden und geschlossen — genau die Aufgabe, die im letzten Handover unter P1 offen stand.
- **Automatisches Backup**: neuer `apps/desktop/electron/backupService.ts` sichert Settings, Codee-DBs, Workspace-`.codee` (ohne Restore-Points) und kleine Modellprofile mit Rolling-Retention (14) und Restore-Funktion. Bewusst **nicht** gesichert: `rag.sqlite3` (853 MB auf dieser Maschine, rebuildbarer RAG-Index) und Modellgewichte unter `models/` (mehrere GB, reproduzierbar). UI-Einstiegspunkt im Diagnostics-Tab (`DiagnosticsStorageTab.tsx`).
- **`.gitignore`-Bugfix**: die Regel `models/` schloss versehentlich `backend/app/models/` (echtes Python-Source-Package) aus — 8 Dateien (`discovery.py`, `download_service.py`, `profile_service.py`, `schemas.py` etc.) waren nie versioniert. Per gezielter Negation (`!backend/app/models/`) gefixt; Modellgewichte und das Duplikat unter `dbzs-codee-project-main/` bleiben weiter ignoriert.

### Verifikation heute

- `npm run typecheck` (apps/desktop) — keine neuen Fehler (nur vorbestehende, unabhaengige Fehler in `atomicFileWrite.ts`/`.test.ts`)
- Backend-Pytest auf betroffenen Suiten (context_policy, runtime_doctor, model_index, runtime_service, rag/docs_analysis/context_pack/agent_workbench) — gruen
- Frontend-Vitest auf betroffenen Suiten (electron/*, repositoryReview, tool adapter, settings) — 199+ Tests gruen
- `electron-vite build` erfolgreich
- **Nicht moeglich in dieser Sandbox**: interaktiver GUI-Start. `ELECTRON_RUN_AS_NODE=1` ist in der Shell gesetzt, wodurch Electron nur als reiner Node-Prozess statt als echtes Fenster startet (weder direkter Start noch der vorhandene Playwright-E2E-Boot-Test `e2e/boot.spec.ts` funktionieren dadurch hier).

## Zusaetzlich umgesetzt (Runtime-Chat-Overhaul, aus der vorherigen Session, jetzt Teil von PR #4)

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

## Offene lokale Aenderungen (unabhaengig von PR #4, noch unangetastet)

Im Arbeitsverzeichnis liegen weiterhin unabhaengige, kleine, unfertige Aenderungen, die nicht Teil von PR #4 waren (bewusst nicht committet, da Herkunft/Absicht unklar):

- `apps/desktop/electron/skillRunPersistenceService.ts` (6 Zeilen)
- `apps/desktop/src/services/executionHandoff.ts` (2 Zeilen)
- `apps/desktop/src/services/executionIntent.ts` (9 Zeilen)
- `apps/desktop/src/services/executionIntent.test.ts` (2 Zeilen)
- `apps/desktop/electron/atomicFileWrite.ts` + `.test.ts` (komplett neu, untracked) — verursacht die einzigen verbleibenden Typecheck-Fehler (`AtomicWriteFs`/`mkdir`-Typkonflikt)
- `.cache/backend-build/*` (Build-Artefakte, gehoeren generell nicht in einen Commit)

## Aktive offene Aufgaben

### P0

- GUI-Golden-Path manuell durchlaufen (App 10x starten, Projekt oeffnen, Modellverbindung, Chat, Review, Diff/Apply/Rollback, Tests aus Codee starten, harter Abbruch + Backup-Restore pruefen) — siehe Checkliste in `Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_PLAN.md`
- Typfehler in `apps/desktop/electron/atomicFileWrite.ts`/`.test.ts` beheben (`AtomicWriteFs.mkdir`-Signatur vs. `node:fs/promises`)
- die vier offenen Kleinaenderungen oben (skillRunPersistenceService/executionHandoff/executionIntent) pruefen: fertigstellen, verwerfen oder committen

### P1

- echte GitHub-CI-Strategie fuer `push` und `pull_request` entscheiden und dokumentieren
- mindestens einen echten GitHub-Workflow-Lauf nach Reaktivierung dokumentieren
- Branch Protection und Merge-Gates fuer `main` sauber nachziehen
- Vite-Warnungen fuer gemischte statische/dynamische Imports spaeter entflechten
- Windows-Golden-Path auf frischer Umgebung dokumentiert abnehmen
- Backup-Restore einmal echt in der laufenden App durchklicken (Diagnostics-Tab)
- gepacktes-Build-Userdata-Verzeichnis fuer `backupService.ts` einmal an einem echten Installer-Build verifizieren (bisher nur Dev-Pfad `%TEMP%\dbzs-codee-dev-user-data` bestaetigt)

## Wichtige Hinweise

- Historische Papiere unter `Pläne/` oder `docs/archive/` koennen falsche Repo- oder PR-Annahmen enthalten.
- Die aktuellen Wahrheitsquellen sind `README.md`, `TODO.md`, `docs/STATUS_TODAY.md` und das Audit unter `docs/audits/`.
- Im Worktree liegen generierte Artefakte unter `.cache/backend-build/`; diese gehoeren nicht automatisch in den naechsten Commit.
- `.gitignore` hatte einen blinden Fleck bei Verzeichnissen namens `models/` egal wo im Baum — vor weiteren pauschalen Ignore-Regeln kurz mit `git status --ignored` gegenpruefen, ob echter Source darunter faellt.
