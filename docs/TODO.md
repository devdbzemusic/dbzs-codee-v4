# TODO

Stand: 2026-08-01

> Hinweis: Dieses Dokument ist ein historischer Repair-Run-Snapshot vom 2026-07-27. Die aktive Aufgabenliste
> liegt in der Root-Datei `TODO.md`; der aktuelle Tagesstatus liegt in `docs/STATUS_TODAY.md`.

## Jetzt direkt

- [ ] Runtime-Chat-Overhaul-Aenderungen gezielt committen
- [ ] Branch `codex/runtime-chat-overhaul-conversation-first` sauber pushen
- [ ] nur fachliche Dateien committen, nicht `.cache/backend-build/*`
- [ ] Runtime-Chat in der laufenden App weiter auf Auto-Fortsetzung und ruhigere UX pruefen

## Runtime-Chat-Overhaul

- [x] Git-Backup-Branch vor dem Umbau angelegt:
      `codex/backup-runtime-chat-overhaul-2026-07-27`
- [x] physischer Projektsnapshot verifiziert:
      `C:\Users\ralle\source\repos\_backups\dbzs-codee-project-backup-2026-07-27-runtime-chat-overhaul`
- [x] eigener Arbeitsbranch fuer den Umbau angelegt:
      `codex/runtime-chat-overhaul-conversation-first`
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
      `97063959fb54fbc6ba220797773174b4bf990732`
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

## Repair-Run-Fixes aus diesem Block

- [x] Missing-Information-Heuristik an aktuellen Conversational-Flow angepasst:
      `apps/desktop/src/services/missingInformationPolicy.ts`
- [x] Nutzertext fuer `context_overflow` verbessert:
      `apps/desktop/src/services/runtimeRunFinalization.ts`
- [x] Runtime-Chat-Testhelfer an aktuellen Delta-Callback-Fluss angepasst:
      `apps/desktop/src/stores/runtimeChatStore.test.ts`
- [x] Runtime-Test-Patching gegen `urllib.request` wiederhergestellt:
      `backend/app/runtime/service.py`
- [x] Desktop-Capability-Suite im Root-Skriptpfad korrekt aktiviert:
      `scripts/run-desktop-capability-suite.mjs`, `package.json`

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
- [ ] Offline-Review-Inventory haerten:
      `apps/desktop/src/services/repositoryReview/nodeReviewWorkspaceIo.ts`
      soll vorhandene `.codee`-Artefakte aus dem Inventory ausschliessen
- [ ] Fehlerklassifikation fuer leere Review-Plaene verbessern
- [ ] Diagnose-Export bei `batches: []` expliziter machen

## Struktur und Qualitaet danach

- [ ] weitere Zerlegung grosser Runtime-/Store-Dateien fortsetzen
- [ ] Contract-Parity zwischen Shared und Backend weiter haerten
- [ ] Windows-Golden-Path und Installer-Abnahme in aktive Runbooks ueberfuehren
