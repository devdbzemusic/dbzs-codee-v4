# Handover

Stand: 2026-07-25

## Aktueller Fokus

Codee Repository Review ist aktuell nicht stabil, wenn ein Full-Repository-Review
mit gesetztem `activeFile` gestartet wird. Der Lauf endet dann mit
`0/0 Dateien` und `0/0 Batches`, obwohl das Inventory korrekt Dateien sieht.

## Frisch verifizierter Befund

- Diagnose-Lauf:
  `.codee/diag-protokolle/codee-run-run-ms044ucs-yl8l.json`
- Betroffener Review:
  `test-fixtures/coding-capability-project/.codee/reviews/rev-ms044ugn-his5n`
- Beobachtung:
  `inventory.json` enthält 7 Dateien, `review-plan.json` enthält aber
  `batches: []`, der Review endet auf `failed`.

## Wahrscheinliche Ursache

Der Review-Startpfad übergibt bei Repository-Reviews derzeit
`selectedPaths: [activeFile.path]`, auch wenn der Scope bereits
`full_repository` ist.

Zusätzlich filtert `apps/desktop/src/services/repositoryReview/reviewBatchPlanner.ts`
bei vorhandenen `selectedPaths` immer hart auf diese Auswahl. Dadurch kann die
Batch-Planung leer werden, obwohl der Full-Repository-Scope aktiv ist.

## Relevante Stellen

- [apps/desktop/src/stores/runtimeChatStore.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/stores/runtimeChatStore.ts)
- [apps/desktop/src/services/repositoryReview/reviewBatchPlanner.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/reviewBatchPlanner.ts)
- [apps/desktop/src/services/repositoryReview/repositoryInventory.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/repositoryInventory.ts)
- [apps/desktop/src/services/repositoryReview/repositoryReview.test.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/repositoryReview.test.ts)

## Empfohlener Minimal-Fix

1. `selectedPaths` nur für `active_file` oder `selected_paths` an den
   Review-Request hängen, nicht für `full_repository`.
2. `reviewBatchPlanner.ts` defensiv härten:
   `selectedPaths` nur dann als Filter anwenden, wenn der Scope wirklich
   dateibasiert ist.
3. Regressionstest ergänzen:
   `full_repository` plus versehentlich gesetzte `selectedPaths` muss trotzdem
   echte Batches erzeugen.

## Status der heutigen Arbeit

- Desktop-App lokal startbar gemacht.
- Review-Fehler reproduziert und auf Planungs-/Scope-Ebene eingegrenzt.
- Noch kein Code-Fix für den Review-Bug umgesetzt.

## Offene Risiken

- Solange der Fix fehlt, kann Codee bei Repository-Reviews in einen falschen
  `failed`-Zustand laufen, obwohl das Workspace-Inventar gültig ist.
- Die Diagnose-Artefakte referenzieren Report-/Findings-Pfade, die bei diesem
  Fehlerfall nicht erzeugt werden.
