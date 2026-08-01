# DBZS Codee V4

Aktiver Remote: [devdbzemusic/dbzs-codee-v4](https://github.com/devdbzemusic/dbzs-codee-v4)

Lokaler Ordnername und einige historische Dokumente verwenden noch `dbzs-codee-project`. Fuer den aktuellen Projektstatus gilt der GitHub-Remote `dbzs-codee-v4` als Quelle der Wahrheit.

## Aktueller Stand

Stand: 2026-08-01

- [PR #32](https://github.com/devdbzemusic/dbzs-codee-v4/pull/32) ist gemergt: `origin/main` zeigt nach
  frischem `git fetch` auf `a98e070`. Enthalten sind die Desktop-Bridge-Contracts, IPC-Regressionstests und
  die Plan-14-Fortsetzung fuer echte `POST /embeddings`- und `POST /rerank`-Endpunkte auf Basis des
  bestehenden ONNX-/Model-Lab-Pfads. Der lokale Branch `feature/runtime-chat-ux-overhaul` ist mit
  `origin/feature/runtime-chat-ux-overhaul` synchron und gegenueber `origin/main` nur um diesen Merge-Commit
  hinterher.
- [PR #31](https://github.com/devdbzemusic/dbzs-codee-v4/pull/31) ist gemergt: Model-Lab-sourcierter
  Embedding-Modell-Picker und konkretere Runtime-Exclusion-Gruende in der UI.
- [PR #14](https://github.com/devdbzemusic/dbzs-codee-v4/pull/14) (Abnahme-Test-Playbook-Infrastruktur, plus
  drei begleitende Runtime-Chat-Fixes) ist gemergt: `pnpm acceptance:new-run` legt einen strukturierten
  Abnahme-Run an (`Pläne/10 DBZS_CODEE_V4_ABNAHME_TEST_PLAYBOOK.md`), `verification-run.json`-Generator,
  Vorher-/Nachher-Hashes für Patch-Apply/Rollback, Doku-Drift-Checker (`pnpm docs:check-drift`), und ein
  echter, vollständig ausgeführter `SERVICE_VERIFIED`-Lauf (SV-01, SV-03–09 PASS, SV-02-Wrapper BLOCKED weil
  `pnpm`/`uv` in der Sandbox fehlen — Teilschritte einzeln alle grün).
- [PR #13](https://github.com/devdbzemusic/dbzs-codee-v4/pull/13) (Produktionsreife-Revision Phase 4 —
  Installer & Updatefähigkeit, plus drei begleitende Runtime-Chat-Fixes) ist gemergt: Diagnose-ZIP-Export
  (crash.log/Settings/Modellindex gebündelt, ohne neue npm-Abhängigkeit), Repair-Mode fürs Restore-Point-Index
  (`rebuildIndexFromDisk()`), versioniertes Settings-Migrations-Framework mit Backup-vor-Migration,
  Code-Signing-Grundgerüst in `electron-builder.yml`.
- [PR #12](https://github.com/devdbzemusic/dbzs-codee-v4/pull/12) (Produktionsreife-Revision Phase 3 —
  Release-Gates vorbereitet, Status-Doku-Sync) ist gemergt.
- [PR #11](https://github.com/devdbzemusic/dbzs-codee-v4/pull/11) (Produktionsreife-Revision Phase 2 —
  Runtime-Härtung) ist gemergt: Vision-GPU-Exklusivität (`fast_gpu`/`vision_gpu` teilen sich eine GPU und
  laufen nie gleichzeitig), Vision-Broker-Routing (`defaultVisionModelId` ist kein `orphaned`-Setting mehr),
  Prozess-Supervisor mit Health-Heartbeat und Restart-Budget (erkennt Absturz-Zustände und startet automatisch
  neu, begrenzt auf 3 Versuche/5 Minuten). Details in [HANDOVER.md](HANDOVER.md)/[TODO.md](TODO.md).
- [PR #10](https://github.com/devdbzemusic/dbzs-codee-v4/pull/10) (Produktionsreife-Revision Phase 1 —
  Stabilitäts-Sprint) ist gemergt: Rollenmodell-Fallback-Kette statt hartem `"Rollenmodell in Settings
  fehlt"`-Abbruch, Crash-Correlation-ID (`run_id`) von Desktop bis ins Backend-Log und `crash.log`.
- Beide Phasen basieren auf `Pläne/09 DBZS_CODEE_V4_REPOSITORY_URTEIL_2026-07-31.md` (externe
  Repository-Bewertung, 7,8/10). Phase 3 (Release-Gates: CI-Reaktivierung, Branch Protection) ist
  code-/dokuseitig vorbereitet, aber bewusst nicht selbst ausgeführt — das ist eure Entscheidung, siehe
  `HANDOVER.md`.
- [PR #6](https://github.com/devdbzemusic/dbzs-codee-v4/pull/6) (Vision-Slot-Grundlage Phase 1, Workflow-Audit-P0-Fixes, `RuntimeModelsTab`-Refactor) ist gemergt (Merge-Commit `f909fd9`): eine additive `vision_gpu`-Runtime-Slot-Grundlage (`Pläne/07 CODEE_MODELL_ROLLEN_MATRIX.md`) und mehrere P0-Fixes aus dem Workflow-Audit `Pläne/08 CODEE_V4_WORKFLOW_AUDIT.md` (Tool-Only-Antworten werden nicht mehr als Erfolg gewertet, ehrliches Completion-Gate, Pfad-Normalisierung fuer Workspace-Tools, System-/Tool-Result-Nachrichten werden im Hauptchat eingeklappt).
- [PR #5](https://github.com/devdbzemusic/dbzs-codee-v4/pull/5) (Runtime-Chat-Overhaul-Folgearbeit: Dateianhaenge, Model Control Center, generische Chat-Folgeaktionen) ist gemergt (Merge-Commit `210f0ff`).
- [PR #4](https://github.com/devdbzemusic/dbzs-codee-v4/pull/4) (Runtime-Chat-Overhaul + Personal Production Stabilization) ist gemergt.
- Direkt danach wurden auf `main` mehrere kleine Restpunkte abgearbeitet (Typfehler, Vite-Warnungen, Review-Fehlerklassifikation) sowie ein echter interaktiver Golden-Path-Durchlauf mit einem echten lokalen Modell gefahren.
- Der echte Durchlauf hat zwei reale Bugs aufgedeckt und behoben, die keine gemockten Tests haetten finden koennen (veralteter Modell-Katalog-Eintrag; eine Regression aus dem eigenen `dbzs:fs:*`-IPC-Sicherheits-Fix von PR #4) — Details in [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md) (`UI_VERIFIED`, teilweise).
- Ergaenzend dazu ist die sichere Aenderungskette (Diff/Approval/Apply/Tests/Rollback) sowie Backup/Restore und Crash-Recovery auf Service-Ebene vollstaendig verifiziert — siehe [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md](docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md) (`SERVICE_VERIFIED`).
- `npm run typecheck` (apps/desktop) ist seitdem erstmals vollstaendig fehlerfrei.
- GitHub-CI ist weiterhin nicht automatisch an `push` oder `pull_request` gebunden (GitHub-Billing-Sperre seit
  2026-07-23, Reaktivierungs-Checkliste in `HANDOVER.md`).
- `origin/main` zeigt auf `a98e070` (Merge von PR #32).
- Offene Pull Requests im Repo `devdbzemusic/dbzs-codee-v4`: keine.
- Branch Protection fuer `main`: aktuell nicht aktiv (dokumentierter, nicht ausgefuehrter Aktivierungsbefehl in `HANDOVER.md`).
- Die zuvor aufgefallenen Plan-Dateien `Pläne/14 DBZS_CODEE_BACKEND_BRIDGE_REVIEW.md` und
  `Pläne/Codee_Agentenmodelle_Auswahl_Liste Teil I.md` sind im aktuellen Git-Stand getrackt.

Der vorherige Repair-Run vom 2026-07-27 (Backup-Branch `codex/backup-runtime-chat-overhaul-2026-07-27`,
physischer Snapshot unter `C:\Users\ralle\source\repos\_backups\dbzs-codee-project-backup-2026-07-27-runtime-chat-overhaul`)
war bewusst auf Nachweis, Doku-Wahrheit und GitHub-Hygiene ausgerichtet. Der aktuelle Fokus liegt auf
persoenlicher Produktivnutzung statt oeffentlicher Release-Reife — siehe `Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_PLAN.md`.

## Runtime-Chat-Overhaul

Seit PR #4 Teil von `main`. Der Runtime-Chat priorisiert Gespraechsfuehrung vor Technikflaechen:

- Conversation-Feed und Composer dominieren die Standardansicht.
- Panels, Slots und Routing-Diagnose bleiben erhalten, sind aber sekundaer.
- Kurze Antworten wie `weiter`, `mach weiter` oder `genau so` werden bevorzugt
  als Fortsetzung behandelt.
- Statusfragen wie `Wie weit bist du?` oder `Wo stehen wir?` werden als direkte
  Meta-Anfrage erkannt.
- Die Tuning-Lab-Goldpfade fuer Runtime-Chat wurden erneut gruen bestaetigt.

Der Desktop liess sich nach diesem Umbau lokal erfolgreich ueber `pnpm dev`
beziehungsweise `start-dev.ps1` starten.

## RAG-Embeddings und Reranking

Plan 14 Phase 2 ist im aktuellen Stand ueber die reine ONNX-Embedding-Engine hinaus erweitert:

- `POST /rag/embeddings/generate` erzeugt Embeddings aus Model-Lab-ONNX-Bundles.
- `POST /embeddings` stellt den OpenAI-kompatiblen Vertrag bereit, den der bestehende Desktop-RAG-Flow bereits
  erwartet.
- `POST /rerank` stellt den Cohere-kompatiblen Vertrag fuer Cross-Encoder-Reranking bereit.
- `defaultEmbeddingModelId` und `defaultRerankerModelId` werden ueber Model-Lab-gefilterte Settings-Felder
  konfiguriert.

Frisch dokumentierte Verifikation fuer diesen Slice: Backend 514/514 mit zwei bewusst deselektierten,
vorbestehend haengenden Fremdtests; Desktop-Vitest 1361/1361; beide Typechecks fehlerfrei.

## Runtime-Chat-Dateianhaenge

Im aktuellen Arbeitsbranch `feature/runtime-chat-ux-overhaul` ist die bisherige Bildstrecke zu einer generischen
Attachment-Pipeline ausgebaut:

- unterstuetzte Dateitypen: Bilder plus `pdf`, `zip`, `md`, `json`, `js`, `ts`, `tsx`, `py`, `txt`
- Anhaengen ueber gemeinsamen Datei-Dialog mit Mehrfachauswahl oder per `Strg+V` fuer Clipboard-Datei-Items
- sichtbare Vorschau direkt im Composer und an der gesendeten Nachricht
- Text-/Code-Dateien werden als lesbarer strukturierter Kontext in den User-Turn uebernommen
- PDF wird lokal zu Text extrahiert
- ZIP wird lokal temporaer entpackt, inventarisiert und fuer erlaubte Text-/Code-Dateien inline aufbereitet
- Vision-Gating bleibt auf echte Bildpayloads begrenzt; Dokumente/Archive setzen kein automatisches Vision-Flag

Frisch geprueft fuer diesen Slice:

```powershell
cd apps/desktop
npm run typecheck
npm run test -- src/components/RuntimeChatTab.test.tsx src/services/providerRequestPreflight.test.ts src/services/modelSelectionBroker.test.ts src/stores/runtimeChatStoreAssistantAnswerFlows.test.ts src/stores/runtimeChatStoreRoutingPhase.test.ts

cd ..\..
backend\.venv\Scripts\python.exe -m pytest backend/tests/test_runtime_api.py backend/tests/test_runtime_chat_attachments.py -q
```

## Runtime Model Control Center

Im aktuellen Arbeitsbranch `feature/runtime-chat-ux-overhaul` ist der `RuntimeModelsTab` zusaetzlich zu einem
kompakten Runtime-Model-Control-Dashboard verdichtet:

- `Startbare Modelle` zeigen jetzt Rollen-, Routing- und Aktions-Summaries direkt ueber der Tabelle
- die Modellliste priorisiert laufende Modelle sowie starke Routing-Kandidaten wie `Vision + Code` und `Text + Code`
- `Multimodale Paare` haben getrennte Source- und Action-Summaries fuer Probe-, Zuordnungs- und Blockerstatus
- sichtbare Hilfsartefakte zeigen Typ-, Aktions- und Status-Summaries und werden handlungsorientiert sortiert
- die Detailtabellen bleiben erhalten; die neue Verdichtung soll die Runtime-Steuerung schneller scanbar machen,
  ohne den bestehenden Integrationspunkt `runtime={<RuntimeModelsTab />}` aufzubrechen

Frisch geprueft fuer diesen Slice:

```powershell
cd apps/desktop
npm run test -- src/components/notebook/RuntimeModelsTab.test.ts src/services/modelSelectionBroker.test.ts
npm run typecheck
```

## Bestaetigte Nachweise

### Required Gates

Der lokale Spiegel der Required Gates lief erfolgreich durch:

```powershell
pnpm ci:local:win
```

Enthaltene Bloecke:

- Dependency-Install und Backend-Sync
- Repo-Health
- Contract Verification
- Shared- und Desktop-Typecheck
- Shared- und Desktop-Tests
- Desktop-Capability-Suite
- Backend-Pytest
- Desktop-Build
- Packaging-Smoke
- Security-Regression-Tests
- Backend-Smoke
- Backend-Doctor
- Dependency-Audit

### Capability-Pfad

Der kombinierte Capability-Nachweis besteht aus Desktop- und Backend-Teil:

```powershell
pnpm test:capabilities
```

Bestaetigt am 2026-07-27:

- Desktop Capability Suite: 37/37
- Backend Capability-/Scenario-/Tuning-Lab-Fixtures: 15 Tests bestanden

### Runtime-Chat-Tuning-Lab

Die aktuelle Runtime-Chat-Abnahme fuer den Conversational-Umbau wurde lokal erneut
bestaetigt ueber:

```powershell
pnpm --filter @dbzs/desktop exec tsc --noEmit -p tsconfig.web.json
pnpm --filter @dbzs/desktop exec vitest run src/components/RuntimeChatTab.test.tsx src/services/conversationMetaIntent.test.ts src/services/workflowContinuation.review.test.ts
$env:RUN_CAPABILITY_SUITE='1'; pnpm --filter @dbzs/desktop exec vitest run src/testing/codingAssistant/tuningLabCapabilitySuite.test.ts
cd backend
uv run pytest tests/test_runtime_chat_tuning_lab_fixture.py -q
```

## CI-Realitaet

Aktuell gilt:

- `.github/workflows/ci.yml` laeuft nur per `workflow_dispatch`
- `.github/workflows/release.yml` reagiert auf Tag-Pushes `v*-rc.*`
- der lokale Qualitaets-Gate-Spiegel bleibt `pnpm ci:local:win`

Solange automatische GitHub-Trigger nicht wieder aktiviert sind, ist lokales Required-Gate-Passing vor Merge Pflicht.

## Quickstart

```powershell
git clone https://github.com/devdbzemusic/dbzs-codee-v4.git
cd dbzs-codee-v4
pnpm install
cd backend
uv sync
cd ..
pnpm dev
```

## Wichtige Befehle

```powershell
pnpm ci:local:win
pnpm test:capabilities
pnpm build
pnpm smoke:packaging
pnpm smoke:backend
pnpm doctor:backend
```

## Aktive Statusdokumente

- [docs/STATUS_TODAY.md](docs/STATUS_TODAY.md)
- [docs/architecture/README.md](docs/architecture/README.md)
- [docs/audits/MAIN_READINESS_AUDIT_2026-07-27.md](docs/audits/MAIN_READINESS_AUDIT_2026-07-27.md)
- [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md)
- [HANDOVER.md](HANDOVER.md)
- [TODO.md](TODO.md)

## Wichtige Einschraenkungen

- Der lokale Readiness-Nachweis ersetzt keinen echten GitHub-Run auf `push` oder `pull_request`, solange `ci.yml` nur manuell ausloesbar ist.
- Die aktuelle Arbeitskopie enthaelt neben Quellcodeaenderungen auch generierte Packaging-Artefakte unter `.cache/backend-build/`; diese gehoeren nicht automatisch in einen Commit.
- Historische Statuspapiere unter `Pläne/` oder `docs/archive/` koennen veraltete Repo-, PR- oder Gate-Annahmen enthalten und muessen gegen die aktiven Audit-Dokumente geprueft werden.
