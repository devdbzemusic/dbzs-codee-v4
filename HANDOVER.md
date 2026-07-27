# Handover

Stand: 2026-07-27

## Aktueller Arbeitsbranch

- aktiver Arbeitsbranch: `codex/runtime-chat-overhaul-conversation-first`
- Sicherheits-Backup-Branch: `codex/backup-runtime-chat-overhaul-2026-07-27`
- physischer Snapshot:
  `C:\Users\ralle\source\repos\_backups\dbzs-codee-project-backup-2026-07-27-runtime-chat-overhaul`

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

## Zusaetzlich heute umgesetzt: Runtime-Chat-Overhaul

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

## Frisch verifizierte Checks fuer den Runtime-Chat-Umbau

- `pnpm --filter @dbzs/desktop exec tsc --noEmit -p tsconfig.web.json`
- `pnpm --filter @dbzs/desktop exec vitest run src/components/RuntimeChatTab.test.tsx src/services/conversationMetaIntent.test.ts src/services/workflowContinuation.review.test.ts`
- `RUN_CAPABILITY_SUITE=1 pnpm --filter @dbzs/desktop exec vitest run src/testing/codingAssistant/tuningLabCapabilitySuite.test.ts`
- `cd backend && uv run pytest tests/test_runtime_chat_tuning_lab_fixture.py -q`
- lokaler App-Start ueber `start-dev.ps1` erfolgreich

## Aktive offene Aufgaben

### P0

- aktuelle Runtime-Chat-Overhaul-Aenderungen gezielt committen
- Branch sauber pushen
- echte GitHub-CI-Strategie fuer `push` und `pull_request` entscheiden und dokumentieren
- mindestens einen echten GitHub-Workflow-Lauf nach Reaktivierung dokumentieren

### P1

- laufende Runtime-Chat-UX in echter Session weiter feinjustieren
- Vite-Warnungen fuer gemischte statische/dynamische Imports spaeter entflechten
- Windows-Golden-Path auf frischer Umgebung dokumentiert abnehmen
- Branch Protection und Merge-Gates fuer `main` sauber nachziehen
- Offline-Review-Inventory gegen `.codee`-Artefakte haerten:
  - [apps/desktop/src/services/repositoryReview/nodeReviewWorkspaceIo.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/nodeReviewWorkspaceIo.ts)

## Wichtige Hinweise

- Historische Papiere unter `Pläne/` oder `docs/archive/` koennen falsche Repo- oder PR-Annahmen enthalten.
- Die aktuellen Wahrheitsquellen sind `README.md`, `TODO.md`, `docs/STATUS_TODAY.md` und das Audit unter `docs/audits/`.
- Im Worktree liegen generierte Artefakte unter `.cache/backend-build/`; diese gehoeren nicht automatisch in den naechsten Commit.
