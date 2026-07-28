# Handover

Stand: 2026-07-28

## Aktueller Arbeitsbranch

- aktiver Arbeitsbranch: `feature/runtime-chat-ux-overhaul` (lokaler Arbeitsstand dieser Session; die `main`-Zusammenfassung unten bleibt als historischer Kontext bestehen)
- Sicherheits-Backup-Branch: `codex/backup-runtime-chat-overhaul-2026-07-27`
- physischer Snapshot:
  `C:\Users\ralle\source\repos\_backups\dbzs-codee-project-backup-2026-07-27-runtime-chat-overhaul`

## Repo-Wahrheit

- aktiver GitHub-Remote: `https://github.com/devdbzemusic/dbzs-codee-v4.git`
- lokaler Ordnername bleibt aktuell `dbzs-codee-project`
- `origin/main` zeigt auf `d6c56c4` (Folgearbeit nach PR #4 + echter Golden-Path-Durchlauf, direkt auf `main` committet)
- offene Pull Requests im Live-Repo: keine
- Branch Protection fuer `main`: aktuell nicht aktiv

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

Quelle: `PlÃ¤ne/03 04 05 DBZS_CODEE_CONSOLIDATED_MODEL_CONTROL_MM_PAIRING_PLAN.md`
plus `PlÃ¤ne/03 04 05 DBZS_CODEE_ADAPTED_MODEL_CONTROL_MM_PLAN_CURRENT_REPO.md`

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
