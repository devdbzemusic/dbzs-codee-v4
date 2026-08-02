# TODO_NEXT

Stand: 2026-08-02

Kurzer, konkreter Einstiegspunkt fuer die naechste Session. Fuer den vollen Kontext siehe `HANDOVER.md`
(neuester Eintrag oben) und `TODO.md`.

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
