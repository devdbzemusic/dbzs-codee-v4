# TODO_NEXT

Stand: 2026-08-03

Kurzer, konkreter Einstiegspunkt fuer die naechste Session. Fuer den vollen Kontext siehe `HANDOVER.md`
(neuester Eintrag oben) und `TODO.md`.

## Stufe 6 (Agentic Fleet Abschlussverifikation) — VOLLSTAENDIG BEHOBEN

Voller Verifikationslauf gegen den PR-#48-gemergten Stand durchgefuehrt (Hauptcheckout). Dabei zwei echte Bugs
gefunden und behoben: (1) fehlendes `await` vor `brokerDecision(...)` in `visionContextPackService.ts` — machte
die Vision-Context-Pack-Pipeline seit dem Routing-Umbau production-seitig faktisch funktionslos, plus 6 dadurch
zufaellig bestandene Tests korrekt neu gemockt; (2) `test_runtime_doctor.py`-Haenger root-caused und behoben —
`build_runtime_doctor()`/`build_dry_run()`/`probe_runtime()` griffen unconditional auf die echten,
produktiven Model-Lab-/Settings-Singletons zu (derselbe Bug-Typ wie der bereits dokumentierte Splashscreen-Hang),
jetzt per Sentinel-Parameter testisolierbar wie `ModelIndexService` selbst. Kompletter Backend-Lauf jetzt 632/633
gruen (233s, kein `--ignore` mehr fuer `test_runtime_doctor.py` noetig), `pnpm typecheck` fehlerfrei, `pnpm test`
1334/1336 gruen (die 2 verbleibenden sind die bereits bekannten `chatActions.test.ts`-Faelle). Details siehe
HANDOVER.md.

**Wichtig:** Das urspruenglich referenzierte Stufenplan-Dokument `Pläne/16 DBZS_CODEE_AGENTIC_FLEET_LUECKENSCHLUSS_
STUFENPLAN.md` existiert in diesem Checkout nicht mehr (per `dd7de6d` aus Git entfernt, auch nicht mehr auf der
Platte) — Nachverfolgung laeuft ab jetzt ueber `HANDOVER.md`/`TODO_NEXT.md`.

Stufe 1 (`D:\Models\Agentic` real scannen) und Stufe 5 (Dual-Mode-Vision, echter Zwei-Prozess-Lauf mit echtem
Qwen2.5-VL/MMProj) sind jetzt ebenfalls durchgefuehrt und verifiziert (App aus dem Hauptcheckout gebaut/gestartet,
`--mmproj`-Flag im echten Launch-Kommando bestaetigt, echte Chat-Antwort waehrend gleichzeitigem
`orchestrator_cpu`-Betrieb erhalten). Dabei nebenbei gefunden: `defaultOrchestratorModelId` in dieser
App-Data-Instanz zeigte noch auf die alte MiniCPM5-Bundle-ID (derselbe, heute frueher schon einmal in einer
anderen Instanz behobene Fehler) — per `PATCH /settings` auf `functiongemma-270m-it.Q8_0` umgestellt. Details
siehe HANDOVER.md.

**Noch offen:**
- Neu entdeckt: `test-fixtures/runtime-chat-tuning-lab/models/` fehlt komplett (README verspricht drei
  `.gguf`-Platzhalter, keine im Checkout/Git-Verlauf) — ein Backend-Test schlaegt deswegen fehl
  (`test_runtime_chat_tuning_lab_contains_three_gguf_models`), separat klaeren.

## Residentes-Basismodell-Fehler (MiniCPM5-Tokenizer) — BEHOBEN

`defaultOrchestratorModelId` von MiniCPM5-1B (Tokenizer vom installierten llama-server Build 8454 nicht
unterstuetzt) auf `functiongemma-270m-it.Q8_0` umgestellt — live getestet vor der Umstellung, per komplettem
Backend-Neustart verifiziert: `residentModel: "success"`, Status nicht mehr `"degraded"`. Reine
Config-Aenderung. Details siehe HANDOVER.md.

**Noch offen, bewusst nicht gewaehlt:** llama-server.exe-Upgrade (aktuell Build 8454, neuestes Release
b10236) wuerde MiniCPM5 zum Laufen bringen, betrifft aber ALLE Modelle im System und braucht danach einen
breiten Test aller anderen Modelle — Risiko/Aufwand-Tradeoff mit Nutzer abgeklaert, aktuell nicht gewuenscht.

## Trivialfragen bekamen faelschlich den vollen Tool-Katalog in den Prompt — BEHOBEN

`estimateProviderToolBudget()` hat keinen `taskType`-Parameter — der Tool-Katalog wurde rein basierend auf
der session-weiten "Werkzeugrechte"-Berechtigung eingefuegt, unabhaengig vom tatsaechlichen Nachrichteninhalt.
Eine korrekt als `casual_chat` klassifizierte Wissensfrage bekam trotzdem den vollen Tool-Katalog im Prompt,
das Modell antwortete daraufhin mit einem erfundenen Aktionsplan gegen unbeteiligte Projektdateien. Jetzt
wird der Tool-Katalog zusaetzlich unterdrueckt, wenn `taskType === "casual_chat"`. Details siehe HANDOVER.md.

## Chat-Cold-Start meldet Ladefehler sofort statt vollen Timeout abzuwarten — BEHOBEN

`POST /runtime/slots/{id}/start` blockiert im Backend bis Erfolg/Fehler, antwortet aber IMMER mit HTTP 200
(Ladefehler = `state: "error"` im Body, nie Non-2xx). `startSlot()` im Frontend pruefte nur `response.ok` —
ein Ladefehler wurde als Erfolg gewertet, der Aufrufer verbrannte danach den vollen `waitForSlotReady()`-
Timeout fuer eine generische Meldung statt der echten, sofort verfuegbaren Fehlerursache. Jetzt geprueft:
`status.state !== "running"` -> sofortiger, praeziser Fehler inkl. `stderr_tail`. Details siehe HANDOVER.md.

**Noch offen:** echte visuelle Lade-Fortschrittsanzeige (Tensor-Ladeprozent o.ae.) braeuchte einen
asynchronen Slot-Start statt der aktuellen blockierenden Single-Request-Architektur — bewusst nicht
ungefragt umgesetzt, siehe HANDOVER.md fuer Optionen.

## Model-Lab-Scan zeigt jetzt echten Fortschritt statt bei 0 zu haengen — BEHOBEN

`ScanJob.total_files`/`progress_message` existierten bereits im Schema, wurden waehrend eines laufenden
Scans nur nie beschrieben. `ModelLabScanner.scan_source()` bekommt jetzt einen `on_progress`-Callback
(nach dem Verzeichnis-Walk + nach jeder gehashten Datei), `ModelLabService.run_scan()` verdrahtet ihn ueber
mehrere Quellen mit korrekter laufender Summe. Kein Deadlock-Fix — der Scan bleibt inhaerent langsam
(volles SHA-256 pro Modelldatei), aber jetzt sichtbar statt scheinbar haengend. Live gegen echten Backend
bestaetigt (`GET /model-lab/jobs`-Polling zeigte durchgehend `2/35` -> `35/35`). Details siehe HANDOVER.md.

## Rollenmatrix verdrahtet, 3 tote Routing-Felder repariert, 9 Modelle zertifiziert — BEHOBEN

Rollen-/Workflow-/Modellmatrix aus `Pläne/check/01 DBZS_CODEE_V4_ROLLE_WORKFLOW_MODELL_MATRIX_2026-08-03.md`
umgesetzt. Dabei gefunden: `defaultDebugModelId` und `defaultOrchestratorModelId` waren im
`FleetRoutingResolver` nie tatsaechlich angeschlossen (debugging nutzte still den Coder, Orchestrator nur
beim Boot), kein "documentation"-Task-Type existierte. Alle drei jetzt repariert/neu, plus zwei neue Felder
`defaultWorkflowRoutingModelId`/`defaultDocumentationModelId` durchgaengig ergaenzt (Backend-Settings,
Shared-Types, Settings-UI, 6 neue Backend-Tests). Alle 9 zugewiesenen Modelle in Model Lab zertifiziert.
Live-Rauchtest gegen echten Backend-Prozess bestaetigt. Details siehe HANDOVER.md.

## Chat schlug bei kalter Rolle fehl ("Ziel-Slot nicht bereit") — BEHOBEN

Der allgemeine Chat-Sendepfad hatte bereits eine funktionierende On-Demand-Start-Pipeline, aber ein frueherer,
rein lesender "slot-readiness"-Gate brach VOR dieser Pipeline hart ab, sobald ein Slot noch nicht gestartet
war (`target_slot_not_running`) — generelle Form des bereits bekannten, bewusst aufgeschobenen WF-03-Problems
(WF-03 selbst deckte nur den dedizierten Repository-Review-Pfad ab). Gate wirft jetzt nicht mehr ab fuer
genau diesen einen, erwarteten Fall; alle anderen Validierungsfehler bleiben harte Abbrueche. Neuer
Regressionstest schliesst die Test-Luecke, die das ueberdeckt hatte. Details siehe HANDOVER.md.

## 16 Dependabot-Findings — BEHOBEN

Alle 16 offenen Alerts kamen ausschliesslich von zwei toten, versehentlichen Top-Level-Dependencies
(`"go"`, `"package.json"`, dazu die ebenfalls ungenutzte `"runs"`) in `apps/desktop/package.json` —
nirgendwo im Code verwendet, per `git log -S` auf Commit `cc807c0` zurueckverfolgt. Entfernt,
`pnpm-lock.yaml` neu generiert (237 Pakete weniger), `pnpm audit` jetzt sauber. Build/Typecheck/Tests
weiterhin gruen. Details siehe HANDOVER.md.

## Model Lab UI: Inspector-Panel-Stretch + Zertifizierung-Button-Clipping — BEHOBEN, PER SCREENSHOT VERIFIZIERT

Zwei CSS-Layout-Bugs im Model Lab: (1) `items-start` auf dem 2-Spalten-Grid in `ModelLabTab.tsx` ergaenzt,
damit das Inspector-Panel sich nicht mehr an der Hoehe der viel laengeren linken Spalte stretcht. (2) Die
Zertifizierung-Dropdown+Button-Zeile in `ModelLabTab.expanded.tsx` von `flex` (Button-Text brach um und
wurde in der schmalen Grid-Spalte abgeschnitten) auf gestapelte `w-full`-Elemente umgestellt, passend zum
Stil der Nachbar-Buttons. Beide per echtem Playwright-Klick-Durchlauf (Model-Lab-Tab -> Zeile aufklappen ->
zu Zertifizierung scrollen) screenshotbestaetigt. Details siehe HANDOVER.md.

## Splashscreen-Hang (Model-Lab-Quelle scannte ganzes Benutzerprofil) — BEHOBEN, LIVE VERIFIZIERT

Zwei Ursachen: `model-index`-Boot-Phase hatte `extendDeadlineOnProgress: false` trotz echtem
Fortschritts-Signal vom Backend (jetzt `true`, `maxDeadlineExtensionMs: 300_000`); vor allem aber war in
Model Lab eine Quelle `C:\Users\ralle` (ganzes Benutzerprofil) registriert, die jeden Modell-Scan auf 90s+
aufblies. Quelle per SQL geloescht (Nutzerwunsch), `GET /models/index` jetzt 2.7s statt 90s+. Per echtem
Playwright-`_electron`-Launch verifiziert: App zeigt sofort die Haupt-UI, kein Splash-Hang mehr. Details
siehe HANDOVER.md.

**Noch offen:** Model Lab hat keinen Delete/Disable-Endpoint fuer Quellen (`backend/app/api/model_lab.py`
nur `GET`/`POST /sources`) — sollte ergaenzt werden, damit sowas kuenftig ueber die UI korrigierbar ist statt
manueller DB-Chirurgie. Ausserdem: beim naechsten Diagnose-Lauf `Stop-Process` (PowerShell) statt `kill`
(Git Bash) fuer native Windows-Prozesse nutzen — `kill` erreicht sie oft nicht zuverlaessig und hinterlaesst
Prozess-Muell.

## Backend-Boot-Hang (Resident-Model-Autostart blockiert Event-Loop) — BEHOBEN

`run_resident_model_startup()` rief `build_index()`/`start_model()` synchron statt per `asyncio.to_thread`
auf und blockierte dadurch den kompletten Event-Loop beim Boot (kein "Application startup complete",
Health-Endpoint dauerhaft ECONNREFUSED, 60s-Timeout in der UI). Fix + Verifikation siehe HANDOVER.md.
**Noch offen:** kompletter Boot-Durchlauf mit echtem, groeszerem Modell nicht per Sandbox verifizierbar (kein
echtes GPU/grosses-Modell-Setup hier) — beim naechsten echten App-Start pruefen, dass der Boot jetzt bis
"bereit" durchlaeuft statt nur den Hang zu beheben. `scripts/acceptance-live.ps1` hatte bereits unstaged
Aenderungen von auszerhalb dieser Session (Timeout-Werte) — nicht angefasst, ggf. beim naechsten Mal klaeren.

## UI-Feedback aus laufender App (Nutzer-Screenshots, 2026-08-02) — ERLEDIGT, LIVE VERIFIZIERT

1) Settings-Feldlayout überarbeitet (Feld-Boxen + gestapelte Toggles). 2) Rechtes Panel bekam Modus-Umschalter
"Agents"/"Debug Log" mit live-scrollendem Event-Stream (`DebugLogPanel.tsx`, `ObservabilityService.onEvent()`
zum ersten Mal abonniert). Ursprünglich als "nicht visuell verifizierbar" markiert — Ursache war
`ELECTRON_RUN_AS_NODE=1` in der Session-Umgebung (kein Sandbox-Limit). Mit `env -u ELECTRON_RUN_AS_NODE`
liess sich die App echt starten und per Playwright screenshotten.

**Dabei echten, eigenständigen Bug gefunden + behoben:** `SettingsNotebook.tsx`s Sidebar-Modus (`compact`)
hatte eine gebrochene Flex-Height-Kette — der Feld-Body kollabierte auf **0px Höhe**, weil der Chrome
oberhalb (Warnbanner, Suche, 9 Kategorie-Tabs) bei ~360px Breite mehr Platz brauchte als verfügbar. Die
Einstellungsfelder waren dadurch im Sidebar-Modus komplett unsichtbar — das war der eigentliche Kern der
ursprünglichen Nutzerbeobachtung ("2/15 bereit", leere Dropdowns), nicht nur ein Abstandsproblem. Fix: Compact-
Modus flieszt jetzt natürlich statt eigenes internes Scrolling zu erzwingen, verlässt sich auf das bereits
funktionierende äuszere Sidebar-Scrolling. Live per Screenshot bestätigt: Modus-Umschalter sichtbar, Felder
sichtbar mit Box-Layout, Debug-Log-Modus füllt das Panel korrekt. Details + Praxis-Notiz zu
`ELECTRON_RUN_AS_NODE` siehe HANDOVER.md.

## Workflow Authority & Safety Sprint

Plan: `C:\Users\ralle\.claude\plans\zazzy-kindling-duckling.md` (Teil A-D). Nutzerauflage: nach jedem Block
committen, pushen, HANDOVER/TODO_NEXT aktualisieren.

**Teil A — ERLEDIGT (Commit `10d5161`):** kaputten, bereits gepushten `modelSelectionBroker.ts`-Build repariert
(zwei ineinander verwobene unkoordinierte Edits), fehlende `backendClient.resolveRuntimeRoute`-Verdrahtung
ergänzt, Vision-/Capability-Gate + dreistufige Fallback-Kette nach `FleetRoutingResolver` (Backend) portiert
(8 neue Pytest-Tests), tote Draft-Datei `codePatchStore.ts` entfernt. Details siehe HANDOVER.md.

**Teil B — ERLEDIGT:** einzige Routing-Wahrheit fertiggestellt. `runtimeSlotManager.resolveDefaultModelForSlot()`
fragt bei fehlendem Rollenmodell zuerst den Backend-Resolver (lokale Heuristik nur noch als geloggter
Notfall-Fallback). `FleetRoutingResolver` konsultiert jetzt `ModelLabRepository.list_routing_map()` (offizielles
Workflow-Rolle -> Fleet-Rolle-Mapping, M-002) als bevorzugte Quelle vor dem flachen Settings-Fallback. 11 Backend-
+ 2 neue Frontend-Tests. Details siehe HANDOVER.md.

**Teil C / WF-03 — ERLEDIGT:** Repository Review bekommt einen eigenen Preflight-Schritt
(`repo-review-preflight` in `runtimeChatStore.ts`) statt sofort nach dem Routing zu starten — echtes
Kontextfenster statt hartkodiert 8192, echter Slot-Start falls nötig statt gegen einen ungeladenen Slot zu
laufen. **Noch nicht live verifiziert** (siehe HANDOVER.md) — vor dem nächsten Release einmal bewusst mit
gestopptem Ziel-Slot einen Review anstoßen und pruefen. WF-10 ist über Teil B bereits weitgehend abgedeckt
(Model-Lab-Routing-Map als bevorzugte Fallback-Quelle).

**Model Lab -> Settings Workflow-Luecke — ERLEDIGT:** Nutzer-Feedback (Screenshots: "2/15 bereit", leere
Rollen-Dropdowns) fuehrte auf den echten strukturellen Bug: Rollenzuweisung im Model Lab schrieb nie das
Settings-Feld, `enableModelLabRuntimeBridge` war versteckt+aus, keine Zertifizieren-Aktion existierte in der
UI (obwohl fast jede Rolle Zertifikate voraussetzt). Alle drei behoben: Bridge-Flag jetzt Default an,
`assignModelRole` schreibt das Settings-Feld direkt, neue Zertifizieren-Sektion in
`ModelLabTab.expanded.tsx`. Neuer E2E-Backend-Test beweist die volle Kette scan->zertifizieren->zuweisen->in
Settings sichtbar. **Noch offen:** Settings-Panel-Layout selbst (Punkt 1 des Nutzerfeedbacks) unangetastet;
Embedding/Reranker/Utility bleiben auf ihrem separaten `model_lab_select`-Pfad statt ueber Rollenzuweisung.
Details siehe HANDOVER.md.

**Teil C / WF-07 — TEILWEISE ERLEDIGT:** stille Fallbacks (Kontext-Orchestrierung fehlgeschlagen,
Embedding-Suche fehlgeschlagen → lexikalisches RAG, RAG insgesamt fehlgeschlagen) setzen jetzt
`RuntimeChatRun.degraded`/`degradedReason` (bereits bestehende, UI-verdrahtete Felder) statt nur `console.info`
zu loggen. **Noch offen:** `RuntimeRunOutcome` bekommt keinen `"success_degraded"`-Wert — dafür müsste die
zentrale `runtimeRunFinalization.ts` plus mindestens zwei weitere Completion-Stellen in `runtimeChatStore.ts`
(~Zeile 2531 Agent-Turn-Loop, ~Zeile 2827 Streaming-Pfad) angefasst werden, bewusst nicht blind versucht (siehe
HANDOVER.md für Details). Kein dedizierter Test für die 3 `markRunDegraded()`-Aufrufe selbst (liegen hinter
real-service-abhängigen, in `runtimeChatStore.test.ts` bisher ungemockten Bedingungen) — nur per breitem
Regressionslauf abgesichert.

**Danach Teil D:** Usecase-Maßnahmenkatalog, 8 eigene Phasen, siehe Plan-Datei.

**Danach Teil D:** Usecase-Maßnahmenkatalog (`Pläne/check/DBZS_CODEE_WORKFLOW_USECASE_MASSNAHMENKATALOG.md`,
M-001…M-702), 8 eigene Phasen, bewusst nur grob sequenziert — mehrmonatiges Programm, siehe Plan-Datei Teil D.

**P0 - Prozessabsicherung (weiterhin gültig):**
1. **Lokale CI-Pflicht:** Vor jedem zukünftigen Merge auf `main` MUSS `pnpm ci:local:win` lokal erfolgreich durchlaufen und dokumentiert werden. (Ersatz für ausgesetzte GitHub CI).
2. **PR #34 gesperrt:** Der alte Vision-PR basiert auf einem veralteten Routing/Runtime-Stand und darf NICHT gemergt werden. Muss später in kleinen Slices neu aufgebaut werden.
3. **Parallele Agentenarbeit:** Striktes Locking / explizite Scopes einhalten, um gleichzeitige Modifikationen an Kern-Dateien zu verhindern — Teil A war ein lebendes Beispiel dafür, was ohne das schiefgeht.

## Zuvor: Abschlussverifikation Stufe 6 (Agentic Fleet)

Basis: `Pläne/16 DBZS_CODEE_AGENTIC_FLEET_LUECKENSCHLUSS_STUFENPLAN.md`. Stufen 2-5 sind umgesetzt,
verifiziert und committet/gepusht (`f069812`, `74292e1`, `3d4790c`, `0366939` auf
`codex/agentic-model-fleet-integration`). Offen ist nur noch der Abschluss:

1. **Voller Verifikationslauf** (bisher liefen nur gezielte Test-Teilmengen pro Stufe):
   - `pytest -q` fuer den kompletten `backend/tests`-Ordner. **Vorsicht:** `test_runtime_doctor.py` haengt
     laut dieser Session isoliert dauerhaft (siehe Punkt 3) — vorher gezielt deselektieren
     (`--ignore=tests/test_runtime_doctor.py`) oder mit begrenztem Timeout laufen lassen, sonst blockiert es
     den gesamten Lauf.
   - `pnpm typecheck` und `pnpm test` (voller Desktop-/Shared-Lauf, nicht nur die in Stufe 5 gezielt
     angefassten Dateien).
2. **Stufenplan-Dokument aktualisieren:** `Pläne/16 DBZS_CODEE_AGENTIC_FLEET_LUECKENSCHLUSS_STUFENPLAN.md`s
   Statustabelle mit den tatsaechlichen Ergebnissen pro Stufe fuellen (Commits, Testzahlen, offene Punkte).
3. **`test_runtime_doctor.py`-Haenger root-causen:** haengt bei `pytest tests/test_runtime_doctor.py -q`
   allein (nicht im Batch mit anderen Dateien) dauerhaft, reproduziert ueber mehrere Versuche inkl.
   Prozess-Neustart und Geraete-Reconnect. Nicht durch Stufe 5 verursacht (Datei unangetastet, betroffene
   Tests nutzen nur gefakte Services). Erster Verdacht: eine ungemockte echte Hardware-/GPU-Abfrage
   irgendwo in `build_runtime_doctor()`/`get_llama_capabilities()`, die auf dieser Maschine blockiert.
   Naechster Schritt: einzelne Tests aus der Datei isoliert laufen lassen (`pytest
   tests/test_runtime_doctor.py::test_runtime_doctor_with_temp_models_dir -q` usw.), um den genauen
   haengenden Test statt der ganzen Datei zu finden.
4. **Manuelle Abnahmen, die keine Sandbox leisten kann** (aus HANDOVER.md/TODO.md uebernommen):
   - Stufe 1 (Modell-Scan): `D:\Models\Agentic` echt scannen, veralteten lokalen Katalog neu erzeugen.
   - Stufe 5 (Dual-Mode Vision): echter gleichzeitiger Zwei-Prozess-Lauf — Text-Modell auf
     `orchestrator_cpu` UND Vision-geladene Instanz desselben Modells auf `vision_gpu` parallel, mit
     echtem Qwen2.5-VL/MMProj, `--mmproj`-Flag im tatsaechlichen Launch-Kommando bestaetigen.

## Danach: naechste offene Plan-15-Punkte (siehe TODO.md fuer volle Liste)

- `D:\Models\Agentic` als Quelle registrieren/scannen (haengt mit Punkt 4 oben zusammen)
- `llama.cpp`-RuntimeAdapter live verdrahten (`probe_load`, `health_check`, echte Benchmark-Messung)
- ~~`modelSelectionBroker` produktiv an die Fleet-Routing-Map anbinden~~ — erledigt im Workflow Authority & Safety Sprint, Teil B (siehe oben)
- manuelle Modell-Abnahme (MiniCPM5-1B, QwenPaw-Flash-2B, Agents-A1-4B, AgentCPM-Explore, Nemotron-3-Nano-4B, ...)
