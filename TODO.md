# TODO

Stand: 2026-07-28

## Jetzt direkt

- [ ] Rest des Golden-Path in kurzer echter Sitzung abschliessen: Review bis Ende laufen lassen,
      Aenderung vorschlagen/anwenden, Restore-Point-Rollback, `npm test` aus Agent Workbench,
      Backup/Restore im Diagnostics-Tab, harter Abbruch + Neustart — siehe
      `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md`
- [ ] gepacktes-Build-Userdata-Verzeichnis fuer `backupService.ts` an einem echten Installer-Build verifizieren
- [ ] Modell-Katalog auf dieser Maschine neu scannen (veralteter `runtime_dir`, auch wenn jetzt abgefangen)

## Erledigt: echter interaktiver Golden-Path-Durchlauf mit echtem lokalem Modell

- [x] isolierte Testumgebung aufgesetzt (eigenes `DBZS_APP_DATA_DIR`/`DBZS_DEV_USER_DATA_DIR`/Workspace,
      echtes GGUF-Modell `gemma-3-1b` von dieser Maschine, ohne die echte Nutzerkonfiguration anzutasten)
- [x] Kriterium 1 (App startet fehlerfrei) echt verifiziert
- [x] Kriterium 2 (Projekt oeffnet sich und bleibt gespeichert) echt verifiziert — ueberlebt App-Neustarts
- [x] Kriterium 3 (lokales Modell verbindet sich automatisch) echt verifiziert
- [x] Kriterium 4 (Chat beantwortet Projektfrage) echt verifiziert — echte LLM-Antwort mit Screenshot belegt
- [x] Bug gefunden + gefixt: veralteter `runtime_dir` in `models.catalog.json` wurde unvalidiert uebernommen;
      `ModelIndexService` faellt jetzt auf `first_win_llama_runtime_dir()`-Discovery zurueck (`e9c1e54`),
      Regressionstest ergaenzt
- [x] Regression gefunden + gefixt: der `dbzs:fs:stat`-Guard aus PR #4 brach Modell-Pfadpruefungen
      ausserhalb des Workspace; `stat` ist wieder ungeschuetzt (nur Metadaten, kein Content-Leak),
      `read-file`/`write-file`/`file:save` bleiben beschraenkt (`9aba315`)
- [x] Golden-Path-Verifikationsdokument mit echten Ergebnissen aktualisiert
- [x] Testprozesse (Electron/llama-server/Backend) sauber beendet, temporaeres Testskript entfernt

## Erledigt: Folgearbeit nach PR #4 (direkt auf `main`)

- [x] `AtomicWriteFs.mkdir`-Typfehler behoben (Node-Recursive-Overload-Signatur) — `npm run typecheck` erstmals vollstaendig fehlerfrei
- [x] vier lose Kleinaenderungen committet: `skillRunPersistenceService.ts` (nutzt `writeFileAtomic`),
      `executionHandoff.ts`/`executionIntent.ts(.test)` (Intent-Klassifikation erkennt "Implementierungsplan"/"Umsetzungsplan"/"Fix-Plan")
- [x] Vite-Warnungen zu gemischten statischen/dynamischen Imports in `runtimeChatStoreRuntimeHelpers.ts`
      aufgeloest (`backendClient`, `providerRuntimeEvents` auf statische Imports umgestellt) — `electron-vite build` warnungsfrei
- [x] Repository-Review: neuer `"empty_plan"`-Outcome ersetzt generisches `"failed"` bei nicht-leerem
      Inventar mit null Batches; Grund wird in `review-state.json` persistiert und im Chat angezeigt;
      Regressionstest fuer den vorher ungetesteten Zweig ergaenzt
- [x] Golden-Path-Automatisierung versucht: `env -u ELECTRON_RUN_AS_NODE` erlaubt echten Electron-GUI-Start
      in dieser Sandbox (neuer Fund) — `boot.spec.ts` + UI-Chrome-Specs (11/41 E2E-Tests) automatisiert
      bestaetigt; Rest der Suite braucht eine tatsaechlich verbundene lokale Modell-Runtime
- [x] konsolidierte Golden-Path-Checkliste (14 Punkte) dokumentiert:
      `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md`
- [x] `HANDOVER.md`/`TODO.md` final aktualisiert

## Erledigt: PR #4 (Runtime-Chat-Overhaul + Personal Production Stabilization)

- [x] Runtime-Chat-Overhaul-Aenderungen committet (bereits vor dieser Session: `89ab9f6`, `59ef0a2`, `525b054`)
- [x] Branch `codex/runtime-chat-overhaul-conversation-first` sauber gepusht
- [x] nur fachliche Dateien committet, nicht `.cache/backend-build/*`
- [x] PR #4 erstellt, geprueft (`MERGEABLE`, `CLEAN`) und per Merge-Commit in `main` gemergt
- [x] Feature-Branch lokal und remote geloescht

## Personal Production Stabilization (Basis: `Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_PLAN.md`)

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

## Bewusst zurueckgestellt (Personal-Production-Plan-Philosophie: "vorerst nicht noetig")

- [ ] GitHub-CI-Strategie entscheiden: Auto-Trigger fuer `push`/`pull_request` reaktivieren
      oder dokumentiertes Interimsmodell beibehalten (ohnehin durch GitHub-Billing-Sperre blockiert)
- [ ] nach CI-Reaktivierung mindestens einen echten GitHub-Lauf dokumentieren
- [ ] Branch Protection / Merge-Gates fuer `main` sauber nachziehen
- [ ] weitere Zerlegung grosser Runtime-/Store-Dateien fortsetzen
- [ ] Contract-Parity zwischen Shared und Backend weiter haerten
- [ ] Windows-Golden-Path und Installer-Abnahme in aktive Runbooks ueberfuehren

## Main-Readiness und GitHub-Hygiene (Stand PR #4)

- [x] aktives GitHub-Repository live verifiziert:
      `devdbzemusic/dbzs-codee-v4`
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
- [x] Fehlerklassifikation fuer leere Review-Plaene verbessert:
      neuer `"empty_plan"`-Outcome statt generischem `"failed"`
- [x] Diagnose-Export bei `batches: []` expliziter gemacht:
      `ReviewStateFile.detail` persistiert den konkreten Grund
