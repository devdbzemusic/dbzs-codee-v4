# TODO

Stand: 2026-07-27

## Jetzt direkt

- [ ] Repair-Run-Aenderungen gezielt committen
- [ ] Branch `codex/godfiles-split-top3` sauber pushen
- [ ] nur fachliche Dateien committen, nicht `.cache/backend-build/*`

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
