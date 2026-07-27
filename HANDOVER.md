# Handover

Stand: 2026-07-27

## Aktueller Fokus

Der zuvor dokumentierte Repository-Review-Bug bei `full_repository` ist im
gemergten Stand bereits enthalten. Die praktische Verifikation gegen das
Fixture `test-fixtures/coding-capability-project` lief erfolgreich durch.
Neuer Fokus ist jetzt die Bereinigung des Review-Inventars, weil der
Node-basierte Offline-Review vorhandene `.codee`-Artefakte mit analysiert.

## Frisch verifizierter Stand

- GitHub-Stand:
  PR `#1` wurde am 27. Juli 2026 in `main` gemergt.
- Review-Startpfad:
  [apps/desktop/src/stores/runtimeChatStore.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/stores/runtimeChatStore.ts)
  hängt `selectedPaths` nur noch dann an, wenn der Scope **nicht**
  `full_repository` ist.
- Batch-Planer:
  [apps/desktop/src/services/repositoryReview/reviewBatchPlanner.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/reviewBatchPlanner.ts)
  nutzt `selectedPaths` nur für `active_file` und `selected_paths`.
- Regressionstest:
  [apps/desktop/src/services/repositoryReview/repositoryReview.test.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/repositoryReview.test.ts)
  enthält bereits den Test
  `ignores a stray selectedPaths for full_repository and still produces batches`.
- Lokale Verifikation:
  `pnpm test -- src/services/repositoryReview/repositoryReview.test.ts`
  lief am 27. Juli 2026 grün durch (`16/16` Tests).
- Fixture-Verifikation:
  `pnpm test -- src/services/repositoryReview/codingCapabilityFixture.repro.test.ts`
  lief am 27. Juli 2026 grün durch (`1/1` Test).
  Dabei wurden `review-plan.json`, `REVIEW_REPORT.md` und `findings.json`
  unter
  `test-fixtures/coding-capability-project/.codee/reviews/rev-coding-capability-fixture/`
  neu erzeugt.

## Historischer Befund

Der frühere Diagnose-Lauf
`.codee/diag-protokolle/codee-run-run-ms044ucs-yl8l.json`
bleibt als Nachweis für den ursprünglich reproduzierten Fehlerfall relevant.
Das dazugehörige Handover vom 25. Juli 2026 ist inhaltlich überholt.

## Relevante Stellen

- [apps/desktop/src/stores/runtimeChatStore.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/stores/runtimeChatStore.ts)
- [apps/desktop/src/services/repositoryReview/reviewBatchPlanner.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/reviewBatchPlanner.ts)
- [apps/desktop/src/services/repositoryReview/repositoryReview.test.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/repositoryReview.test.ts)
- [test-fixtures/coding-capability-project](C:/Users/ralle/source/repos/dbzs-codee-project/test-fixtures/coding-capability-project)

## Neuer Anschlussbefund

- Der leere `full_repository`-Plan ist behoben.
- Der praktische Fixture-Lauf zeigt aber, dass
  [apps/desktop/src/services/repositoryReview/nodeReviewWorkspaceIo.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/nodeReviewWorkspaceIo.ts)
  vorhandene `.codee/reviews/...`-Artefakte nicht aus dem Inventory filtert.
- Dadurch landen interne Review-Zustände und alte Reports in neuen Batches.
  Das erklärt den grün laufenden Durchsatz bei gleichzeitig niedriger
  Analysequalität und schwacher Signalstärke im erzeugten Report.
