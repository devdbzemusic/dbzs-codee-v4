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

**Teil B — NÄCHSTER SCHRITT:** eine einzige Routing-Wahrheit fertigstellen.

1. `runtimeSlotManager.ts`s `selectDefaultModelForSlot()`/`scoreModelForSlot()` (eigene lokale Modellwahl bei
   Auto-Start) auf `backendClient.resolveRuntimeRoute()` umstellen, lokale Heuristik nur als Notfall-Fallback
   bei nicht erreichbarem Backend behalten (explizit geloggt).
2. Offizielles Workflow-Rolle -> Fleet-Rolle -> Zertifizierungs-Mapping: `ModelFleetRole`/`ModelLabRoleAssignment`
   existieren bereits (`packages/shared/src/index.ts`, `backend/app/model_lab/`), werden aber von
   `FleetRoutingResolver` nicht konsultiert — Model-Lab-Routing-Map als bevorzugte Quelle vor dem flachen
   Settings-Fallback einbinden.

**Danach Teil C:** WF-03 (Repository Review hinter Runtime-/Budget-/Binding-Gates verschieben — Branchpunkt
`runtimeChatStore.ts:1029-1074` vs. Budget-Gate bei `runtimeChatStore.ts:1829`), WF-10 (deterministische
Fallback-Kette, überschneidet sich mit Teil B), WF-07 (`DegradationLedger`).

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
- `modelSelectionBroker` produktiv an die Fleet-Routing-Map anbinden
- manuelle Modell-Abnahme (MiniCPM5-1B, QwenPaw-Flash-2B, Agents-A1-4B, AgentCPM-Explore, Nemotron-3-Nano-4B, ...)
