# Agentic-Modell-Flotte: Integration von `D:\Models\Agentic` in Codee

## Kontext

Der Nutzer hat 13 lokale "agentic" GGUF-Modelle unter `D:\Models\Agentic\` gesammelt (Größen 0.64–5.24 GiB,
eines davon vision-fähig mit MMProj) und dazu zwei sehr ambitionierte Plandokumente geschrieben
(`Pläne/15 DBZS_CODEE_AGENTIC_FLEET_IMPLEMENTIERUNGSPLAN.md`, `Pläne/15 DBZS_CODEE_AGENTIC_MODEL_FLEET_INTEGRATION_MASTERPLAN.md`),
die ein komplett neues, paralleles Backend-Modul (`backend/app/runtime_fleet/`) mit eigenem Lease-/Queue-System,
8 neuen Agenten-Rollen, 4 Runtime-Slots und einem neuen Fleet-Dashboard vorschlagen.

Eine Recherche gegen den echten aktuellen Code (zwei parallele Explore-Agenten, Ergebnisse direkt gegen die
Quelldateien verifiziert) zeigt: **~90 % der "Fleet"-Grundlagen und ~70 % der "Masterplan"-Scan-Schicht existieren
bereits** — nur unter anderen Namen (5 echte Runtime-Slots inkl. `vision_gpu`, nicht 4; GPU-Exklusivität bereits
scharf geschaltet; Idle-Eviction/Residency bereits vorhanden; ein Prozess-Supervisor mit Restart-Budget läuft
bereits; Model Lab scannt bereits mehrere Quellen mit echter SHA-256-Identität, Bundle-Gruppierung und echtem
GGUF-Metadaten-Parser). Der Nutzer hat sich nach Sichtung dieser Befunde für einen **Hybrid-Ansatz** entschieden:
bestehende Module (`backend/app/model_lab/`, `backend/app/runtime/`) um die tatsächlich fehlenden Fähigkeiten
erweitern — kein neues paralleles Modul, keine duplizierten SQLite-Tabellen für Dinge, die schon existieren.

**Ziel dieses Plans:** alle 13 Modelle über das bestehende Model-Lab-Scanning katalogisieren, ihnen Rollen
zuweisen (über die bestehenden 8 Settings-Rollenfelder plus eine neue, kleine Taxonomie-Tabelle für Rollen ohne
passenden Slot), echten Dual-Mode-Betrieb für das einzige vision-fähige Modell (InternScience_Agents-A1-4B) auf
dem Text-Orchestrator-Slot ermöglichen, sowie die drei echten Infrastruktur-Lücken schließen, die die Recherche
bestätigt hat: RAM-Prozentschwellen-Schutz, persistente Health-/Failure-Historie, und Zertifizierung/Benchmarks
verknüpft mit Model-Lab-Bundle-IDs statt der alten, getrennten Modell-ID-Welt.

**Nutzerentscheidungen (bindend für diesen Plan):**
1. Hybrid: bestehende Module erweitern, kein neues `runtime_fleet`-Modul.
2. Alle 13 Modelle werden erfasst (nicht nur die vom Plandokument selbst empfohlenen ersten 5).
3. Echte Dual-Mode-Unterstützung für InternScience_Agents-A1-4B: dauerhaft resident als Text-Orchestrator,
   MMProj nur bei echtem Bildbedarf temporär dazuladen (kein Vision-only-Downgrade des Modells).

## Vier verifizierte Korrekturen an den Quellplänen

Diese wurden **direkt gegen den Code gelesen und bestätigt** (nicht nur vom Recherche-Agenten behauptet) — sie
verändern den Umfang von Phase 3 und 5 spürbar:

1. **Scanner-Bug bestätigt** (`backend/app/model_lab/scanner.py:130-141`): `_infer_artifact_type()` prüft
   `suffix in PRIMARY_MODEL_EXTENSIONS` (Zeile 137, enthält `.safetensors`) **vor** der
   `"adapter"/"lora" in name`-Prüfung (Zeile 139). LoRA-Adapter-Dateien (`adapter_model.safetensors`) werden
   dadurch faelschlich als `artifact_type="model"` statt `"adapter"` klassifiziert und bekommen ein eigenes,
   falsches Bundle statt als Zubehör am Basis-GGUF zu hängen. Betrifft `llama-3.2-1b-mini-agent/adapter_model.safetensors`
   und `VibeThinker-Fable-Nano-Agentic-3B\adapter\adapter_model.safetensors`.
2. **Kein Live-Mechanismus für `--mmproj` beim Start** bestätigt: `StartModelRequest`
   (`backend/app/runtime/schemas.py:73-76`) hat nur `model_id`/`slot_id`/`profile` — kein Feld für einen
   Projector-Pfad. `--mmproj` wird nur aus statischen Katalog-Einträgen gelesen (`index_service.py`), nie
   dynamisch zur Anfragezeit gesetzt. Der ursprüngliche Plan-Wunsch "MMProj nur bei Vision-Bedarf laden" braucht
   also echte neue Arbeit an der Request-Kette, keine Wiederverwendung von `probeRuntimeModel` (das taggt nur
   ein Pairing im Katalog, ist kein Start-Parameter).
3. **`orchestrator_cpu` ist bereits hart auf CPU-only + feste Kleinparameter gepinnt** — bestätigt
   (`backend/app/runtime/service.py:948-955`): `n_gpu_layers=0`, `context_size=4096`, `n_threads=4`, `parallel=2`,
   mit dem Kommentar "it's a 270M model" (ursprünglich für FunctionGemma geschrieben, gilt aber für jedes Modell
   auf diesem Slot). Gute Nachricht für Entscheidung 3: InternScience auf `orchestrator_cpu` braucht dadurch
   automatisch keine GPU-Exklusivität. Reales Risiko: die für ein 270M-Routermodell gedachten festen Werte
   (v.a. `context_size=4096`) sind für ein 4B-Modell eventuell ungeeignet und müssen geprüft werden.
4. **`defaultOrchestratorModelId` existiert bereits** (`packages/shared/src/appContracts.ts:117,228`,
   `settingsRegistry.ts:288-298`) — aber nur an den Boot-Zeit-Resident-Start angebunden
   (`resident_model_startup.py`), nicht an `modelSelectionBroker.ts`s Rollenauflösung. Die App hat also bereits
   **8** Settings-Rollenfelder (`defaultModelId`, `defaultChatModelId`, `defaultPlannerModelId`,
   `defaultCoderModelId`, `defaultReviewerModelId`, `defaultDebugModelId`, `defaultVisionModelId`,
   `defaultOrchestratorModelId`), nicht 6 — für die 5 echten Slots ist rollentechnisch nichts weiter zu ergänzen.

## Rollenauflösung (Entscheidung zu "8 Fantasie-Rollen vs. echte 8 Settings-Felder")

- **Wiederverwendung** der 8 bestehenden Settings-Felder für alles, was tatsächlich zu einem `TaskType`/Slot
  routet — keine neuen Settings-Felder, da kein 6. Slot existiert, auf den ein neues Feld routen könnte.
- **Neue, kleine Taxonomie-Tabelle** (`model_role_assignments` in Model Labs bestehender SQLite) für die 5
  konzeptionellen Rollen aus dem Masterplan, die zu keinem `TaskType` gehören (Deep-Research-Agent,
  Report-Generator, Algorithmus-Spezialist, Reasoning-Validator, Micro-Tool-Agent) — dient dem manuellen
  Auffinden/Starten dieser Modelle über die UI, nicht der automatischen Broker-Auswahl.

## Phasen

Empfohlene Reihenfolge: **0 → 1 → 2 → 3 → (4 und 6 parallel) → 7 → 8 → 5**. Phase 5 bewusst zuletzt — sie ist die
riskanteste, neuartigste Arbeit (neues Wire-Feld, neuer Resource-Planner-Input, neues Broker-Feld-Durchreichen)
und profitiert davon, dass Phase 3s UI und Phase 7s Zertifizierung schon existieren, um sie end-to-end zu
verifizieren. Jede Phase ist für sich lauffähig/verifizierbar (Konvention dieses Repos, siehe `HANDOVER.md`s
bisherige Phasen-Slices).

### Phase 0 — Scanner-Bug fixen (Voraussetzung)

**Ziel:** LoRA-Adapter-Dateien werden korrekt klassifiziert und ans Basis-GGUF-Bundle gehängt.

- `backend/app/model_lab/scanner.py`: `_infer_artifact_type()` — die `"adapter"/"lora" in name`-Prüfung muss
  **vor** der `suffix in PRIMARY_MODEL_EXTENSIONS`-Prüfung laufen (nicht `.safetensors` aus
  `PRIMARY_MODEL_EXTENSIONS` entfernen — echte Safetensors-Vollmodelle müssen weiter als `"model"` erkannt werden).
- `VibeThinker-Fable-Nano-Agentic-3B\adapter\adapter_model.safetensors` liegt in einem **Unterordner**, nicht im
  selben Verzeichnis wie das Basismodell — `_build_bundles()` gruppiert strikt pro Verzeichnis (`parent_path`).
  Für diese Phase: als separates `INCOMPLETE`-Bundle akzeptieren (passt zum bestehenden
  Orphan-Handling, kein Risiko). Automatisches Zusammenführen über Unterordner hinweg bewusst nicht in dieser
  Phase — nur als Backlog-Punkt vermerken, falls später gewünscht.
- Test: `backend/tests/test_model_lab_scanner.py` (Namen vor dem Edit per Glob bestätigen) — neue Fixtures für
  GGUF+Adapter im selben Ordner (erwartet: ein Bundle, Adapter als `artifact_type="adapter"` im Bundle) und für
  den Unterordner-Fall (erwartet: separates `INCOMPLETE`-Bundle).

**Verifikation:** neue + bestehende `test_model_lab_scanner.py`/`test_model_lab_repository.py` grün.

### Phase 1 — `D:\Models\Agentic` als Model-Lab-Quelle einbinden (reine Verifikation, kein neuer Code)

Bestehenden Ablauf nutzen: `POST /model-lab/sources` (Pfad, `recursive: true`) → `POST /model-lab/scan` →
`GET /model-lab/models` prüfen (13 Basis-Bundles, InternScience mit `modalities: ["image"]` und
`same_folder_projection_model`-Evidenz, beide Adapter korrekt behandelt gemäß Phase-0-Entscheidung) →
`GET /model-lab/hardware` prüfen (4 GB VRAM/32 GB RAM korrekt erkannt, wird in Phase 8 gebraucht).

**Verifikation:** die manuelle Prüfung selbst — jede Abweichung ist ein Phase-0-Scope-Bug, keine neue Phase.

### Phase 2 — `model_lab_bridge.py` sicher aktivieren (Voraussetzung für alles Weitere)

**Ziel:** Model-Lab-Bundles werden im laufzeitstartbaren `IndexedModel`-Raum sichtbar (nötig, da
`modelSelectionBroker.ts` auf `IndexedModel.id` routet, nicht auf Model-Lab-Bundle-IDs), ohne das in einer
früheren Session dokumentierte Risiko eines >Minuten langen synchronen Scans in `build_index()`.

**Aktivierungsstrategie: expliziter Settings-Schalter + zahlmäßig begrenzter Scan** (kein Hintergrund-Thread —
zu viel neue Komplexität für ein Problem mit einfacherer Lösung):
- Neues Settings-Feld `enableModelLabRuntimeBridge: boolean` (Default `false`, `user_tunable`,
  `restartRequirement: "runtime_restart"`) — `packages/shared/src/appContracts.ts`, `settingsRegistry.ts`,
  Backend-Pendant.
- `backend/app/models/index_service.py::_from_filesystem()`: `max_files_per_root`-Deckel (z. B. 500) beim
  Scan der `extra_roots`, plus `time.monotonic()`-Wall-Clock-Budget (z. B. 5s) — überschreitende Wurzeln werden
  übersprungen und als Warnung geloggt, nicht abgebrochen.
- `ModelLabRepository`-Instanz aus einer bestehenden/geteilten FastAPI-Dependency beziehen statt pro Aufrufstelle
  neu zu öffnen (vor dem Anfassen der Aufrufstellen per `Grep "ModelIndexService(" backend/app --type py -g '!test*'`
  die aktuelle, genaue Zahl der echten Konstruktionsstellen neu ermitteln — die frühere HANDOVER-Notiz von "elf"
  könnte über eine gemeinsame Factory-Funktion laufen, die sich an einer Stelle patchen lässt).
- `backend/tests/test_model_index.py`: bestehenden Default-Aus-Test (`test_model_index_ignores_model_lab_by_default`)
  als Regressionswächter beibehalten; neuer Test für den Datei-Deckel (synthetisches großes Verzeichnis,
  Wall-Clock-Assertion).

**Verifikation:** Schalter aus → unverändertes Verhalten (Regressionstest). Schalter an, echte Session: alle 13+
Modelle erscheinen in `GET /models/index` mit Model-Lab-Health-/Tag-Overlay, Antwortzeit bleibt sinnvoll.

### Phase 3 — Rollen & Routing: neue Tabelle + minimale Endpunkte + UI

**Backend** (`backend/app/model_lab/repository.py`, neue Tabelle neben `model_metadata`/`model_collections`):

```sql
CREATE TABLE IF NOT EXISTS model_role_assignments (
    bundle_id TEXT PRIMARY KEY,
    settings_field TEXT,        -- eines der 8 echten Settings-Felder, nullable
    taxonomy_role TEXT,         -- freies Label fuer die 5 nicht-routbaren Rollen, nullable
    residency_intent TEXT NOT NULL DEFAULT 'manual',  -- keep_resident | idle_evict | manual
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (bundle_id) REFERENCES model_bundles(bundle_id) ON DELETE CASCADE
);
```
- `models.py`: `ModelRoleAssignment`/`ModelRoleAssignmentUpdate`.
- `repository.py`: `get_role_assignment`/`set_role_assignment`/`list_role_assignments`.
- `api/model_lab.py`: `GET`/`PUT /model-lab/models/{bundle_id}/role` (neue Endpunkte am bestehenden Router).
- Wichtig: `settings_field` ist **nur Hinweis/Metadaten**, kein direkter Schreibpfad auf den Settings-Store —
  das eigentliche Setzen bleibt über die bestehende Settings-UI, um keine zweite Quelle der Wahrheit für
  denselben Settings-Wert zu schaffen.

**Frontend** — neue Sektion **innerhalb** von `ModelLabTab` (nicht neuer Top-Level-Tab, Inspector bleibt
unverändert nicht-tabbed):
- `ModelLabTab.sections.tsx`: neue "Rollen & Routing"-Sektion, flache Tabelle (Bundle | Health | aktuelle
  Settings-Zuordnung inkl. Konfliktanzeige bei doppelter Zuordnung | Taxonomie-Dropdown | Residency-Auswahl |
  "Jetzt starten"-Aktion über den bestehenden `runtimeSlotManager`).
- `ModelLabTab.rows.tsx`: neue Zeilenkomponente nach dem bestehenden Action-Summary-Sortiermuster aus
  `RuntimeModelsTab.rows.tsx`.
- `ModelLabTab.controller.ts`: Fetch/Mutate für Rollenzuordnungen.
- `packages/shared/src/index.ts`: `ModelRoleAssignment`-Typen neben den bestehenden `ModelLab*`-Typen spiegeln.

**Verifikation:** `test_model_lab_repository.py` — CRUD-Tests (Upsert, FK-Cascade, unbekannte bundle_id →
`ValueError`, passend zu bestehenden Testmustern). Neue/erweiterte `ModelLabTab.sections.test.ts`. Manuell:
InternScience auf `taxonomy_role=orchestrator` + `settings_field=defaultOrchestratorModelId` zuordnen,
Konfliktanzeige bei doppelter Zuordnung prüfen.

### Phase 4 — RAM-Prozentschwellen-Schutz

**Design:** 4 Stufen, geprüft innerhalb des bestehenden `RuntimeService.sweep_idle_slots()`
(`service.py:1933`), wiederverwendet das bereits bewährte `psutil`-Muster aus `multi_server_manager.py:51-57`
(vor Phase-Start per `Grep psutil backend/pyproject.toml backend/requirements*.txt` bestätigen, dass `psutil`
schon Abhängigkeit ist):
- `< 80%`: keine Aktion.
- `80–85%`: Warnung auf den Residency-Eintrag taggen (sichtbar in Phase 6s Health-Historie), kein Evict.
- `85–90%`: `IDLE_EVICT`-Slots sofort evicten, unabhängig vom individuellen Idle-Timer.
- `90–95%`: zusätzlich den am längsten ungenutzten `KEEP_RESIDENT`-Slot evicten (nie mitten in einer Anfrage —
  bestehendes `wait_for_slot_drain`-Muster aus `gpu_exclusivity.py:32-49` verallgemeinern).
- `≥ 95%`: alle idle Slots evicten außer einem konfigurierbaren "immer an"-Floor-Slot (Default `orchestrator_cpu`,
  kleinster CPU-Fußabdruck) — nie alles gleichzeitig leeren, um Flapping zu vermeiden.

- `backend/app/runtime/residency.py`: `RamPressureTier`-Literal, `classify_ram_pressure(percent_used)` als
  reine, leicht testbare Funktion.
- `backend/app/runtime/service.py`: `_ram_pressure_sweep()`, aufgerufen aus `sweep_idle_slots()`, nutzt
  bestehende `stop_model_for_slot()`/Residency-Primitive — kein neuer Stop-Mechanismus.
- `backend/app/api/runtime.py`: leichter `GET /runtime/system/ram-pressure`-Diagnose-Endpunkt für
  `RuntimeSlotPanel.tsx`.

**Verifikation:** neue Unit-Tests für `classify_ram_pressure()`-Grenzwerte (79.9/80/84.9/85/89.9/90/94.9/95/100)
plus Integrationstest mit gemocktem `psutil.virtual_memory()` pro Stufe. Manuell: **nicht sandbox-verifizierbar**
(reale 90%+ RAM-Auslastung nicht reproduzierbar) — als offen für eine echte Session vermerken.

### Phase 5 — Dual-Mode Vision für InternScience_Agents-A1-4B (schwierigste Phase, bewusst zuletzt)

**Ziel:** `orchestrator_cpu` läuft InternScience text-only, CPU-resident, ohne MMProj (das ist durch Korrektur 3
oben bereits automatisch der Fall). Bei echtem Bildbedarf startet eine **separate**, MMProj-geladene Instanz auf
`vision_gpu` (bestehende GPU-Exklusivität mit `fast_gpu` greift automatisch), ohne `orchestrator_cpu`s Residency
zu stören.

- `backend/app/runtime/schemas.py`: `StartModelRequest` um `projector_artifact_id: str | None = None` erweitern
  (serverseitig über `ModelLabRepository`/Katalog aufgelöst — nie einen client-gelieferten Dateisystempfad
  direkt vertrauen).
- `backend/app/api/runtime.py`: Start-Endpunkte lösen `projector_artifact_id` zu einem absoluten Pfad auf und
  reichen `config["mmproj_path"]` an `service.start_model(..., config=config)` durch — die eigentliche
  `--mmproj`-Flag-Logik existiert in `launch.py:361-363` bereits und funktioniert, es fehlt nur die
  Verdrahtung der Anfrage dorthin.
- `backend/app/runtime/service.py`: bestätigen (Regressionstest), dass der `orchestrator_cpu`-Sonderfall
  (Zeilen 948-955) bei einem `vision_gpu`-Start für dasselbe Modell **nicht** greift — beide Slots haben
  getrennte Residency-Einträge.
- `backend/app/runtime/resource_planner.py`: MMProj-VRAM-Kosten (0.626 GiB für InternScience) fließen bisher
  nirgends in die GPU-Layer-Berechnung ein — `plan()` bekommt einen optionalen `mmproj_bytes`-Parameter, der ins
  VRAM-Budget einfließt, damit die 15%-Sicherheitsreserve nicht durch die ignorierte Projector-Größe unterlaufen wird.
- `apps/desktop/src/services/modelSelectionBroker.ts`: das bestehende `requiresVisionSlot`-Gate (Zeile ~837) ist
  für die "keine Bild-Anfrage → keine Zwangsverlagerung auf vision_gpu"-Hälfte bereits korrekt (verifiziert,
  kein Eingriff nötig). Echter Änderungsbedarf: wenn eine Vision-Aufgabe auf InternScience aufgelöst wird UND
  dieses Modell zugleich als `defaultOrchestratorModelId` konfiguriert/resident ist, muss die
  `projector_artifact_id` der zugehörigen `MultimodalPair` beim `vision_gpu`-Start mitgegeben werden — neues
  optionales `projectorArtifactId`-Feld von der Broker-Entscheidung bis zu
  `runtimeSlotManager.startSlot(slotId, modelId, { projectorArtifactId })` durchreichen.
- `apps/desktop/src/services/runtimeSlotManager.ts`: `startSlot()` reicht `projectorArtifactId` im Request-Body
  weiter.

**Verifikation:** `test_runtime_service.py` — `vision_gpu`-Start mit `mmproj_path` erzeugt Kommando mit
`--mmproj`; `orchestrator_cpu`-Residency bleibt bei parallelem `vision_gpu`-Start desselben Modells unberührt.
`resource_planner.py`-Test: MMProj-Bytes reduzieren die gewählten GPU-Layer gegenüber dem Plan ohne MMProj, auf
simuliertem 4 GB-Kartenmodell. `modelSelectionBroker.test.ts`: Vision-Aufgabe → `projectorArtifactId` gesetzt;
Text-Aufgabe über `defaultOrchestratorModelId` → `requiresVisionSlot`/`projectorArtifactId` bleiben unberührt
(Regressionswächter). Manuell (nicht sandbox-verifizierbar): echte Session, `orchestrator_cpu` mit InternScience
starten, Vision-Aufgabe auslösen, bestätigen dass zwei unabhängige llama-server-Prozesse laufen und
`orchestrator_cpu` währenddessen weiter Text-Anfragen beantwortet.

**Vor Implementierung zu prüfen:** ob der bereits gelesene `MultimodalPair`-Typ auch für scan-abgeleitete (nicht
nur manuell gepaarte) Einträge ein `projector_artifact_id`-Feld befüllt; ob `ModelLabRepository` bereits einen
Einzel-Artefakt-Lookup hat oder einer ergänzt werden muss.

### Phase 6 — Persistente Health-/Failure-Historie

- Neue kleine Tabelle in Model Labs bestehender SQLite (gleicher DB-Datei-Ansatz wie Phase 3, kein zweites DB-File):
```sql
CREATE TABLE IF NOT EXISTS runtime_slot_health_events (
    id TEXT PRIMARY KEY,
    slot_id TEXT NOT NULL,
    model_id TEXT,
    event_type TEXT NOT NULL,   -- start | stop | crash | restart_attempt | budget_exhausted | oom
    detail TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_health_events_slot ON runtime_slot_health_events(slot_id, occurred_at);
```
Begrenzte Aufbewahrung (z. B. letzte 200 Events pro Slot, Pruning beim Insert).
- `repository.py`: `record_health_event`/`list_health_events`.
- `api/runtime.py`: `POST`/`GET /runtime/slots/{slot_id}/health-events`.
- `apps/desktop/src/services/runtimeProcessSupervisor.ts`: bei jedem Restart-Versuch/Budget-Erschöpfung
  zusätzlich (fire-and-forget, fehler-tolerant) an den neuen Endpunkt posten — bestehende In-Memory-Logik bleibt
  unverändert die schnelle lokale Quelle der Wahrheit, das Backend-Posting ist rein additiv.
- `apps/desktop/src/components/RuntimeSlotPanel.tsx`: neue ausklappbare "Verlauf"-Sektion pro Slot.

**Verifikation:** `test_model_lab_repository.py` — Insert/Pruning/Sortierung. `runtimeProcessSupervisor.test.ts`
— Posting bei Restart/Budget-Erschöpfung, Post-Fehler bricht die bestehende In-Memory-Logik nicht.
`RuntimeSlotPanel.test.tsx` — neue Verlaufs-Sektion rendert.

### Phase 7 — Zertifizierung/Benchmarks an Model-Lab-Bundle-IDs anbinden

**Design:** reine ID-Auflösung, keine Neuarchitektur — `IndexedModel.id` ist ein Hash des aufgelösten Pfads,
Model Labs `bundle.primary_artifact_id` löst über `ModelLabRepository` zu einem bekannten Artefakt-Pfad auf:

```python
def resolve_bundle_to_model_id(bundle_id, *, model_lab_repo, model_index) -> str | None:
    bundle = model_lab_repo.get_model(bundle_id)
    if not bundle or not bundle.bundle.primary_artifact_id:
        return None
    primary = next((a for a in bundle.artifacts if a.artifact_id == bundle.bundle.primary_artifact_id), None)
    if not primary:
        return None
    target_path = str(Path(primary.path).resolve())
    match = next((m for m in model_index.models if str(Path(m.path).resolve()) == target_path), None)
    return match.id if match else None
```
- Neuer Ort: `backend/app/models/model_lab_bridge.py` (bündelt die Join-Point-Logik an einer Stelle).
- `backend/app/api/model_profiles.py`: `POST /model-profiles/certification/runs` und `.../benchmark` bekommen
  ein optionales `bundle_id`-Feld; bei aktivem Bridge-Schalter (Phase 2) wird darüber aufgelöst, sonst klarer
  400-Fehler statt stillem Fehlschlag.
- `backend/app/context/certification.py`: `CertificationReport` bekommt optionales `bundle_id`-Feld.
- `backend/app/model_lab/repository.py`: denormalisierte Cache-Spalten auf der bestehenden
  `model_role_assignments`-Zeile (`last_certification_run_id`, `last_certification_score`,
  `last_benchmark_run_id`) statt eines JSON-Datei-Scans bei jeder Anzeige.
- `api/model_lab.py`: `GET /model-lab/models/{bundle_id}` liefert die Cache-Felder mit.
- Frontend: Zertifizierungs-Badge in `ModelLabTab.rows.tsx`/Inspector, gleiches Muster wie das bestehende
  "Ungetestet (GPU)"-Badge (`modelUtils.ts::describeExclusionReason()`).

**Verifikation:** Tests für Bundle-Auflösung (Erfolg/Fehlschlag/Bridge-deaktiviert), Cache-Spalten-Update-Tests.
Manuell: Zertifizierung gegen InternScience per `bundle_id` laufen lassen, Badge-Update in `ModelLabTab` prüfen.

### Phase 8 — Hardware-geprüfter Residency-Plan für alle 13 Modelle (reine Konfiguration, kein neuer Code über Phase 3 hinaus)

Sanity-Check der ursprünglichen Plan-Annahme "3 Modelle gleichzeitig HOT" gegen echte Slot-Mechanik: die
korrekte Aussage ist **höchstens 1 Modell gleichzeitig auf der GPU** (`fast_gpu` XOR `vision_gpu`, durch
GPU-Exklusivität erzwungen), plus beliebig viele CPU-resident laufende Modelle, begrenzt nur durch die 32 GB
RAM (großzügig — InternScience 2.7 GB + ein `utility`-Modell 1 GB + Overhead passt bequem).

Empfohlene Default-Zuordnung (über Phase 3s UI vom Nutzer überschreibbar, nicht hart codiert):
- `fast_gpu`: QwenPaw-Flash-2B (1.45 GiB) `KEEP_RESIDENT` — passt komfortabel in 4 GB VRAM mit KV-Cache-Puffer.
- `orchestrator_cpu`: InternScience_Agents-A1-4B text-only `KEEP_RESIDENT` (0 VRAM-Kosten durch Korrektur 3) —
  Alternative MiniCPM5-1B für schnellere Orchestrierung, beide Optionen in der UI anbietbar.
- `utility`: MiniCPM5-1B oder DeepCoder-1.5B/DeepScaleR-1.5B als `IDLE_EVICT`-Kandidaten.
- `vision_gpu`: InternScience+MMProj (3.31 GiB gesamt), zwingend `IDLE_EVICT` (Zeitteilung mit `fast_gpu`).
- Rein experimentell/manuell (`residency_intent=manual`): VibeThinker-Fable-Nano, llama-3.2-1b-mini-agent,
  Qwen7B-SmartHome-Agent, Merlin-Agent (keine README — vor jeder Residency-Empfehlung erst über Phase 7
  zertifizieren), AgentCPM-Report.

**Verifikation:** kein neuer automatisierter Test — Phase 3s UI zeigt nach dem Scan sinnvolle Default-Werte
(`IDLE_EVICT` wenn `vision`-Capability, `MANUAL` wenn Health `UNSUPPORTED`/`BROKEN`/keine Doku, sonst
`IDLE_EVICT`, nie automatisch `KEEP_RESIDENT` ohne explizite Nutzeraktion), vom Nutzer überprüft/überschrieben.

## Kritische Dateien

- `backend/app/model_lab/scanner.py` — Phase 0 (verifizierter Adapter-Bug)
- `backend/app/models/index_service.py`, `backend/app/models/model_lab_bridge.py` — Phase 2 (Bridge-Aktivierung), Phase 7 (Bundle→Model-ID-Auflösung)
- `backend/app/model_lab/repository.py` — Phase 3/6/7 (neue kleine Tabellen/Cache-Spalten)
- `backend/app/runtime/service.py`, `backend/app/runtime/schemas.py`, `backend/app/runtime/resource_planner.py`, `backend/app/runtime/residency.py` — Phase 4/5
- `apps/desktop/src/services/modelSelectionBroker.ts`, `apps/desktop/src/services/runtimeSlotManager.ts` — Phase 5
- `apps/desktop/src/components/notebook/ModelLabTab.sections.tsx`/`.rows.tsx`/`.controller.ts` — Phase 3/7
- `apps/desktop/src/services/runtimeProcessSupervisor.ts`, `apps/desktop/src/components/RuntimeSlotPanel.tsx` — Phase 6

## Verifikationshinweis

Dieses Repo hat eine dokumentierte Sandbox-Einschränkung: von Claude-Code-Sessions gestartete
Hintergrundprozesse (Backend + Electron) überleben typischerweise nur 2-3 Minuten. Phasen 4 und 5 enthalten
Verhalten (reale RAM-Drucksituationen, zwei parallel laufende llama-server-Prozesse mit echtem Modellwechsel),
das in dieser Sandbox nicht end-to-end reproduzierbar ist — diese Punkte werden pro Phase explizit als "manuell
in einer echten Session zu bestätigen" markiert statt fälschlich als automatisiert verifiziert zu gelten. Jede
Phase bekommt trotzdem echte, automatisierte Unit-/Integrationstests für den Teil, der sich sandboxsicher testen
lässt (reine Funktionen, gemockte Prozess-/Systemaufrufe, bestehende Test-Fixtures).
