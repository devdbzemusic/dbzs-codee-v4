# TODO

Stand: 2026-07-27

## Repository Review

- [x] Repository-Review-Startpfad verifiziert:
      `apps/desktop/src/stores/runtimeChatStore.ts` sendet bei
      `scope === "full_repository"` kein `selectedPaths` aus `activeFile`.
- [x] Batch-Planer verifiziert:
      `apps/desktop/src/services/repositoryReview/reviewBatchPlanner.ts`
      nutzt `selectedPaths` nur für `active_file` und `selected_paths`.
- [x] Regressionstest vorhanden:
      `full_repository` mit versehentlich gesetzten `selectedPaths`
      erzeugt weiterhin echte Batches.
- [x] Zielgerichteter Vitest-Lauf:
      `apps/desktop/src/services/repositoryReview/repositoryReview.test.ts`
      lief lokal grün (`16/16` Tests).
- [x] Praktischen Review im Fixture
      `test-fixtures/coding-capability-project`
      erneut ausgeführt.
- [x] Erwartung im Fixture erfüllt:
      `review-plan.json` enthält Batches,
      `REVIEW_REPORT.md` und `findings.json` wurden erzeugt.
- [ ] Offline-Review-Inventory härten:
      `apps/desktop/src/services/repositoryReview/nodeReviewWorkspaceIo.ts`
      soll vorhandene `.codee`-Artefakte aus dem Inventory ausschließen,
      damit neue Reviews nicht alte Review-Zustände mitanalysieren.

## Optional danach

- [ ] Fehlerklassifikation verbessern:
      leerer Plan sollte als eigener Diagnosefall erkennbar sein,
      nicht nur als generisches `failed`.
- [ ] Diagnose-Export ergänzen:
      bei `batches: []` Ursache im Run-Protokoll explizit notieren.
