# TODO

Stand: 2026-08-01

## Jetzt direkt

Statusvokabular (projektweit): `SERVICE_VERIFIED` → `UI_VERIFIED` → `INSTALLER_VERIFIED` → `PERSONAL_STABLE`.
Aktueller Stand der sicheren Aenderungskette (Diff/Approval/Apply/Tests/Rollback) sowie Backup/Restore
und Crash-Recovery: 2.1–2.5, 3.1, 3.2 sind **`SERVICE_VERIFIED`** — siehe
`docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28-service-level.md`. **Achtung:** 2.6 (Tests) und 2.7 (Rollback)
waren dort faelschlich als verifiziert markiert (der Beleg-Code war nicht kompilierbar und nirgendwo verdrahtet,
inzwischen entfernt — siehe Korrekturhinweis im Dokument und `GOLDEN_PATH_VERIFICATION_2026-07-28-ui.md`) und
gelten wieder als offen. Der echte interaktive UI-Durchlauf in `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md`
hat dieselben Punkte noch nicht bis zum Ende durchlaufen (`UI_VERIFIED` steht noch aus):

- [x] **Ursache fuer den `no_json_array`-Blocker (7/9/10/11) gefunden und behoben (2026-07-29):** war kein
      Modell-Faehigkeitsproblem — trat identisch bei `gemma-3-1b-it-qat-q4-0` *und* dem deutlich groesseren
      `qwen2.5-coder-7b-instruct` auf, jeweils mit ~70 Zeichen Antwortlaenge. Ursache: der Review-System-Prompt
      sagte "Return ONLY a JSON array", aber nie, was bei *keinen* Findings zurueckzugeben ist — ein Modell,
      das bei einem kleinen/sauberen Batch nichts zu bemaengeln findet, antwortet dann nachvollziehbar mit
      einem kurzen Prosa-Satz statt `[]`, was der Parser korrekt als "kein Array gefunden" ablehnt.
      `llmBatchAnalyzer.ts`s System- und Repair-Prompt sagen jetzt explizit "gib bei keinen Findings `[]`
      zurueck". Zusaetzlich wird die tatsaechliche (redigierte) Modellantwort jetzt in den Diagnostics
      persistiert (`rawResponsePreview`) statt nur ihre Laenge — vorher war ein erneuter Fehlschlag ohne
      Re-Run nicht diagnostizierbar. Verifikation: `apps/desktop`- und `packages/shared`-Typecheck fehlerfrei,
      voller Desktop-Vitest-Lauf 1239 Tests gruen (2 neue Faelle in `reviewQuality.test.ts`).
      **Noch offen:** echte End-to-End-Bestaetigung mit einem laufenden lokalen Modell, dass ein Review jetzt
      wieder echte LLM-Findings statt `degraded_heuristic_only` liefert — nicht in dieser Session verifizierbar
      (siehe Sandbox-Limitierung unten), braucht eine echte interaktive Session.
- [ ] unerklaerter App-/Backend-Absturz kurz nach Modellwechsel auf `qwen2.5-coder-7b-instruct` root-causen
      (Logs: `golden-path-run-2/user-data/logs/crash.log`, zeitliche Korrelation nicht abschliessend belegt).
      **Neu (2026-07-31):** `crash.log` enthaelt jetzt `activeRuns=<run-ids>` und das Backend loggt `run_id` bei
      `chat()`/`chat_stream()`-Eintritt — ein erneuter Absturz waere jetzt tatsaechlich korrelierbar. Root-Cause
      selbst noch offen (braucht eine echte Reproduktion, siehe Sandbox-Limitierung unten).
- [ ] 2.6 (Tests)/2.7 (Rollback) gegen den echten, verdrahteten Pfad neu verifizieren:
      `apps/desktop/electron/patchPipelineService.ts`/`restorePointService.ts` ueber `runtimeChatStorePatchActions.ts`
      (nicht die entfernten `repositoryReview/patchValidationService.ts`/`patchRollbackService.ts`)
- [ ] gepacktes-Build-Userdata-Verzeichnis fuer `backupService.ts` an einem echten Installer-Build verifizieren
      (`INSTALLER_VERIFIED`) — Ablauf in `docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`
- [x] **rollenspezifische Modell-IDs sinnvoll defaulten (2026-07-31):** `modelSelectionBroker.ts` faellt jetzt,
      wenn kein `default*ModelId` konfiguriert ist, zuerst auf ein passendes laufendes und dann auf das beste
      installierte Modell zurueck (`selectionSource: "explicit_fallback"`), statt hart mit
      `"Rollenmodell in Settings fehlt"` abzubrechen — Vision-Sicherheit bleibt dabei ein harter Filter. Nur
      wenn wirklich kein kompatibles Modell existiert, gibt es weiterhin einen klaren Fehler
      (`role_model_missing_no_fallback`). **Noch offen:** manuelle Bestaetigung in einer echten Session (siehe
      `docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`, Abschnitt D.1).
- [ ] Modell-Katalog auf dieser Maschine neu scannen (veralteter `runtime_dir`, auch wenn jetzt abgefangen) —
      Rescan-Button selbst bereits `UI_VERIFIED` (364 Modelle, keine Regression)
- [x] zwei neue Plan-Dateien eingeordnet; beide sind im aktuellen Git-Stand getrackt:
      `Pläne/14 DBZS_CODEE_BACKEND_BRIDGE_REVIEW.md` und
      `Pläne/Codee_Agentenmodelle_Auswahl_Liste Teil I.md`

## Neu offen: Plan 15 Agentic Model Fleet Integration

Basis: `Pläne/15 DBZS_CODEE_AGENTIC_MODEL_FLEET_INTEGRATION_MASTERPLAN.md`. Branch:
`codex/agentic-model-fleet-integration`.

- [x] Foundation-Slice umgesetzt: Model-Lab-Schema v3, logische Modelle, Runtime-Adapter/-Presets,
      Probe-/Benchmark-Runs, Zertifikate, Rollen-Zuweisungen, Failures, Agent-Execution-Policies,
      neue `/model-lab`-Endpunkte und offizielle optionale Desktop-Bridge-/IPC-/Preload-Vertraege.
- [x] `model_variants` nachgezogen: Varianten sind als eigene SQLite-/API-/Bridge-Schicht verfuegbar und
      werden aus Bundles stabil an `logical_model_id` gebunden.
- [x] Plan-15-Source-Candidates umgesetzt: bekannte Modellpfade werden auf Existenz/Registrierung geprueft,
      `D:\Models\Agentic` ist als empfohlene Startquelle in der Model-Lab-UI uebernehmbar.
- [x] `llama.cpp`-RuntimeAdapter-Vorstufe umgesetzt: `probeModel` erzeugt bounded Command-/Validation-
      Preview mit Blockern/Warnungen, weiterhin ohne Live-Prozessstart.
- [x] Vollscan-Safety umgesetzt: `/model-lab/scan` ohne `source_id` braucht explizit `all_sources=true`;
      die UI setzt das nur beim bewussten Vollscan-Button.
- [x] Plan-15-Runtime-Presets geseedet: `cpu_fallback`, `safe_balanced`, `best_low_latency`,
      `best_throughput`, `large_context` mit GPU-/Context-/Batch-/KV-/Flash-Achsen.
- [x] Hardware-Snapshots persistiert: `/model-lab/hardware` schreibt Snapshots, `/model-lab/hardware-snapshots`
      liefert die Historie fuer Tuning-/Benchmark-Kontext.
- [x] Benchmark-Measurements normalisiert: flache numerische Benchmark-Metrics werden in
      `benchmark_measurements` gespeichert und ueber `/model-lab/benchmark-measurements` lesbar.
- [x] Rollen-Gate erzwingt Zertifikate: keine aktive Fleet-Rolle nur auf Basis von Dateiname/Heuristik;
      Workspace-/Write-Rollen verlangen zusaetzlich `WRITE_AGENT_VERIFIED`.
- [x] Safety-Level-Policy erzwingen: Rollen-Zuweisungen oberhalb des geseedeten Policy-Maximums werden
      abgelehnt, auch wenn die Zuweisung deaktiviert angelegt wuerde.
- [x] Fleet-Routing-Map umgesetzt: `/model-lab/routing-map` liefert pro Rolle Bundle, Safety-Level,
      benoetigte/bestandene/fehlende Zertifikate und `routing_allowed` als stabile UI-/Broker-Vorstufe.
- [x] Erste Roles-&-Routing-UI umgesetzt: Model Lab laedt die Routing-Map und zeigt Rolle, Modell,
      Safety-Level, Evidence-Zaehler und Freigabestatus read-only an.
- [x] Execution-Policies offiziell lesbar gemacht: `/model-lab/execution-policies` und Desktop-Bridge
      liefern die geseedeten Plan-15-Rollenregeln ohne direkten SQLite-Zugriff.
- [x] Capability Evidence offiziell angebunden: `/model-lab/capability-evidence` speichert/listet
      allgemeine Faehigkeitsnachweise pro Bundle als Basis fuer Certification, Tuning und UI.
- [x] Zertifizierungen werden zusaetzlich als Capability Evidence getrailt
      (`certification:<KIND>`), damit die Certification nicht nur im Zertifikats-Upsert sichtbar ist.
- [x] Runtime-Probes werden zusaetzlich als Capability Evidence getrailt
      (`runtime_probe:<adapter>`), damit Probe-Gates in Certification/Fleet-UI weiterverwendbar sind.
- [x] Fleet-Readiness-Map umgesetzt: `/model-lab/readiness` aggregiert Health, Probe, Benchmark,
      Evidence, Failures und Routing-Freigaben pro Bundle als grobe Gate-Uebersicht.
- [x] Readiness-Gates in der Model-Lab-UI sichtbar gemacht: Probe/Benchmark, Evidence/Zertifikate,
      Routing-Freigaben und Blocker erscheinen als eigene Fleet-Console-Vorstufe.
- [x] Sicheres Probe-Gate: `probeModel` speichert ohne `allow_start` einen `skipped`-Run und startet kein
      lokales Modell.
- [ ] `D:\Models\Agentic` als erste produktive Quelle ueber den neuen Candidate-Button registrieren/scannen
      und den veralteten lokalen Model-Katalog auf dieser Maschine neu erzeugen.
- [ ] `llama.cpp`-RuntimeAdapter live verdrahten: `probe_load`, `health_check`, echte Benchmark-Messung,
      `collect_metrics` und `stop` auf Basis der vorhandenen Command-/Validation-Preview.
- [ ] GPU-Autotuning-Matrix aus Plan 15 als echte Messlaeufe gegen die geseedeten Presets ausfuehren und
      beste Profile pro Bundle/Hardware-Snapshot persistieren.
- [ ] Fleet Console UI weiter ausbauen: Compatibility, Tuning Lab, Benchmarks, Certification-Aktionen,
      Runtime, Failures, Metadata und bearbeitbare Roles-&-Routing-Zuweisungen.
- [ ] `modelSelectionBroker` produktiv an die Fleet-Routing-Map anbinden; bis dahin bleibt die Map
      bewusst nur Model-Lab-/Bridge-Vertrag, nicht die aktive Laufzeitentscheidung.
- [ ] manuelle Abnahme mit echten Modellen: MiniCPM5-1B, QwenPaw-Flash-2B, Agents-A1-4B,
      AgentCPM-Explore, Nemotron-3-Nano-4B; danach DeepCoder, DeepScaleR, QwenPaw-Flash-4B,
      AgentCPM-Report.
- [ ] Plan-14/Runtime-Restpunkte im Fleet-Kontext weiterfuehren: `vision_gpu` mit echtem Qwen2.5-VL/MMProj
      pruefen, GPU-Exklusivitaet mit zwei echten Modellen bestaetigen, Qwen2.5-Coder-Crash root-causen,
      Role-Model-Fallback in echter Session bestaetigen.

## Neu offen: Plan 14 RAG-/Reranking-Folgen

Basis: `HANDOVER.md`, Stand 2026-08-01. `/embeddings` und `/rerank` sind umgesetzt und automatisiert
verifiziert; offen sind die Anschlussarbeiten, die bewusst nicht in denselben Slice gehoerten:

- [ ] zwei vorbestehend haengende Backend-Tests separat diagnostizieren:
      `test_model_profiles.py::test_profile_validation` und
      `test_residency_cache.py::test_sweep_idle_slots_evicts_utility_but_not_keep_resident`
- [x] RAG `retrieve()` berechnet optional automatisch `query_embedding`, wenn ein
      `defaultEmbeddingModelId` konfiguriert ist; fehlt die Konfiguration/ONNX-Unterstuetzung, bleibt
      lexikalisches Retrieval ohne 400-Failure aktiv.
- [ ] Frontend-seitige Modell-Auswahl in `embeddingService.ts` mit dem Model-Lab-ID-Raum versoehnen oder die
      kosmetisch wirkungslose Client-Modellauswahl sichtbar entfernen/erklaeren; der Server ignoriert das
      gesendete `model`-Feld aktuell bewusst und nutzt das konfigurierte Standardmodell

## Neu offen: Phase 4 manuell abnehmen

Basis: Produktionsreife-Revision Phase 4 aus `HANDOVER.md`. Die neuen Grundgerueste sind automatisiert frisch
verifiziert (Diagnose-ZIP/Restore-Point-Repair/Settings-Migrationen/Typechecks), aber die Live-/Installer-Seite
ist noch nicht vollstaendig abgenommen:

- [ ] Diagnose-ZIP-Export in einer echten Desktop-Session ausloesen und pruefen:
      ZIP wird geschrieben, enthaelt `crash.log` falls vorhanden, redigierte Settings und Modellindex-Snapshot;
      keine Secrets im Export.
- [ ] Restore-Point-Repair in einer echten Workspace-Session pruefen:
      korruptes `index.json` simulieren, vorhandene Restore-Point-Dateien sichtbar wiederherstellen,
      defekte Einzeldateien werden gemeldet statt still verworfen.
- [ ] Settings-Migrations-Backup einmal mit einer kuenftigen echten Migration oder Testmigration pruefen:
      Vor-Migrations-Backup wird nur bei echter Transformation angelegt, Luecken in der Migrationskette stoppen
      den Runner sichtbar.
- [ ] Code-Signing erst bei echtem Zertifikat weiterverfolgen:
      `CSC_LINK`/`CSC_KEY_PASSWORD` nicht im Repo ablegen; `signAndEditExecutable` erst fuer einen
      Signatur-Testbuild aktivieren.

## Neu offen: Chat-Folgeaktionen (Phase 1) manuell verifizieren

Basis: `Pläne/06 DBZS_CODEE_CHAT_FOLLOW_UP_ACTIONS_DIAGNOSE_PLAN.md`, umgesetzt und automatisiert getestet
(siehe HANDOVER.md), aber noch nicht manuell in einer echten Desktop-Session durchgeklickt:

- [ ] normale Chat-Antwort senden und pruefen, dass genau die letzte Assistentenantwort einen
      "Vorgeschlagene Folgeaktionen"-Block mit `Vertiefen`/`Naechste Schritte`/`Neue Aufgabe` zeigt
- [ ] Klick auf `Naechste Schritte` sendet den erwarteten festen Prompt; Buttons auf der aelteren Antwort
      bleiben danach inaktiv, weil nur noch die neue letzte Antwort aktive Vorschlaege zeigt
- [ ] Planungsantwort ausloesen → `Plan umsetzen` erscheint; echten Fehlschlag ausloesen →
      `Erneut versuchen`/`Ergebnis pruefen` statt der Standardvorschlaege
- [ ] waehrend eine Antwort noch gesendet wird sind die Folgeaktionen-Buttons sichtbar deaktiviert
- [ ] Patch-Approval- und Repository-Review-Flows optisch unveraendert gegenpruefen (keine Vermischung
      mit den neuen Folgeaktionen)
- [x] **Phase 2 umgesetzt und automatisiert getestet (2026-07-31):** alle vier vorher offenen Punkte
      bearbeitet, siehe `apps/desktop/src/services/runtimeChatFollowUpActions.ts`:
      - **echtes Retry mit Run-Kontext**: `retry_run` sendet jetzt den woertlichen urspruenglichen
        Nutzerprompt (ueber `run.userMessageId` in `messages` nachgeschlagen) statt einer festen
        Platzhalterformulierung, und reicht `taskType`/`provider`/`agentMode`/`forceUseResidentModel`
        als `sendOptions` durch `runtimeChatStoreInteractionActions.ts` an `sendMessage()` weiter
        (kein hartes Modell-/Slot-Pinning — dafuer fehlt in `RuntimeChatSendOptions` ein
        `forcedModelId`-Feld, das die Model-Selection-Broker-Logik veraendern wuerde; bewusst nicht
        in dieser Session angefasst).
      - **Modellwechsel-Angebot nach Fehlschlag**: neuer Action-Kind `switch_model`, erscheint
        zusaetzlich zu `retry_run`, wenn `run.resourceRisk` `"high"`/`"unsupported"` ist oder
        `run.fallbackRejection` gesetzt ist. Klick navigiert per `useNotebookStore.setActiveTab("runtime")`
        zum Model Control Center (`RuntimeModelsTab`), statt ein Modell blind zu erraten.
      - **Fehlererkennung aus Freitext**: `hasErrors` prueft jetzt zusaetzlich zu `toolCalls[].status`
        den Antworttext auf starke Fehlerindikatoren (Stacktrace-Muster, `isGenericRuntimeErrorSentinel`
        aus `runtimeRunFinalization.ts`), bewusst ohne generisches `/fehler/i`-Matching, um keine
        Fehlalarme bei Antworten auszuloesen, die frueher behobene Fehler nur erwaehnen.
      - **persistierte Folgeaktionen**: bereits durch die bestehende, generische `messages`-Synchronisierung
        in `apps/desktop/src/services/runtimeChatSync.ts` (localStorage, verlustfreier Roundtrip inkl.
        `message.actions`) abgedeckt — kein zusaetzlicher Code noetig, da Folgeaktionen als normale
        `ChatActionRequest`-Eintraege in `message.actions` liegen.
      Noch offen: manuelle Bestaetigung in einer echten Desktop-Session (siehe Punkte oben, gilt jetzt
      auch fuer die Phase-2-Ergaenzungen: `switch_model`-Navigation, echter Retry-Prompt-Inhalt).

## Neu offen: Vision-Slot-Grundlage Phase 1 — Folgeschritte

Basis: `Pläne/07 CODEE_MODELL_ROLLEN_MATRIX.md`. Phase 1 ist umgesetzt, automatisiert getestet und per
[PR #6](https://github.com/devdbzemusic/dbzs-codee-v4/pull/6) (Merge-Commit `f909fd9`) in `main`; nichts
routet heute real auf `vision_gpu`:

- [ ] optionaler manueller Sanity-Check: `previewResourcePlan()` gegen ein echtes Qwen2.5-VL-GGUF auf
      `vision_gpu` aufrufen und bestaetigen, dass der Resource-Planner die 5. Slot-ID ohne Sonderfall akzeptiert
- [x] **Phase 2 (GPU-Exklusivitaet) umgesetzt (2026-07-31):** `backend/app/runtime/gpu_exclusivity.py` —
      `RuntimeService.start_model()` stoppt vor dem tatsaechlichen Prozessstart auf `fast_gpu`/`vision_gpu` den
      jeweils anderen GPU-Slot, mit begrenztem Warten auf laufende Requests (`wait_for_slot_drain`) statt
      Hard-Kill. Siehe `HANDOVER.md`. **Noch offen:** manuelle Bestaetigung mit zwei echten Modellen
      (`docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`, Abschnitt D.3).
- [x] **Phase 3 (Broker-Routing) umgesetzt (2026-07-31):** ein Modell, das strikt einen Vision-Projector
      benoetigt, wird zwingend auf `vision_gpu` geroutet; `defaultVisionModelId` ist jetzt `user_tunable` und
      wird fuer die vier Vision-Task-Typen konsultiert. `autoStartVisionRuntime` bleibt bewusst `orphaned` —
      es existiert weiterhin kein Auto-Start-Consumer dafuer. Siehe `HANDOVER.md`.
- [ ] separat bleiben lassen: FunctionGemma-Routing-Integration, Yi-Coder-9B-„Advisor“-Rolle,
      `defaultTesterModelId`/`defaultDocsModelId`, TS/Python-Settings-Schema-Drift (alle bewusst nicht Teil
      dieses Slices)

## Neu offen: Workflow-Audit-P0-Fixes manuell verifizieren

Basis: `Pläne/08 CODEE_V4_WORKFLOW_AUDIT.md`. Die P0-Fixes A–C/E sind umgesetzt, automatisiert getestet und
per [PR #6](https://github.com/devdbzemusic/dbzs-codee-v4/pull/6) (Merge-Commit `f909fd9`) in `main`; der
eigentliche Bug (Visionmodell bei Dateianfrage, roher Tool-Call-Envelope als Antwort sichtbar) braucht eine
echte Modell-Inferenz zur Bestaetigung.

**Wichtig — in der Agent-Sandbox nicht durchfuehrbar:** zwei Versuche (2026-07-29), die Desktop-App per
Playwright/`_electron.launch()` gegen ein echtes lokales Modell (`gemma-3-1b-it-qat-q4-0`, isoliertes
`DBZS_APP_DATA_DIR`/`DBZS_DEV_USER_DATA_DIR`, Kopie von `test-fixtures/runtime-chat-tuning-lab` als Workspace)
zu treiben, scheiterten beide **nicht** an der App, sondern daran, dass diese Sandbox selbst gestartete
Hintergrundprozesse (Backend + Electron) nach ca. 2-3 Minuten Laufzeit beendet — unabhaengig von Startmethode
(Bash-Hintergrundprozess, PowerShell `Start-Process` detached) und unabhaengig davon, ob das Modell vorher
schon warmgeladen war (zweiter Versuch startete das Modell direkt ueber `/runtime/slots/quality_cpu/start`
*vor* dem Electron-Start — trotzdem verschwanden beide Prozesse nach aehnlicher Zeitspanne). Bestaetigt hat
sich dabei immerhin: App-Boot, Modell-Routing-Konfiguration, Settings-Persistenz (inkl. neuem
`defaultVisionModelId`-Feld) und der Runtime-Slot-Start ueber die API funktionieren alle korrekt. Der
eigentliche Chat-Smoke-Test braucht eine echte interaktive Session ausserhalb dieser Sandbox (z. B. per
`start-dev.ps1`), keine erneuten Agent-Versuche mit denselben Mitteln.

- [ ] manuellen Smoke-Test fahren (echte interaktive Session, nicht per Agent-Sandbox): "Zähle alle GGUF
      Modelle im Workspace" (oder aehnliche Dateianfrage) gegen ein kleines lokales Modell, das bei
      Tool-Result-Folgeturns bekanntermassen degradiert
- [ ] bestaetigen: kein roher `<CODEE_TOOL_CALL>`-Text erscheint je als sichtbare Antwort
- [ ] bestaetigen: der Lauf wird bei fehlender Endantwort als `empty_final_answer`/`agent_loop_incomplete`
      gemeldet, nicht mehr still als `success`
- [ ] bestaetigen: Tool-Result-Systemnachrichten erscheinen im Hauptchat eingeklappt, nicht als roher JSON-Dump
- [ ] bestaetigen: bestehende Patch-Approval- und Repository-Review-Flows optisch unveraendert
- [ ] Punkt D (deterministische `search_workspace_files`/`count_workspace_files`-Tools) und Punkt F
      (aufgabenabhaengiges Routing weg von Visionmodellen) als separate Folgearbeit einordnen/priorisieren

## Neu offen: Runtime-Chat-Dateianhaenge

- [ ] manuellen Desktop-Durchlauf fuer generische Dateianhaenge fahren:
      Bild + `md/json/js/ts/tsx/py/txt/pdf/zip`, Mehrfachauswahl, Entfernen vor Send, Senden ohne Textprompt
- [ ] ZIP-/PDF-Edgecases manuell pruefen:
      leere/gesperrte PDFs, grosse ZIPs, abgeschnittene Inhalte, klare UI-Hinweise bei Limits
- [ ] optionalen Folge-Slice entscheiden:
      Drag-and-Drop bewusst spaeter oder als naechsten UX-Ausbau aufnehmen

## Erledigt: Vision-Slot-Grundlage Phase 1 (2026-07-29)

Basis: `Pläne/07 CODEE_MODELL_ROLLEN_MATRIX.md`. Committet und per
[PR #6](https://github.com/devdbzemusic/dbzs-codee-v4/pull/6) (Merge-Commit `f909fd9`) in `main` gemergt.

- [x] neuer `RuntimeSlotId`-Wert `vision_gpu` (Port 8085) plus vier neue `RuntimeTaskType`-Werte
      (`image_analysis`, `ui_analysis`, `visual_debugging`, `document_vision`) in `runtimeSlots.ts`,
      erzwungen durch die `satisfies Record<RuntimeSlotId, RuntimeSlotDefinition>`-Constraint
- [x] Slot-ID-Duplikation an vier Stellen synchron aktualisiert: `runtime-slots.json`, `schemas.py`,
      `slot_contract.py`, `runtimeSlotManager.ts` (`ALL_SLOTS`, Scoring, Default-Modell-Aufloesung)
- [x] `residency.py`: `vision_gpu` → `IDLE_EVICT`; `lazyRuntimePolicy.ts`: `vision_gpu` in die
      Idle-Eviction-Watch-Liste aufgenommen
- [x] neues, bewusst `orphaned`/`readonly` Setting `defaultVisionModelId` (TS + Backend-Pendant)
- [x] Nebenfund behoben: `runtimeChatStoreOnDemandExecution.ts`s Resident-Fallback-Typ schloss `vision_gpu`
      noch nicht aus (nur `orchestrator_cpu`)
- [x] Verifikation: beide TS-Projekte fehlerfrei; voller Desktop-Vitest-Lauf 1226 Tests gruen; Backend-Pytest
      fuer die betroffenen Suiten plus breitere `runtime`/`slot`/`residency`-Filterauswahl (153 Tests) gruen;
      ein isolierter, vorbestehender Windows-Datei-Lock-Flake in `test_task_manifest.py` bestaetigt (unrelated)
- [x] Phase 2 (GPU-Exklusivitaet)/Phase 3 (Broker-Routing) waren bewusst nicht Teil dieses Slices — beide
      inzwischen umgesetzt (2026-07-31), siehe "Neu offen" oben / `HANDOVER.md`

## Erledigt: Workflow-Audit P0-Fixes (2026-07-29)

Basis: `Pläne/08 CODEE_V4_WORKFLOW_AUDIT.md`. Committet und per
[PR #6](https://github.com/devdbzemusic/dbzs-codee-v4/pull/6) (Merge-Commit `f909fd9`) in `main` gemergt.

- [x] Ursachenfix: `finalContent = stripToolCallBlocks(rawContent) || rawContent` in `agentTurnEngine.ts` holte
      den rohen Tool-Call-Envelope zurueck, sobald ein Turn nur Protokoll-Markup enthielt — `|| rawContent`
      entfernt; ein reiner Tool-Call-Turn liefert jetzt `""`, was ueber die bereits vorhandene
      `inferFailureOutcome()`-Logik korrekt zu `empty_final_answer` fuehrt
- [x] neue `isToolOnlyAnswer()` in `runtimeRunFinalization.ts`, in `isValidFinalAnswer()` verdrahtet —
      Sicherheitsnetz fuer beide Finalisierungspfade (Agent-Turn-Loop und Streaming)
- [x] `runtimeChatStoreAgentTurnFinalization.ts`: `agentLoopCompleted` wird aus `terminalReason` abgeleitet
      (`false` nur bei `budget_exceeded`/`cancelled`) statt hart `true`; `tool_calls_executed` bewusst
      ausgenommen (kumulativer Zaehler, normaler Abschluss fuer erfolgreiche Tool-Nutzung)
- [x] neue `normalizeWorkspaceToolPath()` in `toolAdapterBridge.ts`: fuehrender Slash gilt als
      workspace-root-verankert, absolute Windows-Pfade/`..`-Segmente werden mit klarer Fehlermeldung abgelehnt
      statt still `[]` zurueckzugeben
- [x] `RuntimeChatMessageCard.tsx`: `isCollapsedSystem`-Einklappen war an die nie gesetzte `compact`-Prop
      gebunden — Bedingung entfernt, Tool-Result-Systemnachrichten klappen jetzt im Hauptchat ein
- [x] Verifikation: beide TS-Projekte fehlerfrei; voller Desktop-Vitest-Lauf 1237 Tests gruen (11 neue Faelle),
      keine Regressionen im bestehenden Tool-Call-/Patch-Pfad
- [ ] manueller Smoke-Test mit echter Modell-Inferenz steht noch aus — siehe "Neu offen" oben
- [ ] Punkt D/F aus dem Audit bewusst nicht Teil dieses Slices

## Erledigt: generische Post-Response-Folgeaktionen im Chat, Phase 1 (2026-07-29)

Committet und per [PR #5](https://github.com/devdbzemusic/dbzs-codee-v4/pull/5) (Merge-Commit `210f0ff`) in `main` gemergt.

- [x] `apps/desktop/src/services/runtimeChatFollowUpActions.ts` neu: deterministischer
      `buildFollowUpActions()`/`attachFollowUpActionsToMessages()`-Builder, max. 3 Vorschlaege pro Antwort
- [x] sechs additive `ChatActionKind`-Werte in `packages/shared/src/index.ts`
      (`continue_task`, `implement_plan`, `show_next_steps`, `retry_run`, `inspect_result`, `new_task`);
      `confirm_continue` bleibt unveraendert dem Patch-Approval-Flow vorbehalten
- [x] Gating fuer needs_user_input/cancelled/repositoryReview/offene Plan- oder Patch-Proposal
      (unterdruecken Vorschlaege komplett), echten Fehlschlag (Retry/Ergebnis pruefen), Tool-Call-Fehler
      (Fehler beheben) und Planungsantworten (Plan umsetzen) implementiert
- [x] in beiden Finalisierungspfaden verdrahtet (Agent-Turn-Loop und Streaming) in `runtimeChatStore.ts`
- [x] Klick-Dispatch ueber bestehende `handleChatAction`/`sendMessage`-Pipeline, keine neue Sonder-Pipeline
- [x] `RuntimeChatMessageCard.tsx`/`RuntimeChatConversationFeed.tsx`: getrennter "Vorgeschlagene
      Folgeaktionen"-Block, nur auf der jeweils letzten Assistentennachricht aktiv, waehrend `isSending`
      deaktiviert; Workspace-Wechsel entfernt stale Folgeaktionen automatisch mit
- [x] Verifikation: `npx tsc --noEmit` (web + node) fehlerfrei; voller Desktop-Vitest-Lauf
      194 Testdateien/1223 Tests gruen, keine Regressionen; vier neue/erweiterte Testdateien
      (`runtimeChatFollowUpActions.test.ts`, `runtimeChatActionSelectors.test.ts`,
      `RuntimeChatMessageCard.test.tsx`, `chatActions.test.ts`)
- [ ] manueller Durchklick in echter Desktop-Session steht noch aus — siehe "Neu offen" oben

## Erledigt: generische Runtime-Chat-Dateianhaenge (2026-07-28)

- [x] bildspezifischen Attachment-Pfad auf generische `RuntimeChatAttachment`s erweitert
      (`image`, `document`, `archive`, `text`, `code`)
- [x] gemeinsamen Attachment-Dialog mit Mehrfachauswahl statt reiner Bildauswahl eingebaut
- [x] `Strg+V` verarbeitet jetzt Clipboard-Datei-Items auch fuer Bilder, Text-/Code-Dateien, PDF und ZIP
- [x] Composer und Turn-Karten rendern dateitypspezifische Vorschauen statt nur Bild-Thumbnails
- [x] Text-/Code-Dateien werden als strukturierte Attachment-Bloecke in den User-Turn eingebracht
- [x] PDF-Aufbereitung lokal ueber neue Backend-Route `prepare-chat-attachments` umgesetzt
- [x] ZIP-Aufbereitung mit temporaerer Entpackung ausserhalb des Workspace, rekursiver Inventarisierung
      und Inline-Uebernahme nur fuer erlaubte Text-/Code-Dateien umgesetzt
- [x] nicht-bildliche Dateianhaenge lassen Vision-Gates unberuehrt; nur echte Bildpayloads markieren Vision-Bedarf
- [x] Backend-Dependency `pypdf` aufgenommen
- [x] Verifikation:
      `npm run typecheck` in `apps/desktop`,
      fokussierter Vitest-Lauf (58 Tests),
      `pytest backend/tests/test_runtime_api.py backend/tests/test_runtime_chat_attachments.py -q` (14 Tests)

## Neu eingeplant: Model Control Center + MMProj/MM-Pairing

Kurzstatus 2026-07-28h:
- `RuntimeModelsTab` arbeitet jetzt als eigenes MM-Pairing-Control-Center mit separater Paarliste, Risiko-Sortierung,
  Probe und manueller Neu-Zuordnung.
- `runtimeChatStoreRoutingPhase` reicht `multimodal_pairs` jetzt in den `modelSelectionBroker` durch; projector-pflichtige
  Visionmodelle werden ohne verifiziertes `routing_allowed = true` sauber blockiert.
- Screenshot-Coding/-Review mit Bildinput wird jetzt zusaetzlich nur noch fuer Visionmodelle mit expliziter `code`-Capability
  freigegeben; vision-only/chat-only Modelle werden im Broker mit Diagnose gestoppt.
 
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
- [x] **Zwischenschritt 2026-07-28e:** Runtime-Probe prueft den gestarteten Endpoint jetzt explizit nach:
      Basis-Endpoint und `/v1/models` muessen antworten, bevor ein multimodales Paar als verifiziert gespeichert wird.
      Fehlende Endpoint-Nachweise blockieren die Freigabe weiterhin.
- [x] **Zwischenschritt 2026-07-28f:** multimodale Probe prueft jetzt auch einen echten Bild-Chat:
      MMProj-Paare gelten erst dann als verifiziert, wenn neben Start, Basis-Endpoint und `/v1/models` auch ein kleiner
      Vision-Request erfolgreich beantwortet wird. Fehlerursachen aus dem Bildtest werden als Probe-Evidenz mitgegeben.

Basis: `Pläne/03 04 05 DBZS_CODEE_CONSOLIDATED_MODEL_CONTROL_MM_PAIRING_PLAN.md` plus
`Pläne/03 04 05 DBZS_CODEE_ADAPTED_MODEL_CONTROL_MM_PLAN_CURRENT_REPO.md`

- [ ] **Phase 1 - Index-Haertung und Vertragsklarheit:** `mmproj-*.gguf` nie mehr als startbares Modell behandeln; `index.models`
      auf eigenstaendig startbare Modelle begrenzen und additiv `supportArtifacts` sowie spaeter `multimodalPairs` einfuehren.
      Pflicht-Regressionskern: MMProj sichtbar, aber nie startbar/routbar/primary coding model.
- [ ] **Phase 2 - Paarungslogik aufbauen:** Katalog-/manuelle Zuordnung, Same-Folder-Heuristik, Namensnormalisierung und
      Metadatenvergleich fuer `MultimodalPair`; mehrdeutige oder unvollstaendige Faelle muessen explizit als
      `ambiguous`/`missing_base`/`missing_projector`/`orphan` sichtbar bleiben und duerfen kein Routing freigeben.
- [ ] **Phase 3 - Runtime-Probe einfuehren:** interner `RuntimeLaunchProfile` mit optionalem `mmprojPath`, temporaerer Probe-Start
      (`--model` + `--mmproj`), persistente Verifikation, Endpoint-/`/v1/models`-Nachweis und kleiner echter Bildtest
      sind jetzt vorhanden; offen bleibt vor allem die weitere Verfeinerung des Ergebnisverlaufs, weiterhin ohne automatische
      Modellstarts beim App-Start.
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

## Erledigt: Runtime Model Control Center weiter verdichtet (2026-07-28)

- [x] `RuntimeModelsTab` zeigt jetzt fuer Startmodelle Rollen-, Routing- und Aktions-Summaries
      (`Laufend`, `Ladbar`, `Blockiert`) und priorisiert die Tabelle nach aktivem Laufstatus sowie Routing-Nutzen
- [x] `Multimodale Paare` sind ueber Source- und Action-Summaries (`Probe bereit`, `Zuordnung noetig`,
      `Erledigt`, `Blockiert`) direkt scanbar
- [x] sichtbare Hilfsartefakte zeigen jetzt Typ-, Aktions- und Status-Summaries
      (`MMProj`, `Adapter/LoRA`, `Verifiziert`, `Candidate`, `Orphan`, `Nur Hinweis`) und werden
      handlungsorientiert sortiert
- [x] Verifikation:
      `npm run test -- src/components/notebook/RuntimeModelsTab.test.ts src/services/modelSelectionBroker.test.ts`
      (87 Tests gruen),
      `npm run typecheck` in `apps/desktop`

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
