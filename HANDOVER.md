# Handover

Stand: 2026-07-31

## Produktionsreife-Revision Phase 4 umgesetzt (2026-07-31) — Installer & Updatefähigkeit

Basis: `Pläne/09 DBZS_CODEE_V4_REPOSITORY_URTEIL_2026-07-31.md`, Umsetzungsplan Phase 4. Wie im Plan
angekündigt bewusst Grundgerüst-Charakter (aktuell kein echter Migrationsschritt noetig, kein echtes
Zertifikat vorhanden) — aber jeweils vollstaendig funktionsfaehig und getestet, kein totes Geruest.

- **Diagnose-ZIP-Export** (`apps/desktop/electron/diagnosticsZipExport.ts`, neu): buendelt `crash.log`,
  redigierte Settings und den Modellindex-Snapshot in ein ZIP. Bewusst **ohne neues npm-Package** — ein
  minimaler ZIP-Writer (STORE-Methode, unkomprimiert) ueber Node's eingebautes `zlib.crc32` reicht fuer eine
  Handvoll kleiner Diagnosedateien. Neuer IPC-Handler `dbzs:diagnostics:export-full-zip` plus Button
  "📦 Vollpaket exportieren" in `RuntimeSlotPanel.tsx`. **Bewusst nicht enthalten:** Trace-Events pro Lauf —
  die brauchen eine Run-ID-Auswahl, fuer die dieser globale Export keinen Kontext hat; das waere ein
  separater, Run-bezogener Export.
- **Repair-Mode-Grundgerüst**: `RestorePointService.rebuildIndexFromDisk()` (neu) behebt genau den in der
  Leck-Audit-Session gefundenen Bug — ein korruptes `index.json` machte bisher alle existierenden Restore
  Points unsichtbar, obwohl die einzelnen `<id>.json`-Punktdateien unangetastet blieben. Die neue Funktion
  baut den Index direkt aus den vorhandenen Punktdateien neu auf (defekte Dateien werden uebersprungen und
  gemeldet, nicht stillschweigend verworfen). Neuer IPC-Handler `dbzs:restore-points:repair-index` plus
  "🔧 Reparieren"-Button in `FileToolsPanel.tsx`.
- **Settings-Migrations-Framework** (`backend/app/settings/migrations.py`, neu): versionierter Runner statt
  des bisherigen Ad-hoc-Inline-Sonderfalls ("schemaVersion fehlt" in `service.py`). Migrationen werden nach
  Zielversion registriert (`MIGRATIONS: dict[int, MigrationFn]`) und der Reihe nach angewendet; eine Luecke
  in der Kette stoppt den Runner statt stillschweigend vorzuspringen. `SettingsService.load()` sichert
  `settings.json` **vor** einer echten Migration (`settings.json.pre-migration-v{X}-to-v{Y}.<timestamp>`) —
  nicht fuer den trivialen "Feld fehlt komplett"-Fall, nur wenn tatsaechlich Inhalte transformiert wurden.
  Aktuell `CURRENT_SCHEMA_VERSION == 1`, keine echte Migration registriert. **Bewusst nicht enthalten:** eine
  Modellindex-Migration — der Modellindex wird bei jedem Boot frisch aus dem Dateisystem aufgebaut
  (`ModelIndexService.build_index()`), nicht als versioniertes Dokument persistiert und vorwaerts migriert,
  daher passt dasselbe Framework dort nicht direkt.
- **Code-Signing-Grundgerüst**: `electron-builder.yml` bekommt erklaerende Kommentare bei `win:`/`mac:`, wo
  Signierung/Notarisierung ansetzen wuerde (`CSC_LINK`/`CSC_KEY_PASSWORD`-Env-Vars fuer beide Plattformen,
  zusaetzlich `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` fuer macOS-Notarisierung) —
  electron-builder erkennt diese automatisch, sobald sie gesetzt sind, ohne YAML-Aenderung. `signAndEditExecutable: false`
  bleibt bewusst unveraendert. **Checkliste, sobald ein echtes Zertifikat vorhanden ist:**
  1. Zertifikat als `.pfx` (Windows) / `.p12` (macOS) sicher ablegen (nicht im Repo).
  2. `CSC_LINK` (Pfad oder base64) und `CSC_KEY_PASSWORD` als Umgebungsvariablen im Build-Kontext setzen.
  3. Fuer macOS zusaetzlich `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` setzen.
  4. `signAndEditExecutable: true` in `electron-builder.yml` setzen (win-Sektion).
  5. Einen Test-Build fahren und die Signatur pruefen (`signtool verify` / `codesign --verify`).

Geänderte/neue Dateien: `apps/desktop/electron/diagnosticsZipExport.ts` (+Test), `apps/desktop/electron/main.ts`,
`apps/desktop/electron/preload.ts`, `apps/desktop/src/services/backendClient.ts`,
`apps/desktop/src/types/global.d.ts`, `apps/desktop/src/components/RuntimeSlotPanel.tsx`,
`apps/desktop/electron/restorePointService.ts` (+Test), `apps/desktop/src/stores/gitStore.ts`,
`apps/desktop/src/components/FileToolsPanel.tsx`, `backend/app/settings/migrations.py` (+Test),
`backend/app/settings/service.py` (+2 neue Tests in `test_settings.py`), `apps/desktop/electron-builder.yml`.

Frisch verifiziert in dieser Session (2026-07-31):

- `backend\.venv\Scripts\python.exe -m pytest backend\tests\test_settings.py backend\tests\test_settings_migrations.py -q`
  - 18 Tests gruen, 1 bekannte `StarletteDeprecationWarning`
- `.\node_modules\.bin\vitest.CMD run electron/diagnosticsZipExport.test.ts electron/restorePointService.test.ts`
  in `apps/desktop`
  - 2 Testdateien / 18 Tests gruen
- `.\node_modules\.bin\vitest.CMD run src/components/RuntimeSlotPanel.test.tsx` in `apps/desktop`
  - 1 Testdatei / 5 Tests gruen
- `.\node_modules\.bin\tsc.CMD --noEmit -p tsconfig.node.json` in `apps/desktop`
  - fehlerfrei
- `.\node_modules\.bin\tsc.CMD --noEmit -p tsconfig.web.json` in `apps/desktop`
  - fehlerfrei

Hinweis: globales `pnpm` war in dieser Shell nicht im PATH; Desktop-Checks wurden deshalb ueber die lokalen
`apps/desktop/node_modules/.bin`-Binaries ausgefuehrt.

## Produktionsreife-Revision Phase 3 vorbereitet (2026-07-31) — Release-Gates

Basis: `Pläne/09 DBZS_CODEE_V4_REPOSITORY_URTEIL_2026-07-31.md`, Umsetzungsplan Phase 3 ("Release-Gates").
Diese Phase ist **code-/dokuseitig vollständig vorbereitet**, aber bewusst nicht selbst ausgeführt — beide
Punkte sind eure Entscheidung (Kategorie B: externe Konto-/Repo-Einstellung, kein Code-Problem):

- **CI-Reaktivierung**: `.github/workflows/ci.yml` bleibt `workflow_dispatch`-only (GitHub-Billing-Sperre
  seit 2026-07-23, siehe Kommentar im File). Eine fertige, auskommentierte `on: push/pull_request`-Sektion
  liegt direkt über der aktiven `on:`-Zeile. **Reaktivierungs-Checkliste, sobald das Billing gelöst ist:**
  1. Auskommentierten Block einkommentieren, `workflow_dispatch:`-Zeile darunter entfernen (oder als
     zusätzlichen Trigger behalten, falls manuelles Auslösen weiter gewünscht ist).
  2. Einen Push machen und **bestätigen, dass tatsächlich ein Run startet** — eine Billing-Sperre kann
     Trigger stillschweigend ignorieren statt einen Fehler zu zeigen.
  3. Nach einem grünen Lauf: Required-Status-Checks (siehe unten) aktivieren.
- **Branch Protection für `main`**: aktuell keine aktiv. Dokumentierter, **nicht ausgeführter** Befehl für
  Required-Status-Checks (erst nach einem grünen CI-Lauf sinnvoll, sonst blockiert er jeden Merge):

  ```bash
  gh api -X PUT repos/devdbzemusic/dbzs-codee-v4/branches/main/protection \
    -f required_status_checks.strict=true \
    -f 'required_status_checks.checks[][context]=Required gates (ubuntu-latest)' \
    -f 'required_status_checks.checks[][context]=Required gates (windows-latest)' \
    -f enforce_admins=true \
    -f 'required_pull_request_reviews.required_approving_review_count=0' \
    -f restrictions=null
  ```

  Das ändert Push-Rechte auf `main` — bewusst nicht ohne expliziten Auftrag ausgeführt. Nach Aktivierung:
  direkte Pushes auf `main` sind nicht mehr möglich, nur noch über PR mit grünem CI-Lauf.

## Produktionsreife-Revision Phase 2 umgesetzt (2026-07-31)

Basis: `Pläne/09 DBZS_CODEE_V4_REPOSITORY_URTEIL_2026-07-31.md`, Umsetzungsplan Phase 2 ("Runtime-Härtung").
Voller Desktop-Vitest-Lauf (1281 Tests grün, 42 geskippt), voller Backend-Pytest-Lauf (446 grün), beide
Typechecks fehlerfrei.

- **Vision-GPU-Exklusivität** (`backend/app/runtime/gpu_exclusivity.py`, neu): `fast_gpu` und `vision_gpu`
  teilen sich eine GPU und dürfen nie gleichzeitig ein Modell resident halten. `RuntimeService.start_model()`
  ruft vor dem tatsächlichen Prozessstart `_enforce_gpu_exclusivity()` auf, die den jeweils anderen GPU-Slot
  sauber stoppt — mit begrenztem Warten auf laufende Requests (`wait_for_slot_drain`, Default 10s) statt
  Hard-Kill. CPU-Slots (`quality_cpu`, `orchestrator_cpu`, `utility`) sind unbetroffen.
- **Vision-Broker-Routing** (`modelSelectionBroker.ts`): ein Modell, das strikt einen Vision-Projector
  benötigt (`modelRequiresVisionProjector`), wird jetzt zwingend auf `vision_gpu` geroutet statt auf
  `quality_cpu`/`fast_gpu` (die den Projector nie laden). Ein Dual-Chat+Vision-Modell, das als normales
  Rollenmodell läuft, bleibt bewusst auf seinem Slot — nur echte Vision-only-Modelle werden umgeleitet.
  `defaultVisionModelId` wird jetzt tatsächlich für die vier Vision-Task-Typen
  (`image_analysis`/`ui_analysis`/`visual_debugging`/`document_vision`) konsultiert und ist damit kein
  `orphaned`-Setting mehr (`settingsRegistry.ts`: `user_tunable`/`model_select`). Die dafür nötige Verbreiterung
  des `contextSlotId`-Typs (3 → 4 Slot-IDs) wurde in allen 4 betroffenen Store-Dateien konsistent nachgezogen.
- **Prozess-Supervisor mit Health-Heartbeat + Restart-Budget** (`apps/desktop/src/services/runtimeProcessSupervisor.ts`,
  neu): periodischer Check (60s-Intervall, analog zum bestehenden Idle-Watcher in `lazyRuntimePolicy.ts`)
  erkennt einen Slot, der von "running" auf "error" gewechselt hat, und startet ihn mit dem zuletzt bekannten
  Modell neu — begrenzt auf 3 Versuche pro 5-Minuten-Fenster, danach manuelle Intervention nötig (keine
  Neustart-Stürme). Ein deliberater Stop (Idle-Eviction, manueller Stop → state "stopped") wird nie als Absturz
  interpretiert. `restartSlot()` in `runtimeSlotManager.ts` hat damit erstmals einen echten Aufrufer.
  Health-Zustand pro Slot ist in `RuntimeSlotPanel.tsx` sichtbar (Restart-Versuche, Budget erschöpft).

Geänderte Dateien: neue `backend/app/runtime/gpu_exclusivity.py` (+`tests/test_gpu_exclusivity.py`, +4 neue
Integrationstests in `test_runtime_service.py`), `apps/desktop/src/services/modelSelectionBroker.ts` (+Test),
neue `apps/desktop/src/services/runtimeProcessSupervisor.ts` (+Test), `apps/desktop/src/components/RuntimeSlotPanel.tsx`,
`apps/desktop/src/settings/settingsRegistry.ts` (+Test), `apps/desktop/src/stores/runtimeChatStore.ts`,
`apps/desktop/src/stores/runtimeChatStoreRoutingPhase.ts`, `apps/desktop/src/stores/runtimeChatStoreOnDemandPreparation.ts`,
`apps/desktop/src/stores/runtimeChatStoreOnDemandExecution.ts`.
**Noch offen:** manuelle Bestätigung in einer echten Session mit zwei geladenen Modellen (siehe
`docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`, Abschnitt D.3) — GPU-Exklusivität und der Supervisor
wurden nur gegen Fakes verifiziert, nie gegen einen echten llama-server-Prozess.

## Produktionsreife-Revision Phase 1 umgesetzt (2026-07-31)

Basis: `Pläne/09 DBZS_CODEE_V4_REPOSITORY_URTEIL_2026-07-31.md`, Umsetzungsplan Phase 1 ("Stabilitäts-Sprint").
Voller Desktop-Vitest-Lauf (1267 Tests grün, 42 geskippt), voller Backend-Pytest-Lauf (437 grün), beide
Typechecks (`tsconfig.node.json`, `tsconfig.web.json`) fehlerfrei.

- **Rollenmodell-Fallback-Kette** (`modelSelectionBroker.ts`): der bisherige harte `role_model_missing`-Abbruch,
  wenn kein `default*ModelId` gesetzt ist, versucht jetzt zuerst ein passendes **laufendes** Modell (mit
  Slot-Umzug der Entscheidung) und danach das beste **installierte** Modell, bevor er endgueltig mit
  `role_model_missing_no_fallback` abbricht. Vision-Sicherheit bleibt an jeder Stufe ein harter Filter (kein
  Text-Turn faellt je auf ein Vision-only-Modell zurueck und umgekehrt). Neuer Export
  `hasConfiguredRoleModelForTask()` laesst `runtimeChatStoreRoutingPhase.ts` den Slot-Status nur dann abfragen,
  wenn er tatsaechlich gebraucht wird. Aus Vorsicht bewusst auf `quality_cpu`/`fast_gpu`/`utility` beschraenkt —
  `vision_gpu`/`orchestrator_cpu`-Fallback wuerde am `contextSlotId`-Clamp in `runtimeChatStoreRoutingPhase.ts`
  scheitern (der nur die drei erstgenannten Slot-IDs kennt); das faellt in die geplante
  Vision-Broker-Routing-Phase, die diesen Clamp ohnehin erweitern muss.
- **Crash-Correlation-ID**: `RuntimeChatRun.id` (dem Nutzer bereits als "Diagnose-ID" bekannt) laeuft jetzt als
  neues optionales Feld `run_id` durch `RuntimeChatRequest` bis ins Backend (`service.py` loggt `run_id` beim
  Eintritt in `chat()`/`chat_stream()` — Backend hatte bis dahin kein Logging-Setup) und wird im Electron-
  Main-Process per neuem `activeRunTracker.ts` (Set aktiver Run-IDs, mehrfenstertauglich) getrackt. Jede
  `crash.log`-Zeile (`flushPendingState()` in `main.ts`) enthaelt jetzt `activeRuns=<ids-oder-"none">`.
- **Sandbox-Prozessueberleben (Phase 0, erneuter Versuch)**: zwei technisch unterschiedliche Techniken
  getestet (Bash/PowerShell-Hintergrundprozess — bereits zweimal gescheitert; Windows Task Scheduler
  `schtasks` — neu). Ergebnis: `schtasks` scheiterte sogar **schneller** (~25-30s statt ~2-3min) und der
  gestartete Prozess zeigte trotzdem `claude.exe` als Elternprozess — spricht gegen klassisches
  Job-Object-Reaping und fuer eine sandbox-weite Prozessueberwachung unabhaengig von der tatsaechlichen
  Prozess-Elternschaft. Als endgueltig nicht loesbar in dieser Sandbox dokumentiert (Details:
  `docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`, Abschnitt D) — die Kategorie-C-Punkte
  (Rollenmodell-Fallback, Crash-Correlation, GPU-Exklusivitaet) bleiben manuelle Verifikation.

Geaenderte Dateien: `apps/desktop/src/services/modelSelectionBroker.ts` (+Test), neue
`apps/desktop/electron/activeRunTracker.ts` (+Test), `apps/desktop/src/stores/runtimeChatStoreRoutingPhase.ts`
(+Test), `apps/desktop/electron/{main,runtimeAndJobIpc}.ts`, `apps/desktop/src/stores/runtimeChatStore.ts`,
`packages/shared/src/index.ts`, `backend/app/runtime/{schemas,service}.py` (+Test),
`docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`.

## Chat-Folgeaktionen Phase 2 umgesetzt (2026-07-31)

Die vier in `TODO.md` offenen Phase-2-Punkte zu den Chat-Folgeaktionen (Basis:
`Pläne/06 DBZS_CODEE_CHAT_FOLLOW_UP_ACTIONS_DIAGNOSE_PLAN.md`, Phase 1 bereits per PR #5/Merge-Commit `210f0ff`
in `main`) sind umgesetzt und automatisiert getestet (voller Desktop-Vitest-Lauf: 1250 Tests gruen, 42 geskippt,
0 Failures; `packages/shared`- und `apps/desktop`-Typecheck fehlerfrei):

- **echtes Retry mit Run-Kontext**: `retry_run` sendet den woertlichen urspruenglichen Nutzerprompt (statt einer
  festen Platzhalterformulierung) und reicht `taskType`/`provider`/`agentMode`/`forceUseResidentModel` als
  `sendOptions` durch. Bewusst kein hartes Modell-/Slot-Pinning — dafuer fehlt in `RuntimeChatSendOptions` ein
  `forcedModelId`-Feld, das tiefer in `modelSelectionBroker.ts` eingreifen wuerde.
- **Modellwechsel-Angebot nach Fehlschlag**: neuer Action-Kind `switch_model`, erscheint zusaetzlich zu
  `retry_run` bei `run.resourceRisk` `"high"`/`"unsupported"` oder gesetztem `run.fallbackRejection`. Klick
  navigiert per `useNotebookStore.setActiveTab("runtime")` zum Model Control Center statt ein Modell zu erraten.
- **Fehlererkennung aus Freitext**: `hasErrors` prueft jetzt zusaetzlich zu `toolCalls[].status` den
  Antworttext auf starke Fehlerindikatoren (Stacktrace-Muster, `isGenericRuntimeErrorSentinel` aus
  `runtimeRunFinalization.ts`), bewusst ohne generisches `/fehler/i`-Matching gegen Fehlalarme.
- **persistierte Folgeaktionen**: bereits durch die bestehende `messages`-Synchronisierung in
  `runtimeChatSync.ts` (localStorage-Roundtrip inkl. `message.actions`) abgedeckt — kein zusaetzlicher Code
  noetig.

Geaenderte Dateien: `packages/shared/src/index.ts` (neuer `ChatActionKind` `switch_model`),
`apps/desktop/src/services/runtimeChatFollowUpActions.ts`, `apps/desktop/src/stores/runtimeChatStoreInteractionActions.ts`,
plus Tests (`runtimeChatFollowUpActions.test.ts`, `apps/desktop/src/testing/chatActions.test.ts`).
**Noch offen:** manuelle Bestaetigung in einer echten Desktop-Session (siehe `TODO.md`) — insbesondere die
`switch_model`-Navigation und der tatsaechliche Retry-Prompt-Inhalt wurden nur automatisiert, nicht interaktiv
getestet.

## Aktueller Arbeitsbranch

- aktiver Arbeitsbranch: `feature/runtime-chat-ux-overhaul` (lokaler Arbeitsstand dieser Session; die `main`-Zusammenfassung unten bleibt als historischer Kontext bestehen)
- Sicherheits-Backup-Branch: `codex/backup-runtime-chat-overhaul-2026-07-27`
- physischer Snapshot:
  `C:\Users\ralle\source\repos\_backups\dbzs-codee-project-backup-2026-07-27-runtime-chat-overhaul`

## Repo-Wahrheit

- aktiver GitHub-Remote: `https://github.com/devdbzemusic/dbzs-codee-v4.git`
- lokaler Ordnername bleibt aktuell `dbzs-codee-project`
- `origin/main` zeigt auf `f909fd9` (Merge-Commit von [PR #6](https://github.com/devdbzemusic/dbzs-codee-v4/pull/6))
- offene Pull Requests im Live-Repo: keine
- Branch Protection fuer `main`: aktuell nicht aktiv
- der Feature-Branch `feature/runtime-chat-ux-overhaul` ist nach dem PR-#6-Merge sauber (keine losen
  Aenderungen mehr); er wurde bewusst nicht geloescht, falls dort weitergearbeitet wird

## PR #6 gemergt (2026-07-29)

[PR #6](https://github.com/devdbzemusic/dbzs-codee-v4/pull/6) ("Vision slot foundation, workflow-audit fixes,
runtime-ui module split") wurde per Merge-Commit `f909fd9` in `main` gemergt — 4 Commits: Vision-Slot-Grundlage
Phase 1, Workflow-Audit-P0-Fixes, die zugehoerigen Doku-Updates sowie ein vorbestehender, unabhaengiger
`RuntimeModelsTab`-Refactor (Zeilenkomponenten in ein eigenes Modul ausgelagert) plus eine PDF-Verschiebung nach
`Pläne/`. Vor dem Merge war die PR `MERGEABLE`/`CLEAN`, keine automatischen CI-Checks (weiterhin
`workflow_dispatch`-only, siehe unten).

## PR #5 gemergt (2026-07-29)

[PR #5](https://github.com/devdbzemusic/dbzs-codee-v4/pull/5) ("Runtime Chat overhaul: attachments, model control center,
follow-up actions") wurde per Merge-Commit `210f0ff` in `main` gemergt — 42 Commits, Themen: generische
Runtime-Chat-Dateianhaenge, Model Control Center/MMProj-Pairing, sowie die generischen Post-Response-Folgeaktionen
im Chat (Phase 1, siehe `Pläne/06 DBZS_CODEE_CHAT_FOLLOW_UP_ACTIONS_DIAGNOSE_PLAN.md`). Vor dem Merge war die PR
`MERGEABLE`/`CLEAN` und es gab keine automatischen CI-Checks (weiterhin `workflow_dispatch`-only, siehe unten).

## PR #4 gemergt + Folgearbeit direkt auf `main`

[PR #4](https://github.com/devdbzemusic/dbzs-codee-v4/pull/4) (Runtime-Chat-Overhaul + Personal Production Stabilization) ist gemergt. Danach wurden die aus der Verifikation vom 2026-07-28 (`Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_VERIFICATION_2026-07-28.md`) und aus diesem Handover offenen Restpunkte direkt auf `main` abgearbeitet (Commits `8f06ef8`, `dd31610`, `2d211cf`, `acca3bf`):

- **`atomicFileWrite.ts`-Typfehler behoben**: `AtomicWriteFs.mkdir` war gegen Nodes echte Recursive-Overload-Signatur zu eng typisiert. `npm run typecheck` ist seitdem erstmals vollstaendig fehlerfrei.
- **Vier lose Altaenderungen committet**: `skillRunPersistenceService.ts` (nutzt jetzt `writeFileAtomic`), `executionHandoff.ts`/`executionIntent.ts(.test)` (Intent-Klassifikation erkennt jetzt "Implementierungsplan"/"Umsetzungsplan"/"Fix-Plan"-Formulierungen als `plan_only`).
- **Vite-Importwarnungen aufgeloest**: zwei redundante dynamische Imports in `runtimeChatStoreRuntimeHelpers.ts` (`backendClient`, `providerRuntimeEvents`) waren bereits ueber Sibling-Stores statisch im selben Chunk — auf statische Imports umgestellt, `electron-vite build` ist jetzt warnungsfrei.
- **Repository-Review-Fehlerklassifikation**: neuer `RepositoryReviewOutcome`-Wert `"empty_plan"` ersetzt die generische `"failed"`-Klassifikation, wenn ein nicht-leeres Inventar auf null Batches faellt (z. B. `selectedPaths` matcht nichts oder keine Datei passt zum unterstuetzten Format-Filter). Grund wird jetzt in `review-state.json` persistiert (`ReviewStateFile.detail`) und im Chat ueber `currentBatchTitle` angezeigt. Neuer Regressionstest fuer den vorher ungetesteten Zweig.
- **Golden-Path-Verifikation konsolidiert**: siehe [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md) — wichtigster neuer Fund: **`env -u ELECTRON_RUN_AS_NODE` erlaubt einen echten Electron-GUI-Start in dieser Sandbox** (vorher als unmoeglich angenommen). `boot.spec.ts` und die UI-Chrome-Specs (`command-palette`, `job-monitor`, `mission-control`) laufen damit gruen; die vier Specs, die eine tatsaechlich verbundene lokale Modell-Runtime brauchen (`agent-capabilities`, `coding-assistant`, `context-integration`, `runtime-chat`), scheitern hier einheitlich mangels geladenem Modell — das ist Golden-Path-Kriterium 3 selbst, das die echte Maschine braucht.

### Personal Production Stabilization (PR #4) — zur Erinnerung

- **Runtime-Pfad**: Default-Bug in `backend/app/models/discovery_mode.py` behoben; `backend/app/runtime/doctor.py` prueft Ollama nicht mehr im Strict-Mode; G:/D:-Pfad-Fallbacks verifiziert; toter Ollama/Cloud-Code gekennzeichnet.
- **Review-/Index-Inventar**: gemeinsamer Exclude-Contract (`.cache`, `playwright-report`, `test-results`, `*.log`, `.env`) auf sieben Konsumenten migriert.
- **Diff/Snapshot/Rollback**: Freigabepflicht im `"full"`-Profil, `dbzs:fs:*`-IPC-Handler abgesichert, Crash-Flush-Hooks ergaenzt.
- **Automatisches Backup**: `backupService.ts` (Settings, Codee-DBs ohne `rag.sqlite3`, Workspace-`.codee` ohne Restore-Points, Modellprofile), Diagnostics-Tab-UI.
- **`.gitignore`-Bugfix**: `backend/app/models/` war versehentlich komplett ignoriert (8 Dateien nie versioniert), per Negation gefixt.

## Neu uebernommen: Konsolidierter MMProj-/Model-Control-Plan

Quelle: `Pläne/03 04 05 DBZS_CODEE_CONSOLIDATED_MODEL_CONTROL_MM_PAIRING_PLAN.md`
plus `Pläne/03 04 05 DBZS_CODEE_ADAPTED_MODEL_CONTROL_MM_PLAN_CURRENT_REPO.md`

Die Planbasis ist gelesen und fuer die naechste Umsetzungssession in eine klare Reihenfolge verdichtet. Kerngedanke:
`mmproj-*.gguf` ist **kein** startbares Modell, sondern ein Support-Artefakt, das erst zusammen mit einem kompatiblen
Basismodell und nach erfolgreicher Runtime-Probe als routbares multimodales Paar gelten darf. Der bestehende Integrationspunkt
`runtime={<RuntimeModelsTab />}` bleibt unveraendert; die Erweiterung ist additiv.

Stand im aktuellen Branch nach dem naechsten sicheren Slice:

- additive Vertragsfelder `multimodal_pairs` (Backend + Shared + Store) sind vorhanden
- erste Same-Folder-Heuristik erzeugt rein diagnostische Pair-Zustaende `candidate`, `ambiguous` und `missing_base`
- Kataloghinweise haben jetzt Vorrang: explizite Zuordnungen aus `models.catalog.json` koennen MMProj-Paare stabil als `source="catalog"` binden
- persistierbare manuelle Zuordnung ist vorhanden: `POST /models/multimodal-pairings/manual` schreibt `pairing.source = "manual"` in den Katalog und wird vom Index bevorzugt wieder eingelesen
- kontrollierte MMProj-Probe ist vorhanden: `probeRuntimeModel` akzeptiert `projector_artifact_id`, startet das Basismodell
  bei erfolgreichem Pairing mit `--mmproj`, persistiert erfolgreiche Proben als `routing_allowed = true` im Katalog
  und der `RuntimeModelsTab` aktualisiert den Index danach sofort auf `verified`
- die Probe haertet den Nachweis jetzt weiter: Basis-Endpoint und `/v1/models` muessen erfolgreich antworten, bevor
  ein Paar als verifiziert markiert wird; fehlende Endpoint-Nachweise blockieren die Freigabe weiterhin
- fuer MMProj-Paare gibt es jetzt zusaetzlich einen kleinen echten Bildtest ueber `/v1/chat/completions`; auch dieser
  muss erfolgreich sein, bevor `routingAllowed` gesetzt wird. Fehlerursachen aus dem Vision-Test werden als Probe-Evidenz
  bis in den `RuntimeModelsTab` durchgereicht
- `RuntimeModelsTab` zeigt fuer MMProj-/Hilfsartefakte jetzt explizite Statushinweise statt nur generischem `support_artifact`
- `RuntimeModelsTab` arbeitet jetzt als eigenes MM-Pairing-Control-Center: separate Paarliste, Risiko-Sortierung,
  Status-Summary, direkte Probe und manuelle Neu-Zuordnung; gekoppelte MMProj-Artefakte tauchen nicht mehr doppelt
  in den generischen Hilfsartefakten auf
- im aktuellen Branch ist der `RuntimeModelsTab` jetzt zusaetzlich als kompaktes Runtime-Model-Control-Dashboard verdichtet:
  Startmodelle werden nach Laufstatus und Routing-Nutzen priorisiert sortiert; fuer startbare Modelle, multimodale Paare
  und sichtbare Hilfsartefakte gibt es jetzt getrennte Rollen-, Routing-, Aktions- und Status-Summaries direkt ueber den
  Tabellen. Die Detailtabellen bleiben erhalten, sind aber schneller scanbar und auf direkte Steuerung ausgelegt
- `runtimeChatStoreRoutingPhase` reicht `multimodal_pairs` jetzt in den `modelSelectionBroker` durch; projector-pflichtige
  Visionmodelle werden ohne verifiziertes `routing_allowed = true` sauber blockiert statt blind gestartet
- fuer Screenshot-Coding/-Review mit Bildinput gilt jetzt zusaetzlich ein Capability-Gate:
  das gewaehlte Visionmodell muss im Modellindex explizit `code` tragen; vision-only/chat-only Visionmodelle werden
  fuer diese Pfade mit klarer Broker-Diagnose blockiert
- MMProj bleibt strikt nicht startbar; nur verifizierte Paare werden jetzt als `routingAllowed = true` sichtbar
- Nebenfund behoben: Dateinamen-Heuristiken bewerten jetzt den Dateinamen statt des ganzen Pfads, damit Ordnernamen wie `...mmproj...` keine Fehlklassifikation ausloesen

### Naechste Umsetzungsreihenfolge

- **1. Index-Haertung zuerst**: `index.models` nur fuer runnable Modelle; neue additive Sammlungen fuer
  `supportArtifacts` und spaeter `multimodalPairs`. MMProj muss sichtbar bleiben, aber nie startbar/routbar sein.
- **2. Paarungslogik danach**: Katalog-/manuelle Zuordnung, Same-Folder-Heuristik, Namensnormalisierung und
  Metadatenvergleich; uneindeutige Faelle bewusst als `ambiguous`/`missing_base`/`missing_projector`/`orphan`
  stehen lassen statt aggressiv zu auto-koppeln.
- **3. Runtime-Probe als Gate weiterhaerten**: `--model` + `--mmproj` und persistente Verifikation sind vorhanden; offen
  bleibt vor allem ein weiter verfeinerter Ergebnisverlauf fuer fehlgeschlagene versus erfolgreiche Proben.
  Endpoint-, `/v1/models`- und kleiner Bildtest-Nachweis sind jetzt Teil des Gates. Erst `verified`-Paare duerfen
  Routing freigeben.
- **4. Dann UI/Control Center**: dieser Block ist jetzt weit fortgeschritten; offen bleiben vor allem weitere
  Routing-/Capability-Ansichten und Ergebnis-Feinschliff.
- **5. Routing zuletzt anschliessen**: erstes Broker-Gate fuer projector-pflichtige Visionmodelle ist aktiv.
  Das erste Screenshot-Coding/Review-Capability-Gate (`vision + code`) ist ebenfalls aktiv.
  Offen bleiben die produktive Screenshot-Coding/Review-Kette und weitere Routing-/Capability-Regeln.
- **6. Capability-Zertifizierung getrennt**: direkte Vision-Coding-/Review-Ausfuehrung erst nach expliziter
  Zertifizierung von `code_generation`, `code_review`, `structured_output`, `instruction_following`, `tool_calling`.

### Wichtig fuer die naechste Session

- zuerst Datenvertrag/Index aendern, **nicht** mit UI oder Broker anfangen
- keine automatische Freigabe mehrdeutiger MMProj-Paare
- keine Modellgewichte beim App-Start laden; Probing nur kontrolliert und temporaer
- Regressionen von Anfang an mitsichern: MMProj nie startbar, nie `primaryCodingModel`, nie Text-Chat-Default

### Verifikation (kumulativ)

- `npm run typecheck` (apps/desktop) — **vollstaendig fehlerfrei**
- `electron-vite build` — erfolgreich, keine Warnungen mehr
- Backend-Pytest + Frontend-Vitest auf allen betroffenen Suiten — gruen
- Playwright-E2E (mit `ELECTRON_RUN_AS_NODE` unset): 11/41 automatisiert bestanden (Boot + UI-Chrome); Rest erfordert echte Modell-Runtime — siehe Verifikationsdokument

## Echter interaktiver Golden-Path-Durchlauf mit echtem lokalem Modell

Diese Maschine hat echte GGUF-Modelldateien unter `D:\Models`. Damit wurde ein
echter, interaktiver Durchlauf gefahren (isolierte App-Data/Userdata/Workspace,
`gemma-3-1b` als Testmodell) — Details und vollstaendige Checkliste in
[docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md).

**Echt verifiziert**: App startet, Projekt oeffnet sich und bleibt ueber
Neustarts gespeichert, lokales Modell verbindet sich automatisch, Chat
beantwortet eine echte Projektfrage mit echter LLM-Inferenz.

**Zwei echte Bugs gefunden und behoben** (nur durch den echten Durchlauf
sichtbar, kein Mock haette das gezeigt):

- `e9c1e54` — `ModelIndexService._from_catalog()` uebernahm `models.catalog.json`s
  `runtime_dir`-Feld unvalidiert; war auf dieser Maschine veraltet
  (`D:/win_runtimes/llama.cpp-win-runtime`, leer) statt der echten Binaries
  unter `D:/win_runtimes/llama/`. Faellt jetzt bei Bedarf auf
  `first_win_llama_runtime_dir()`-Discovery zurueck.
- `9aba315` — **Regression aus PR #4**: der `dbzs:fs:stat`-Guard von heute
  frueh band Existenz-Checks an Workspace/userData, aber
  `pathValidatorService.ts` prueft Modell-Dateien legitim ausserhalb des
  Workspace (`D:\Models\...`). `dbzs:fs:stat` ist jetzt wieder ungeschuetzt
  (nur Metadaten, kein Content-Leak); `read-file`/`write-file`/`file:save`
  bleiben korrekt beschraenkt.

**Noch nicht abgeschlossen in diesem Lauf**: vollstaendiger Review-Abschluss,
Diff/Apply, Rollback, Testlauf aus Codee, Backup/Restore-Klick, Crash-Recovery
— siehe Checkliste im Verifikationsdokument fuer den Rest. Auf Service-Ebene
sind genau diese Punkte inzwischen verifiziert — siehe
[docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md)
(`SERVICE_VERIFIED`; `UI_VERIFIED` steht fuer diese Punkte noch aus).

## Zusaetzlich umgesetzt (Runtime-Chat-Overhaul, aus der vorherigen Session, Teil von PR #4)

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

## Neu im Arbeitsbranch: generische Runtime-Chat-Dateianhaenge

Stand im Branch `feature/runtime-chat-ux-overhaul` nach Commit `71d3706`:

- der bisherige bildspezifische Attachment-Pfad ist zu einer generischen Datei-Attachment-Pipeline erweitert
  (`image`, `document`, `archive`, `text`, `code`)
- der Composer akzeptiert jetzt Bilder weiterhin, zusaetzlich aber auch `pdf`, `zip`, `md`, `json`, `js`,
  `ts`, `tsx`, `py`, `txt`
- Einfuegen funktioniert ueber den gemeinsamen Anhaengen-Button mit Mehrfachauswahl und ueber `Strg+V`
  fuer Clipboard-Datei-Items
- die Turn-UI rendert dateitypspezifische Vorschauen fuer Bilder, Text/Code, PDF und ZIP
- Text-/Code-Dateien werden vor dem Request als strukturierte Attachment-Bloecke in den User-Turn eingebracht
- PDF wird lokal ueber den Backend-Pfad zu Text extrahiert
- ZIP wird lokal ausserhalb des Workspace temporaer entpackt, rekursiv inventarisiert und nur fuer erlaubte
  Text-/Code-Dateien inline in den Turn uebernommen
- nicht-bildliche Dateianhaenge setzen weder automatisch Vision-Flags noch `requiresVision`; bestehende
  Vision-Gates bleiben auf echte Bildpayloads begrenzt
- neue Backend-Dependency: `pypdf`

Frisch verifiziert fuer diesen Slice:

- `npm run typecheck` in `apps/desktop`
- fokussierter Desktop-Vitest-Lauf: 58 Tests gruen
- Backend-Pytest fuer Runtime-API plus Attachment-Aufbereitung: 14 Tests gruen

## Neu im Arbeitsbranch: generische Post-Response-Folgeaktionen im Chat (Phase 1)

Basis: `Pläne/06 DBZS_CODEE_CHAT_FOLLOW_UP_ACTIONS_DIAGNOSE_PLAN.md` — Diagnose war: normale, erfolgreich
abgeschlossene Chat-/Planungs-/Debug-Antworten bekamen `actions: []`, weil die vorhandene Action-Infrastruktur
nur Patch-Approval/Rollback/Tests/Terminal-/Web-Freigaben und Review-Findings abdeckt; `confirm_continue` war
zu eng auf "Tests starten nach Patch-Apply" verdrahtet. Der Chat wirkte deshalb subjektiv, als wuerde er nach
jeder normalen Antwort "einfach enden".

Phase-1-Umsetzung (kein Phase-2-Umbau):

- neuer deterministischer (nicht LLM-gesteuerter) Builder
  [apps/desktop/src/services/runtimeChatFollowUpActions.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/runtimeChatFollowUpActions.ts):
  `buildFollowUpActions()`/`attachFollowUpActionsToMessages()`, max. 3 Vorschlaege pro Antwort
- sechs additive `ChatActionKind`-Werte in `packages/shared/src/index.ts`
  (`continue_task`, `implement_plan`, `show_next_steps`, `retry_run`, `inspect_result`, `new_task`);
  `confirm_continue` bleibt unveraendert dem echten Patch-Approval-Flow vorbehalten
- Gating: `needs_user_input`/`cancelled`/`repositoryReview`/offene Plan- oder Patch-Proposal unterdruecken
  Vorschlaege komplett (Review-Findings-Aktionen in `CodeeRunLiveBlock` bleiben der einzige Weg fuer Reviews);
  echter Fehlschlag → `Erneut versuchen`/`Ergebnis pruefen`; Tool-Call mit `status: "error"` → `Fehler beheben`
  (selbes `continue_task`-Kind wie `Vertiefen`, nur anderer Titel/Prompt); `taskType` `planning`/`architecture`
  → `Plan umsetzen`; Standardfall → `Vertiefen`/`Naechste Schritte`/`Neue Aufgabe`
- Verdrahtung an beiden Stellen, die eine Assistentenantwort tatsaechlich abschliessen, in
  `apps/desktop/src/stores/runtimeChatStore.ts` (Agent-Turn-Loop-Pfad und Streaming-Pfad)
- Klick dispatcht ueber die bestehende Pipeline (`handleChatAction` → `handleChatActionAction` in
  `runtimeChatStoreInteractionActions.ts`) und sendet einen festen Prompt ueber die vorhandene `sendMessage()` —
  keine neue Sonder-Pipeline
- `RuntimeChatMessageCard.tsx` zeigt jetzt zwei getrennte Bloecke: bestehende Pflicht-Freigaben unveraendert,
  neuer "Vorgeschlagene Folgeaktionen"-Block ohne Risiko-Styling, waehrend `isSending` deaktiviert
- "nur die letzte Assistentenantwort zeigt aktive Vorschlaege" ist reine Renderzeit-Logik
  (`isLatestAssistantMessage` aus `findLastAssistantMessageIndex()` in `RuntimeChatConversationFeed.tsx`) —
  keine neue Invalidierungslogik noetig, weil jede neue Turn-Runde ohnehin eine frische Platzhalter-Nachricht
  anlegt; Workspace-Wechsel (`clear()`) entfernt stale Folgeaktionen automatisch mit, weil sie Teil von
  `message.actions` sind

Bewusst zurueckgestellt (Phase 2, siehe Diagnoseplan): echtes Retry mit demselben Run-Kontext,
Modellwechsel-Angebot nach Fehlschlag, Fehlererkennung aus Freitext (aktuell nur ueber
`toolCalls[].status === "error"`), persistierte Folgeaktionen ueber Sessions hinweg.

Verifikation:

- `npx tsc --noEmit -p tsconfig.web.json` und `-p tsconfig.node.json` (apps/desktop) — beide fehlerfrei
- voller Desktop-Vitest-Lauf: 194 Testdateien / 1223 Tests gruen, keine Regressionen
- vier neue/erweiterte Testdateien: `runtimeChatFollowUpActions.test.ts` (neu), `runtimeChatActionSelectors.test.ts`
  (erweitert), `RuntimeChatMessageCard.test.tsx` (neu, `createRoot`/`act`-Harness), `chatActions.test.ts`
  (Dispatch- und Workspace-Clear-Regression ergaenzt)
- **noch offen:** manueller Durchklick in einer echten Desktop-Session (Vorschlaege erscheinen nur unter der
  letzten Antwort, Klick sendet richtigen Prompt, Buttons werden waehrend Senden inaktiv) — siehe TODO.md

## Neu im Arbeitsbranch: vertieftes Runtime Model Control Center

Stand im Branch `feature/runtime-chat-ux-overhaul` nach Commit `1865dc3`:

- [apps/desktop/src/components/notebook/RuntimeModelsTab.tsx](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/notebook/RuntimeModelsTab.tsx)
  - `Startbare Modelle` zeigen jetzt zusaetzlich Rollen-, Routing- und Aktions-Summaries (`Laufend`, `Ladbar`, `Blockiert`)
  - die Modellliste wird nach aktivem Laufstatus und Routing-Nutzen sortiert, damit `Vision + Code`- und `Text + Code`-
    Kandidaten vor rein informativen Eintraegen landen
  - `Multimodale Paare` haben jetzt getrennte Source- und Action-Summaries (`Probe bereit`, `Zuordnung noetig`,
    `Erledigt`, `Blockiert`)
  - `Hilfsartefakte` zeigen jetzt Typ-, Aktions- und Status-Summaries (`MMProj`, `Adapter/LoRA`, `Verifiziert`,
    `Candidate`, `Orphan`, `Nur Hinweis`) und werden handlungsorientiert sortiert
- [apps/desktop/src/components/notebook/RuntimeModelsTab.test.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/components/notebook/RuntimeModelsTab.test.ts)
  - gezielte Regressionsabdeckung fuer die neuen Dashboard-Helfer: Startmodell-Sortierung, Modell-Aktionssummary,
    MM-Pair-Aktionssummary sowie Support-Artefakt-Typ-, Status- und Aktionssummaries

Frisch verifiziert fuer diesen Slice:

- `npm run test -- src/components/notebook/RuntimeModelsTab.test.ts src/services/modelSelectionBroker.test.ts`
  - 87 Tests gruen
- `npm run typecheck` in `apps/desktop`

## Vision-Slot-Grundlage Phase 1 (Teil von PR #6)

Basis: `Pläne/07 CODEE_MODELL_ROLLEN_MATRIX.md`. Umgesetzt ist ausschliesslich die additive, risikoarme
Phase 1 — ein neuer `vision_gpu`-Slot existiert typisiert und contract-valide, aber **nichts routet heute echte
Anfragen dorthin**. Kein bestehender Anfragepfad aendert Verhalten.

- neuer `RuntimeSlotId`-Wert `vision_gpu` (Port 8085) plus vier neue `RuntimeTaskType`-Werte
  (`image_analysis`, `ui_analysis`, `visual_debugging`, `document_vision`) in
  [packages/shared/src/runtime/runtimeSlots.ts](C:/Users/ralle/source/repos/dbzs-codee-project/packages/shared/src/runtime/runtimeSlots.ts) —
  die `satisfies Record<RuntimeSlotId, RuntimeSlotDefinition>`-Constraint erzwingt Vollstaendigkeit
- Slot-ID war in vier Stellen dupliziert, alle synchron aktualisiert: `packages/shared/runtime-slots.json`,
  `backend/app/runtime/schemas.py`, `backend/app/runtime/slot_contract.py` (Contract-Validierung),
  `apps/desktop/src/services/runtimeSlotManager.ts` (`ALL_SLOTS`, Scoring, Default-Modell-Aufloesung)
- `backend/app/runtime/residency.py`: `vision_gpu` bekommt `IDLE_EVICT` (nie resident halten, wenn keine
  Bildanalyse laeuft); `lazyRuntimePolicy.ts`: `vision_gpu` ist jetzt Teil der Idle-Eviction-Watch-Liste
- neues, bewusst noch `orphaned`/`readonly` Setting `defaultVisionModelId` (Schema in `appContracts.ts`,
  Registry-Eintrag in `settingsRegistry.ts`, Backend-Pendant in `backend/app/settings/models.py`) — wird erst
  in Phase 3 (Broker-Routing) auf `user_tunable` umgeschaltet
- ein echter, vom Compiler gefundener Nebenfund behoben: `runtimeChatStoreOnDemandExecution.ts`s
  Resident-Fallback-Logik schloss bisher nur `orchestrator_cpu` von ihrem engen Slot-Typ aus, jetzt auch
  `vision_gpu`
- **bewusst zurueckgestellt** (siehe Plandokument): GPU-Exklusivitaet zwischen `fast_gpu`/`vision_gpu` (Phase 2,
  echte Hardware-Verhaltensaenderung, gehoert serverseitig in `RuntimeService.start_model()`), Broker-Routing
  fuer Bildeingaben (Phase 3), FunctionGemma-Routing-Integration und Yi-Coder-9B-„Advisor“-Rolle (beide separat)

Frisch verifiziert fuer diesen Slice:

- `packages/shared`- und `apps/desktop`-Typecheck (beide TS-Projekte) fehlerfrei
- voller Desktop-Vitest-Lauf: 1226 Tests gruen (neue Faelle fuer `scoreModelForSlot`/`configuredModelForSlot`
  auf `vision_gpu` sowie die Settings-Registry-Erweiterung eingeschlossen)
- Backend-Pytest fuer die betroffenen Suiten (`test_runtime_slot_contract`, `test_residency_cache`,
  `test_settings`, `test_context_rc_acceptance_fixtures`) sowie eine breitere `runtime`/`slot`/`residency`/
  `process_cleanup`-Filterauswahl (153 Tests) gruen; ein voller Backend-Lauf zeigte einen einzelnen,
  unabhaengigen Windows-Datei-Lock-Flake in `test_task_manifest.py` (bestaetigt als vorbestehend, isoliert
  reproduzierbar gruen)
- **noch offen**: nichts in Phase 1 startet `vision_gpu` real, daher kein Hardware-Nachweis noetig — einzige
  sinnvolle manuelle Stichprobe waere ein `previewResourcePlan()`-Aufruf gegen ein echtes Qwen2.5-VL-GGUF auf
  `vision_gpu`, um zu bestaetigen, dass der Resource-Planner eine 5. Slot-ID ohne Sonderbehandlung akzeptiert

## Workflow-Audit P0-Fixes (Teil von PR #6)

Basis: `Pläne/08 CODEE_V4_WORKFLOW_AUDIT.md` — ein real reproduzierter Bug: bei "Zähle alle GGUF Modelle im
Workspace" routet Codee auf ein Visionmodell, das Modell erzeugt einen rohen `<CODEE_TOOL_CALL>`-Envelope mit
falschem Pfad (`/models` statt Workspace-relativ), das Tool liefert `[]`, keine natuerlichsprachliche Endantwort
entsteht, der Lauf gilt trotzdem als erfolgreich abgeschlossen. Alle 6 technischen Einzelbehauptungen des Audits
wurden gegen den echten Code verifiziert (5 vollstaendig bestaetigt, 1 mit Nuance). Umgesetzt sind die P0-Fixes
fuer genau diesen Bug:

- **Ursache genauer als im Dokument**: nicht "kein weiterer Turn interpretiert das Ergebnis" (der Agent-Turn-Loop
  fragt durchaus erneut nach), sondern `finalContent = stripToolCallBlocks(rawContent) || rawContent` in
  [agentTurnEngine.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/runtime/agent/agentTurnEngine.ts)
  holt den rohen Envelope zurueck, sobald ein Turn nur Tool-Call-Markup enthaelt und das Strippen leer laesst.
  Der `|| rawContent`-Fallback ist entfernt; ein reiner Tool-Call-Turn liefert jetzt `""`, was ueber die bereits
  vorhandene, korrekte `inferFailureOutcome()`-Logik zu `empty_final_answer` fuehrt — kein neuer Outcome-Typ noetig
- neue, exportierte `isToolOnlyAnswer()` in `runtimeRunFinalization.ts`, in `isValidFinalAnswer()` verdrahtet —
  zusaetzliches Sicherheitsnetz fuer beide Finalisierungspfade (Agent-Turn-Loop und Streaming)
- `runtimeChatStoreAgentTurnFinalization.ts`: `agentLoopCompleted` wird jetzt aus `terminalReason` abgeleitet
  (`false` nur bei `budget_exceeded`/`cancelled`) statt hart `true` — bewusst nicht auf `tool_calls_executed`
  angewendet, da das der normale, gesunde Abschluss fuer den ueberwiegenden Teil erfolgreicher Tool-Nutzung ist
  (der Zaehler ist kumulativ ueber den ganzen Lauf); der Streaming-Pfad bleibt unangetastet, da er echt
  einstufig ist und kein `terminalReason`-Konzept hat
- neue `normalizeWorkspaceToolPath()` in `toolAdapterBridge.ts`: ein fuehrender Slash (`/models`) gilt jetzt als
  workspace-root-verankert statt als absoluter Pfad; echte absolute Windows-Pfade und `..`-Segmente werden mit
  klarer Tool-Fehlermeldung abgelehnt statt still `[]` zurueckzugeben
- `RuntimeChatMessageCard.tsx`: das lange-System-Nachrichten-Einklappen (`isCollapsedSystem`) war an die
  `compact`-Prop gebunden, die an keiner echten Aufrufstelle von `RuntimeChatTab` je gesetzt wird — Bedingung
  entfernt, Tool-Result-Systemnachrichten klappen jetzt tatsaechlich im Hauptchat ein
- **bewusst zurueckgestellt**: neue deterministische `search_workspace_files`/`count_workspace_files`-Tools
  (Punkt D im Audit) und aufgabenabhaengiges Routing weg von Visionmodellen fuer reine Text-/Dateianfragen
  (Punkt F, ueberschneidet sich mit der bereits zurueckgestellten FunctionGemma-Routing-Untersuchung)

Frisch verifiziert fuer diesen Slice:

- beide TS-Projekte (`packages/shared`, `apps/desktop` web+node) fehlerfrei
- voller Desktop-Vitest-Lauf: 1237 Tests gruen (11 neue Faelle in `agentTurnEngine.execution.test.ts`,
  `runtimeRunFinalization.test.ts`, `toolAdapterBridge.test.ts`, `RuntimeChatMessageCard.test.tsx`), keine
  Regressionen im bestehenden erfolgreichen Tool-Call-/Patch-Pfad
- **noch offen**: manueller Smoke-Test in einer echten Desktop-Session gegen ein echtes, gelegentlich
  degradierendes lokales Modell — automatisiert nicht nachstellbar ohne echte Modell-Inferenz

## Aktive offene Aufgaben

### P0

Statusvokabular (projektweit): `SERVICE_VERIFIED` → `UI_VERIFIED` → `INSTALLER_VERIFIED` → `PERSONAL_STABLE`.

Ein automatisiert getriebener UI-Fortsetzungslauf (per Playwright, echtes lokales Modell) hat Kriterium 12
(Backup/Restore) neu auf `UI_VERIFIED` gehoben und einen echten Bug in Kriterium 4 (Chat) gefunden und gefixt
(`a5171b7` — aufeinanderfolgende `system`-Rollen-Nachrichten liessen Gemmas Chat-Template scheitern). Kriterien
5/7/9/10/11 waren blockiert, weil die "canonical workflow assignment"-Schicht bei Review-/Coding-Anfragen
`targetAgent` nicht auf `"reviewer"` aufloeste — **behoben und real durch die UI bestaetigt** (`inferWorkflowKind()`
in `workflowStateResolver.ts` bevorzugte faelschlich den `workflowKind` eines aelteren, noch offenen Task-Contracts
vor der korrekt klassifizierten Review-Absicht; ein zweiter UI-Lauf hat das exakte Regressionsszenario
reproduziert und bestaetigt, dass das `.codee/reviews/rev-*`-Artefakt jetzt korrekt entsteht). **Neuer,
separater Blocker fuer 7/9/10/11:** das kleine lokale Modell (`gemma-3-1b-it-qat-q4-0`, auch getestet mit
`qwen2.5-coder-7b-instruct`) liefert bei strukturierter Review-/Coding-Analyse keine parsbare Ausgabe
(`no_json_array`). Details: [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md).
**Ursache gefunden und behoben (2026-07-29):** kein Modell-Faehigkeitsproblem — trat identisch bei einem 1B-
*und* einem 7B-Modell auf (beide ~70 Zeichen Antwort). Der Review-System-Prompt in
[llmBatchAnalyzer.ts](C:/Users/ralle/source/repos/dbzs-codee-project/apps/desktop/src/services/repositoryReview/llmBatchAnalyzer.ts)
sagte nie, was bei *keinen* Findings zurueckzugeben ist — ein Modell ohne Befund auf einem kleinen/sauberen
Batch antwortet dann nachvollziehbar mit einem kurzen Prosa-Satz statt `[]`. System- und Repair-Prompt
verlangen jetzt explizit `[]` bei keinen Findings; zusaetzlich wird die redigierte Rohantwort bei
Parser-Fehlschlag jetzt persistiert (`rawResponsePreview` in `ReviewBatchAnalyzerDiagnostics`, vorher gab es
nur die Zeichenlaenge). Typecheck fehlerfrei, voller Vitest-Lauf 1239 Tests gruen. **Noch offen:** echte
End-to-End-Bestaetigung mit laufendem lokalem Modell — in dieser Agent-Sandbox nicht verifizierbar (siehe
Prozess-Lebenszeit-Limit weiter unten), braucht eine echte interaktive Session.

**Wichtige Korrektur:** Bei der Code-Vertiefung stellte sich heraus, dass der Service-Level-Bericht fuer 2.6
(Tests) und 2.7 (Rollback) auf nicht-kompilierbarem, nirgendwo verdrahtetem Code beruhte (`patchValidationService.ts`/
`patchRollbackService.ts`, aus demselben Commit wie der Bericht selbst) — entfernt, Bericht korrigiert,
`npm run typecheck` war dadurch seit heute frueh kaputt und ist jetzt wieder sauber. Siehe Korrekturhinweis in
[docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md).

- Rest des Golden-Path (Diff/Apply/Rollback/Tests, harter Abbruch + Neustart) bis `UI_VERIFIED` abschliessen,
  jetzt wo der Routing-Blocker behoben ist; 2.6/2.7 dabei gegen den echten Pfad
  (`patchPipelineService.ts`/`restorePointService.ts`) neu pruefen — siehe [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md) und [docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md](C:/Users/ralle/source/repos/dbzs-codee-project/docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md)
- generische Datei-Anhaenge in einer echten Desktop-Session manuell gegen die neuen Dateitypen durchklicken:
  Mehrfachauswahl, `Strg+V`, Senden ohne manuell geschriebenen Prompt, PDF-/ZIP-Hinweise und Turn-Payload
- gepacktes-Build-Userdata-Verzeichnis fuer `backupService.ts` an einem echten Installer-Build verifizieren (`INSTALLER_VERIFIED`; bisher nur Dev-Pfad `%TEMP%\dbzs-codee-dev-user-data` bestaetigt)
- Modell-Katalog auf dieser Maschine neu scannen/regenerieren (`models.catalog.json`s `runtime_dir` war veraltet — auch wenn der Code das jetzt abfaengt, lohnt sich ein frischer Scan)

### P1 — bewusst zurueckgestellt

Konsistent mit der Personal-Production-Plan-Philosophie ("vorerst nicht noetig", kein oeffentlicher Release, kein Team) bewusst nicht aktiv verfolgt:

- GitHub-CI-Strategie entscheiden/reaktivieren (ohnehin durch GitHub-Billing-Sperre blockiert; `ci.yml`/`live-runtime-validation.yml` bleiben absichtlich `workflow_dispatch`-only)
- Branch Protection / Merge-Gates fuer `main`
- Grosse strukturelle Backlog-Punkte ("weitere Zerlegung grosser Runtime-/Store-Dateien", "Contract-Parity zwischen Shared und Backend weiter haerten") — bleiben unpriorisierter Backlog

## Wichtige Hinweise

- Historische Papiere unter `Pläne/` oder `docs/archive/` koennen falsche Repo- oder PR-Annahmen enthalten.
- Die aktuellen Wahrheitsquellen sind `README.md`, `TODO.md`, `docs/STATUS_TODAY.md` und die Audits unter `docs/audits/`.
- Im Worktree liegen generierte Artefakte unter `.cache/backend-build/`; diese gehoeren nicht automatisch in den naechsten Commit.
- `.gitignore` hatte einen blinden Fleck bei Verzeichnissen namens `models/` egal wo im Baum — vor weiteren pauschalen Ignore-Regeln kurz mit `git status --ignored` gegenpruefen, ob echter Source darunter faellt.
- **Diese Sandbox kann einen echten Electron-GUI-Start**, wenn `ELECTRON_RUN_AS_NODE` fuer den Kindprozess entfernt wird (`env -u ELECTRON_RUN_AS_NODE ...`). Backend/Renderer-Dev-Server muessen dafuer manuell vorgestartet werden, da `uv` in dieser Shell fehlt (venv-Python direkt nutzen: `backend/.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8876`).
- **Aber: selbst gestartete Hintergrundprozesse (Backend, Electron) werden von dieser Sandbox nach ca. 2-3
  Minuten Laufzeit beendet** — bestaetigt am 2026-07-29 mit zwei unabhaengigen Versuchen (Bash-Hintergrundprozess
  und PowerShell `Start-Process` detached, mit und ohne vorgewärmtem Modell). Ein echter, interaktiver
  Chat-Smoke-Test gegen ein lokales Modell (Modell-Ladezeit + Antwortzeit ueberschreitet dieses Fenster fast
  immer) ist in dieser Agent-Sandbox daher **nicht zuverlaessig moeglich** — dafuer braucht es eine echte
  interaktive Session (z. B. `start-dev.ps1`), keinen erneuten Agent-Versuch mit denselben Mitteln. App-Boot,
  Modell-Routing-Konfiguration, Settings-Persistenz und Runtime-Slot-Start ueber die API funktionieren dagegen
  auch in der Sandbox nachweislich korrekt (innerhalb des Zeitfensters bestaetigt).
