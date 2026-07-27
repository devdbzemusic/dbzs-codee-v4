# TODO

Stand: 2026-07-28

## Jetzt direkt

- [ ] GUI-Golden-Path manuell durchlaufen (10 Kriterien, siehe `Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_PLAN.md`) — in dieser Sandbox nicht moeglich (`ELECTRON_RUN_AS_NODE=1` verhindert echten Electron-GUI-Start)
- [ ] Typfehler in `apps/desktop/electron/atomicFileWrite.ts`/`.test.ts` beheben (`AtomicWriteFs.mkdir` vs. `node:fs/promises`-Signatur)
- [ ] vier offene Kleinaenderungen pruefen (fertigstellen/verwerfen/committen):
      `skillRunPersistenceService.ts`, `executionHandoff.ts`, `executionIntent.ts(.test)`
- [ ] Backup-Restore einmal echt in der laufenden App durchklicken (Diagnostics-Tab)

## Erledigt: PR #4 (Runtime-Chat-Overhaul + Personal Production Stabilization)

- [x] Runtime-Chat-Overhaul-Aenderungen committet (bereits vor dieser Session: `89ab9f6`, `59ef0a2`, `525b054`)
- [x] Branch `codex/runtime-chat-overhaul-conversation-first` sauber gepusht
- [x] nur fachliche Dateien committet, nicht `.cache/backend-build/*`
- [x] PR #4 erstellt, geprueft (`MERGEABLE`, `CLEAN`) und per Merge-Commit in `main` gemergt
- [x] Feature-Branch lokal und remote geloescht

## Personal Production Stabilization (heute, Basis: `Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_PLAN.md`)

- [x] Default-Bug in `backend/app/models/discovery_mode.py` behoben (`project_local_strict` statt `local_with_ollama`)
- [x] `backend/app/runtime/doctor.py`: Ollama-Checks im Strict-Mode entfernt/entrümpelt, Tests ergaenzt
- [x] G:/D:-Pfad-Fallbacks in `backend/app/core/config.py` gegen echte Maschine verifiziert (existieren)
- [x] toter Ollama/Cloud-Code in `modelProviders.ts`/`modelRouterService.ts` mit Warnkommentaren gekennzeichnet
- [x] gemeinsamer Exclude-Contract (`context-excludes.json` + TS/Python-Policy) um `.cache`, `playwright-report`,
      `test-results`, `.next`, `.turbo` sowie neuen `excludedFilePatterns`-Glob (`*.log`, `.env`, `.env.*`) erweitert
- [x] sieben vormals unabhaengige Exclude-Listen auf den gemeinsamen Contract migriert
      (`reviewPathUtils.ts`, `nodeReviewWorkspaceIo.ts`, `workspaceService.ts`, `rag/service.py`,
      `docs_analysis/service.py`, `context_pack/service.py`, `agent_workbench/tools.py`)
- [x] Freigabepflicht im `"full"`-Agent-Profil fuer Dateiänderungen ergaenzt (`agentToolProfile.ts`)
- [x] ungeschuetzte `dbzs:fs:*`/`dbzs:file:save`-IPC-Handler in `main.ts` auf Workspace-/userData-Grenzen
      beschraenkt, plus Restore-Point vor Ueberschreiben
- [x] Crash-Flush-Hooks (`uncaughtException`/`unhandledRejection`/`will-quit`) mit Secret-Redaction ergaenzt
- [x] `.env`-Leseausschluss verifiziert und echten Bypass in `nodeReviewWorkspaceIo.ts` geschlossen
- [x] neuer `backupService.ts`: Settings/Codee-DBs/Workspace-`.codee` (ohne Restore-Points)/Modellprofile,
      Rolling-Retention (14), Restore-Funktion; `rag.sqlite3` und Modellgewichte bewusst ausgeschlossen
- [x] UI-Einstiegspunkt fuer Backup/Restore im Diagnostics-Tab (`DiagnosticsStorageTab.tsx`)
- [x] `.gitignore`-Bug behoben: `models/`-Regel schloss `backend/app/models/` (echtes Source-Package)
      versehentlich aus — 8 Dateien waren nie versioniert, jetzt per Negation gefixt und getrackt
- [x] Typecheck, Backend-Pytest (betroffene Suiten), Frontend-Vitest (betroffene Suiten), `electron-vite build`
      — alle gruen
- [ ] interaktiver Golden-Path-Durchlauf (siehe oben, nicht in dieser Sandbox moeglich)

## Runtime-Chat-Overhaul (aus der vorherigen Session, jetzt in `main`)

- [x] Git-Backup-Branch vor dem Umbau angelegt:
      `codex/backup-runtime-chat-overhaul-2026-07-27`
- [x] physischer Projektsnapshot verifiziert:
      `C:\Users\ralle\source\repos\_backups\dbzs-codee-project-backup-2026-07-27-runtime-chat-overhaul`
- [x] `RuntimeChatTab` in kleinere Conversation-First-Komponenten zerlegt:
      `RuntimeChatHeader`, `RuntimeChatConversationFeed`,
      `RuntimeChatComposer`, `RuntimeChatSecondaryPanels`
- [x] kurze Statusfragen als Meta-Intent verdrahtet:
      `Wie weit bist du?`, `Wo stehen wir?`
- [x] knappe Fortsetzung `weiter` als natuerliche Workflow-Fortsetzung akzeptiert
- [x] Runtime-Chat-Goldpfade erneut bestaetigt:
      Web-Typecheck, gezielte Vitest-Laeufe,
      Desktop-Tuning-Lab und Backend-Tuning-Lab gruen
- [x] lokaler App-Start nach dem Umbau erfolgreich:
      `start-dev.ps1`
- [ ] laufende Runtime-Chat-UX in echter Session weiter feinjustieren
- [ ] Vite-Warnungen zu gemischten statischen/dynamischen Imports in
      `backendClient.ts` und `providerRuntimeEvents.ts` spaeter gezielt entflechten

## Main-Readiness und GitHub-Hygiene

- [x] aktives GitHub-Repository live verifiziert:
      `devdbzemusic/dbzs-codee-v4`
- [x] `origin/main`-Stand live verifiziert:
      `934d907650b75855bd5d6487fa5ceaa850ac5a64` (Merge von PR #4)
- [x] offene PRs live verifiziert:
      aktuell keine
- [x] Branch-Protection-Status live verifiziert:
      `main` ist aktuell nicht geschuetzt
- [x] lokaler Required-Gate-Spiegel lief gruen:
      `pnpm ci:local:win`
- [x] Root-Capability-Befehl auf echten Desktop+Backend-Nachweis korrigiert:
      `pnpm test:capabilities`
- [x] aktives Audit und Statuspfad aktualisiert:
      `README.md`, `docs/STATUS_TODAY.md`,
      `docs/audits/MAIN_READINESS_AUDIT_2026-07-27.md`
- [ ] GitHub-CI-Strategie entscheiden:
      Auto-Trigger fuer `push`/`pull_request` reaktivieren
      oder dokumentiertes Interimsmodell beibehalten
- [ ] nach CI-Reaktivierung mindestens einen echten GitHub-Lauf dokumentieren
- [ ] Branch Protection / Merge-Gates fuer `main` sauber nachziehen
- [ ] Windows-Golden-Path auf frischer Umgebung dokumentiert abnehmen

## Repository Review

- [x] `full_repository`-Startpfad verifiziert:
      `runtimeChatStore.ts` sendet kein verirrtes `selectedPaths`
- [x] Batch-Planer verifiziert:
      `reviewBatchPlanner.ts` nutzt `selectedPaths` nur fuer
      `active_file` und `selected_paths`
- [x] Regressionstest vorhanden:
      `full_repository` plus versehentlich gesetztes `selectedPaths`
      erzeugt weiterhin echte Batches
- [x] zielgerichteter Review-Vitest-Lauf war gruen
- [x] Fixture-Lauf gegen
      `test-fixtures/coding-capability-project` war gruen
- [x] Offline-Review-Inventory gehaertet:
      `apps/desktop/src/services/repositoryReview/nodeReviewWorkspaceIo.ts`
      schliesst jetzt vorhandene `.codee`-Artefakte und `.env` konsistent aus
- [ ] Fehlerklassifikation fuer leere Review-Plaene verbessern
- [ ] Diagnose-Export bei `batches: []` expliziter machen

## Struktur und Qualitaet danach

- [ ] weitere Zerlegung grosser Runtime-/Store-Dateien fortsetzen
- [ ] Contract-Parity zwischen Shared und Backend weiter haerten
- [ ] Windows-Golden-Path und Installer-Abnahme in aktive Runbooks ueberfuehren
- [ ] gepacktes-Build-Userdata-Verzeichnis fuer `backupService.ts` an einem echten Installer-Build verifizieren
