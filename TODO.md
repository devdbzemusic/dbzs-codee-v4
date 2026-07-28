# TODO

Stand: 2026-07-28

## Jetzt direkt

Statusvokabular (projektweit): `SERVICE_VERIFIED` → `UI_VERIFIED` → `INSTALLER_VERIFIED` → `PERSONAL_STABLE`.
Aktueller Stand der sicheren Aenderungskette (Diff/Approval/Apply/Tests/Rollback) sowie Backup/Restore
und Crash-Recovery: 2.1–2.5, 3.1, 3.2 sind **`SERVICE_VERIFIED`** — siehe
`docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md`. **Achtung:** 2.6 (Tests) und 2.7 (Rollback)
waren dort faelschlich als verifiziert markiert (der Beleg-Code war nicht kompilierbar und nirgendwo verdrahtet,
inzwischen entfernt — siehe Korrekturhinweis im Dokument und `GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md`) und
gelten wieder als offen. Der echte interaktive UI-Durchlauf in `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md`
hat dieselben Punkte noch nicht bis zum Ende durchlaufen (`UI_VERIFIED` steht noch aus):

- [ ] **Neuer Blocker fuer 7/9/10/11 (Diff/Apply/Test/Rollback):** Review-Routing-Fix ist real verifiziert
      (`.codee/reviews/rev-*`-Artefakt wird jetzt korrekt erzeugt), aber das kleine lokale Modell
      (`gemma-3-1b-it-qat-q4-0`) liefert bei strukturierter Review-/Coding-Analyse keine parsbare Ausgabe
      (`no_json_array`, nur ~70 Zeichen Antwort; `qwen2.5-coder-7b-instruct` als Alternative getestet, gleiches
      Ergebnis). Ursache noch offen — siehe `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md` ("Fortsetzungslauf 2")
- [ ] unerklaerter App-/Backend-Absturz kurz nach Modellwechsel auf `qwen2.5-coder-7b-instruct` root-causen
      (Logs: `golden-path-run-2/user-data/logs/crash.log`, zeitliche Korrelation nicht abschliessend belegt)
- [ ] 2.6 (Tests)/2.7 (Rollback) gegen den echten, verdrahteten Pfad neu verifizieren:
      `apps/desktop/electron/patchPipelineService.ts`/`restorePointService.ts` ueber `runtimeChatStorePatchActions.ts`
      (nicht die entfernten `repositoryReview/patchValidationService.ts`/`patchRollbackService.ts`)
- [ ] gepacktes-Build-Userdata-Verzeichnis fuer `backupService.ts` an einem echten Installer-Build verifizieren
      (`INSTALLER_VERIFIED`) — Ablauf in `docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`
- [ ] rollenspezifische Modell-IDs (`defaultCoderModelId`/`defaultReviewerModelId`/...) sinnvoll defaulten statt
      hartem `"Rollenmodell in Settings fehlt"`-Fehler beim ersten Coding-Task-Versuch (in `GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md` gefunden)
- [ ] Modell-Katalog auf dieser Maschine neu scannen (veralteter `runtime_dir`, auch wenn jetzt abgefangen) —
      Rescan-Button selbst bereits `UI_VERIFIED` (364 Modelle, keine Regression)

## Neu eingeplant: Model Control Center + MMProj/MM-Pairing
 
- [x] **Zwischenschritt 2026-07-28:** `multimodal_pairs` additiv eingefuehrt; erste Same-Folder-Heuristik erzeugt
      `candidate`/`ambiguous`/`missing_base`; `RuntimeModelsTab` zeigt MMProj-/Hilfsartefakt-Status jetzt explizit an.
      Routing bleibt dabei gesperrt (`routingAllowed = false`), also weiterhin nur Diagnose- und Vertragsstufe.
- [x] **Zwischenschritt 2026-07-28b:** Kataloghinweise haben jetzt Vorrang vor der Heuristik:
      Basismodell- und projector-seitige Zuordnungen in `models.catalog.json` erzeugen stabile `catalog`-Pairs,
      selbst wenn Same-Folder ohne diese Hinweise mehrdeutig waere. Weiterhin keine Runtime-Probe und keine Routing-Freigabe.
- [x] **Zwischenschritt 2026-07-28c:** persistierbare manuelle Zuordnung vorhanden:
      `POST /models/multimodal-pairings/manual` schreibt `pairing.source = "manual"` in `models.catalog.json`;
      der Index liest das als `source = "manual"` wieder ein und die Runtime-UI kennzeichnet den Status entsprechend.
- [x] **Zwischenschritt 2026-07-28d:** kontrollierte MMProj-Runtime-Probe vorhanden:
      `probeRuntimeModel` akzeptiert optional `projector_artifact_id`, startet bei erfolgreichem Pairing mit `--mmproj`,
      persistiert `routing_allowed = true` fuer verifizierte Paare im Katalog und der `RuntimeModelsTab` zeigt den Status
      sofort nach der Probe als `verified` an.

Basis: `PlÃ¤ne/03 04 05 DBZS_CODEE_CONSOLIDATED_MODEL_CONTROL_MM_PAIRING_PLAN.md` plus
`PlÃ¤ne/03 04 05 DBZS_CODEE_ADAPTED_MODEL_CONTROL_MM_PLAN_CURRENT_REPO.md`

- [ ] **Phase 1 â€” Index-HÃ¤rtung und Vertragsklarheit:** `mmproj-*.gguf` nie mehr als startbares Modell behandeln; `index.models`
      auf eigenstaendig startbare Modelle begrenzen und additiv `supportArtifacts` sowie spaeter `multimodalPairs` einfuehren.
      Pflicht-Regressionskern: MMProj sichtbar, aber nie startbar/routbar/primary coding model.
- [ ] **Phase 2 â€” Paarungslogik aufbauen:** Katalog-/manuelle Zuordnung, Same-Folder-Heuristik, Namensnormalisierung und
      Metadatenvergleich fuer `MultimodalPair`; mehrdeutige oder unvollstaendige Faelle muessen explizit als
      `ambiguous`/`missing_base`/`missing_projector`/`orphan` sichtbar bleiben und duerfen kein Routing freigeben.
- [ ] **Phase 3 â€” Runtime-Probe einfuehren:** interner `RuntimeLaunchProfile` mit optionalem `mmprojPath`, temporaerer Probe-Start
      (`--model` + `--mmproj`) und persistente Verifikation sind jetzt vorhanden; offen bleiben Healthcheck-/`/v1/models`-
      Nachweis, echter Bildtest und sauberer Ergebnisverlauf, weiterhin ohne automatische Modellstarts beim App-Start.
- [ ] **Phase 4 â€” `RuntimeModelsTab` zum Model Control Center ausbauen:** Bereiche fuer Modelle, multimodale Paare,
      Hilfsartefakte, Capabilities, Rollen/Routing und Diagnose; manuelle Zuordnung erst hier an die UI bringen,
      nicht verdeckt im Broker.
- [ ] **Phase 5 â€” Routing sauber anbinden:** Textanfragen bleiben unveraendert text-only; Bildinput darf nur auf verifizierte
      multimodale Paare gehen. Erste Produktionsstufe fuer Screenshot-Coding/Review: Vision analysiert, zertifiziertes
      Coding-/Review-Modell setzt um bzw. bewertet.
- [ ] **Phase 6 â€” Capability-Zertifizierung getrennt nachziehen:** direkte Vision-Coding-/Review-Faehigkeit nur nach expliziter
      Zertifizierung (`code_generation`, `code_review`, `structured_output`, `instruction_following`, `tool_calling`);
      Audio bewusst spaeter separat.
- [ ] **Integrationsregel beibehalten:** externer Vertrag bleibt `runtime={<RuntimeModelsTab />}` â€” keine neue Parallel-Ansicht
      und kein spontaner Integrationsbruch, sondern additive Erweiterung des bestehenden Tabs.

## Erledigt: Routing-Fix real durch die UI verifiziert (2026-07-28)

- [x] Zweiter automatisiert getriebener UI-Lauf (`golden-path-run-2`) hat den Routing-Fix (`c811923`) real
      bestaetigt: exakt das Regressionsszenario reproduziert (offener Chat-Contract + Review-Anfrage ohne
      "Neue Aufgabe:"-Praefix) → `.codee/reviews/rev-*`-Artefakt mit `Agent: reviewer` wurde korrekt erzeugt,
      vorher entstand das nie. Details: `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md` ("Fortsetzungslauf 2")

## Erledigt: vorbestehende Testleichen von c537f3e repariert (2026-07-28)

- [x] `c537f3e` ("fix(chat): reduce unnecessary runtime clarifications") hatte
      `AssistantQuestionCard.tsx`-Button-Labels geaendert ("Antworten"→"Weiter",
      "Empfehlung uebernehmen"→"Empfehlung nutzen", "Abbrechen"→"Ueberspringen") und
      `PLAN_DELIVERABLE_PATTERN` in `missingInformationPolicy.ts` bewusst erweitert
      (u. a. "Implementierungsplan" gilt jetzt als genug Struktur) — aber nur
      `missingInformationPolicy.test.ts` aktualisiert, nicht `AssistantQuestionCard.test.tsx`
      (6 Fehlschlaege) und `clarificationFieldMemory.test.ts` (1 Fehlschlag). Beide Testdateien
      repariert (Labels/Testnachricht angepasst, nicht die App-Logik). `npm run typecheck` sauber,
      alle 1076 Tests gruen.

## Erledigt: Code-Review-Vertiefung nach Runtime-Chat-Scope-Erweiterung (2026-07-28)

- [x] **Routing-Bug behoben (Ursache fuer Kriterien 5/7/9/10/11-Blocker):** `inferWorkflowKind()` in
      `apps/desktop/src/runtime/workflow/workflowStateResolver.ts` hat bei Review-Anfragen faelschlich den
      `workflowKind` eines noch offenen, aelteren Task-Contracts (z. B. "chat") wiederverwendet, obwohl
      `classifiedTaskType` bereits korrekt `"review"` war — dadurch loeste `targetAgent` nie auf `"reviewer"`
      auf und der Repository-Review-Orchestrator wurde nie ausgeloest. Fix: expliziter Vorrang fuer
      `classifiedTaskType === "review"` vor der Contract-Wiederverwendung. Regressionstest ergaenzt,
      65 betroffene Tests gruen, `npm run typecheck` sauber.
- [x] **Fabrizierten/nicht-verdrahteten Code-Cluster aus Commit `fab49e6` entfernt:** derselbe Commit, der den
      "Service-Ebene erfolgreich"-Bericht schrieb, fuegte gleichzeitig `patchValidationService.ts` und
      `patchRollbackService.ts` als Beleg hinzu — beide kompilierten nicht (fehlende Module wie
      `@/services/io/atomicFileIo`, eine nie existierende IPC-Methode `deleteProjectFile`), waren von nirgendwo
      im Code erreichbar, und lagen neben eindeutigem Scaffold-Muell (`example.ts`, `package.json`, ein
      Playwright-Spec gegen nie existierende UI-Selektoren). Alle sechs Dateien entfernt, verwaiste
      `deleteFile`-Methode aus `types.ts`/`nodeReviewWorkspaceIo.ts`/`reviewWorkspaceIo.ts` mitentfernt.
      `npm run typecheck` war vorher kaputt (6 Fehler), jetzt sauber.
- [x] **Zwei echte Regressionen in `repositoryReviewOrchestrator.ts` aus demselben Commit behoben:** `state.detail`
      wurde faelschlich als "nicht Teil des Typs" entfernt (der Kommentar war falsch, das Feld existiert in
      `ReviewStateFile`) — wiederhergestellt. Ein neuer Test erwartete das falsche Review-Outcome
      (`completed_with_warnings` statt korrekt `degraded_heuristic_only` fuer den heuristik-only-Analyzer) und
      ein zweiter, dazu redundanter Duplikat-Testfall wurde entfernt — beides in `repositoryReview.test.ts` korrigiert.
- [x] Service-Level-Bericht korrigiert: 2.6/2.7 von `[x]` auf `[ ]` zurueckgestuft, Korrekturhinweis ergaenzt —
      siehe `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md`

## Erledigt: automatisiert getriebener UI-Fortsetzungslauf (Recheck-Audit 2026-07-28)

- [x] Kriterium 4 (Chat beantwortet Projektfrage) war komplett kaputt: aufeinanderfolgende `system`-Rollen-Nachrichten
      lassen Gemmas Chat-Template mit `Conversation roles must alternate` scheitern (jede Chat-Nachricht = `generation_failed`);
      gefixt per `_merge_consecutive_same_role_messages()` in `backend/app/runtime/service.py` (`a5171b7`), 34/34 Tests gruen
- [x] Kriterium 12 (Backup/Restore im Diagnostics-Tab) echt verifiziert — voller Roundtrip (Backup erstellen,
      Aenderung, Restore, Datei-/Revisionsstand korrekt wiederhergestellt)
- [x] Modellkatalog-Rescan echt verifiziert (364 Modelle, keine Wiederkehr des fruehen `runtime_dir`-Bugs)
- [x] Details siehe `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md`

## Erledigt: Repository-Bereinigung nach Recheck-Audit 2026-07-28

- [x] `.cache/backend-build/` war versehentlich getrackt (57MB PyInstaller-Artefakte, verdoppelt in `aa22942`) —
      `.gitignore` ergaenzt, mit `git rm -r --cached` entfernt, per `git-filter-repo` aus der gesamten
      `main`-Historie getilgt (Repo-Groesse 81MB → 7.6MB) und `origin/main` force-gepusht
- [x] zweiten Golden-Path-Bericht (`apps/desktop/src/services/repositoryReview/GOLDEN_PATH_VERIFICATION_2026-07-28.md`,
      Service-Ebene-Ergebnis) aus dem Quellcode-Baum nach `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md`
      verschoben und mit dem UI-Durchlauf-Bericht ueber gemeinsames Statusvokabular verlinkt

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
