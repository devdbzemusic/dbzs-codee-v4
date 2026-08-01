# Handover

Stand: 2026-08-01

> Hinweis: Dieses Dokument ist ein historischer Repair-Run-Snapshot vom 2026-07-27 und nicht mehr die aktive
> Handover-Quelle. Fuer den aktuellen Projektstand gelten die Root-Dateien `HANDOVER.md`, `TODO.md` sowie
> `docs/STATUS_TODAY.md`. Der aktuell frisch verifizierte Remote-Stand ist `origin/main` = `a98e070`
> (Merge von PR #32).

## Repo-Wahrheit

- aktiver GitHub-Remote: `https://github.com/devdbzemusic/dbzs-codee-v4.git`
- lokaler Ordnername bleibt aktuell `dbzs-codee-project`
- `origin/main` zeigt auf `97063959fb54fbc6ba220797773174b4bf990732`
- offene Pull Requests im Live-Repo: keine
- Branch Protection fuer `main`: aktuell nicht aktiv

## Bestaetigter Repair-Run-Stand

Der lokale Nachweis fuer `main`-Readiness ist erbracht:

- `pnpm ci:local:win` lief am 2026-07-27 vollstaendig gruen
- `pnpm test:capabilities` laeuft jetzt korrekt durch
- Desktop Capability Suite: `37/37`
- Backend Capability-/Scenario-/Tuning-Lab-Tests: `15 passed`

Die aktive Detailquelle fuer diesen Nachweis ist:

- [docs/audits/MAIN_READINESS_AUDIT_2026-07-27.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/MAIN_READINESS_AUDIT_2026-07-27.md)

## In diesem Repair-Run aktualisierte Bereiche

- [apps/desktop/src/services/missingInformationPolicy.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/missingInformationPolicy.ts)
  - Rueckfrage- und Akzeptanzheuristiken an den aktuellen Conversational-Flow angepasst
- [apps/desktop/src/services/runtimeRunFinalization.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/runtimeRunFinalization.ts)
  - `context_overflow`-Rueckmeldung fuer Nutzer klarer gemacht
- [apps/desktop/src/stores/runtimeChatStore.test.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/stores/runtimeChatStore.test.ts)
  - Testhelfer auf den aktuellen Delta-Callback-Fluss angepasst
- [backend/app/runtime/service.py](C:/Users/ralle/source/repos/dbzs-codee-project/backend/app/runtime/service.py)
  - `urllib.request` wieder im Modulkontext verfuegbar gemacht, damit Runtime-Tests sauber patchen
- [package.json](C:/Users/ralle/source/repos/dbzs-codee-project/package.json)
- [scripts/run-desktop-capability-suite.mjs](C:/Users/ralle/source/repos/dbzs-codee-project/scripts/run-desktop-capability-suite.mjs)
  - Root-Capability-Befehl fuehrt den Desktop-Anteil jetzt wirklich mit `RUN_CAPABILITY_SUITE=1` aus

## Aktive offene Aufgaben

### P0

- aktuelle Repair-Run-Aenderungen gezielt committen
- Branch sauber pushen
- echte GitHub-CI-Strategie fuer `push` und `pull_request` entscheiden und dokumentieren
- mindestens einen echten GitHub-Workflow-Lauf nach Reaktivierung dokumentieren

### P1

- Windows-Golden-Path auf frischer Umgebung dokumentiert abnehmen
- Branch Protection und Merge-Gates fuer `main` sauber nachziehen
- Offline-Review-Inventory gegen `.codee`-Artefakte haerten:
  - [apps/desktop/src/services/repositoryReview/nodeReviewWorkspaceIo.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/nodeReviewWorkspaceIo.ts)

## Wichtige Hinweise

- Historische Papiere unter `Pläne/` oder `docs/archive/` koennen falsche Repo- oder PR-Annahmen enthalten.
- Die aktuellen Wahrheitsquellen sind `README.md`, `TODO.md`, `docs/STATUS_TODAY.md` und das Audit unter `docs/audits/`.
- Im Worktree liegen generierte Artefakte unter `.cache/backend-build/`; diese gehoeren nicht automatisch in den naechsten Commit.
