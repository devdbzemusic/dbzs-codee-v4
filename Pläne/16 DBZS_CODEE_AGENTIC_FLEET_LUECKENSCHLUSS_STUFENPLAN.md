# DBZS Codee – Stufenplan zum Schließen der Plan-15-Lücken

**Stand:** 02.08.2026
**Basis:** direkte Code-Verifikation der Phasen 0–8 aus `15 models-agentic-plane-implementierung-golden-ripple.md` (nicht nur die Dokubehauptung).

## 0. Ausgangslage

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Scanner-Bug: LoRA-Adapter-Klassifizierung | ✅ erledigt |
| 2 | Model-Lab-Bridge-Schalter, Scan-Deckel | ✅ erledigt |
| 3 | Rollen & Routing: Tabelle + UI | ✅ erledigt |
| 4 | RAM-Prozentschwellen-Schutz | ✅ erledigt |
| 1 | Quelle registrieren & Scan verifizieren | ⏳ offen (reine Verifikation) |
| 6 | Persistente Health-/Failure-Historie | ✅ erledigt |
| 7 | Zertifizierung/Benchmark an Bundle-IDs | ✅ erledigt |
| 8 | Hardware-geprüfte Residency-Defaults | ✅ erledigt |
| 5 | Dual-Mode Vision (InternScience) | ✅ erledigt |

Dieser Plan schließt die fünf offenen Punkte (1, 6, 7, 8, 5) in einer Reihenfolge, die Abhängigkeiten und Risiko berücksichtigt.

## 1. Reihenfolge und Begründung

```text
Stufe 1: Phase 1 – Quelle & Scan verifizieren   (Sanity-Check, kein Code)
Stufe 2: Phase 6 – Health-/Failure-Historie     (unabhängig, mittlerer Aufwand)
Stufe 3: Phase 7 – Zertifizierung an Bundle-IDs (baut auf Phase 3s Tabelle)
Stufe 4: Phase 8 – Residency-Defaults           (profitiert von Phase 7s Zertifikaten)
Stufe 5: Phase 5 – Dual-Mode Vision             (höchstes Risiko, zuletzt)
Stufe 6: Abschlussverifikation
```

Phase 1 zuerst, weil sie kostenlos ist und bestätigt, dass die bereits gemergten Fixes (0/2/3/4) mit den echten 13 Modellen tatsächlich funktionieren, bevor weiter draufgebaut wird. Phase 6 und 7 sind voneinander unabhängig und berühren keine der riskanten Runtime-Startpfade – daher vor Phase 5. Phase 8 ist reine UI-Konfiguration, die von Phase 7s Zertifizierungsstatus profitiert (Default-Vorschlag „MANUAL bei fehlendem Zertifikat"). Phase 5 zuletzt, wie im Ursprungsplan empfohlen: sie ist die einzige Phase, die zwei parallel laufende `llama-server`-Prozesse und echten Modellwechsel voraussetzt, und profitiert davon, dass Phase 3s UI und Phase 7s Zertifizierung schon stehen, um sie End-zu-Ende zu verifizieren.

---

## Stufe 1 – Phase 1: Quelle registrieren & Scan verifizieren

**Aufwand:** ~15 Minuten, kein neuer Code.
**Voraussetzung:** laufendes Backend, echte Session (nicht in dieser Sandbox durchführbar).

1. `POST /model-lab/sources` mit Pfad `D:\Models\Agentic`, `recursive: true`.
2. `POST /model-lab/scan` auslösen.
3. `GET /model-lab/models` prüfen: 13 Basis-Bundles, InternScience mit `modalities: ["image"]` und Projector-Evidenz, beide Adapter-Dateien korrekt als `artifact_type="adapter"` bzw. als separates `INCOMPLETE`-Bundle (Unterordner-Fall) behandelt.
4. `GET /model-lab/hardware` prüfen: 4 GB VRAM / 32 GB RAM korrekt erkannt (wird in Stufe 4 gebraucht).

**Abnahme:** jede Abweichung von obiger Erwartung ist ein Regressions-Bug in Phase 0/1/2, keine neue Aufgabe – zurück auf die entsprechende Phase, nicht weitermachen.

---

## Stufe 2 – Phase 6: Persistente Health-/Failure-Historie

**Ziel:** Runtime-Slot-Ereignisse (Start/Stop/Crash/Restart/OOM) überleben einen App-Neustart und sind pro Slot einsehbar.

**Vorprüfung (bereits gemacht):** `backend/app/model_lab/repository.py` hat bereits eine `model_failures`-Tabelle mit `record_failure()`/`list_failures()` – aber sie ist an `bundle_id`+`operation` (Scan/Probe/Benchmark-Fehler) gebunden, nicht an `slot_id`+`event_type` (Start/Stop/Crash laufender Prozesse). Für Phase 6 wird deshalb eine **eigene** Tabelle angelegt statt `model_failures` zu überladen.

**Schema** (gleiche SQLite-Datei wie `model_role_assignments`, kein zweites DB-File):

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

Begrenzte Aufbewahrung: letzte 200 Events pro Slot, Pruning beim Insert (gleiches Muster wie die Log-Caps in `bootOrchestrator.ts`).

**Schritte:**

1. `backend/app/model_lab/repository.py`: Tabelle in der bestehenden Migration ergänzen, `record_health_event()`/`list_health_events()`.
2. `backend/app/api/runtime.py`: `POST`/`GET /runtime/slots/{slot_id}/health-events`.
3. `apps/desktop/src/services/runtimeProcessSupervisor.ts`: bei jedem Restart-Versuch/Budget-Erschöpfung zusätzlich (fire-and-forget, fehlertolerant) an den neuen Endpunkt posten. Bestehende In-Memory-Logik (`getSlotHealthState`) bleibt unverändert die schnelle lokale Quelle – das Backend-Posting ist rein additiv.
4. `apps/desktop/src/components/RuntimeSlotPanel.tsx`: neue ausklappbare „Verlauf"-Sektion pro Slot, die den neuen Endpunkt abfragt.

**Tests:** `test_model_lab_repository.py` (Insert/Pruning/Sortierung), `runtimeProcessSupervisor.test.ts` (Posting bei Restart/Budget-Erschöpfung, Post-Fehler bricht die bestehende In-Memory-Logik nicht), `RuntimeSlotPanel.test.tsx` (Verlaufs-Sektion rendert).

**Abnahme:** Slot-Crash + Neustart erzeugt einen sichtbaren Eintrag in der „Verlauf"-Sektion, der einen App-Neustart übersteht.

---

## Stufe 3 – Phase 7: Zertifizierung/Benchmarks an Model-Lab-Bundle-IDs anbinden

**Ziel:** Zertifizierung/Benchmark laufen gegen `bundle_id` statt der alten, getrennten `IndexedModel.id`-Welt.

**Vorprüfung (bereits gemacht):** `backend/app/models/model_lab_bridge.py` existiert bereits – aber das ist die Phase-2-Bridge (`additional_scan_roots()`, `enrich_with_model_lab_health()`, laut eigenem Docstring „Plan 14, Phase 0.2"). Die hier verlangte `resolve_bundle_to_model_id()` fehlt komplett und muss **in derselben Datei ergänzt** werden (thematisch passend, kein zweites Bridge-Modul).

**Schritte:**

1. `backend/app/models/model_lab_bridge.py`: neue Funktion

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

2. `backend/app/api/model_profiles.py`: `POST /model-profiles/certification/runs` und `.../benchmark` bekommen ein optionales `bundle_id`-Feld; bei aktivem Bridge-Schalter (Phase 2) wird darüber aufgelöst, sonst klarer 400-Fehler statt stillem Fehlschlag.
3. `backend/app/context/certification.py`: `CertificationReport` bekommt optionales `bundle_id`-Feld.
4. `backend/app/model_lab/repository.py`: denormalisierte Cache-Spalten auf der bestehenden `model_role_assignments`-Zeile (`last_certification_run_id`, `last_certification_score`, `last_benchmark_run_id`) über das bereits vorhandene `_ensure_column()`-Muster (siehe `settings_field`/`residency_intent` an Zeile ~299) statt eines JSON-Datei-Scans bei jeder Anzeige.
5. `backend/app/api/model_lab.py`: `GET /model-lab/models/{bundle_id}` liefert die Cache-Felder mit.
6. Frontend: Zertifizierungs-Badge in `ModelLabTab.rows.tsx`/Inspector, gleiches Muster wie das bestehende „Ungetestet (GPU)"-Badge (`modelUtils.ts::describeExclusionReason()`).

**Tests:** Tests für Bundle-Auflösung (Erfolg/Fehlschlag/Bridge-deaktiviert), Cache-Spalten-Update-Tests.

**Abnahme:** Zertifizierung gegen InternScience per `bundle_id` laufen lassen, Badge-Update in `ModelLabTab` sichtbar.

---

## Stufe 4 – Phase 8: Hardware-geprüfter Residency-Plan (reine Konfiguration)

**Ziel:** nach dem Scan sinnvolle Default-Werte für alle 13 Modelle vorschlagen, vom Nutzer überschreibbar.

Kein neuer Code über Phase 3 hinaus – die „Rollen & Routing"-Sektion aus Phase 3 bekommt eine Vorschlagslogik:

- `IDLE_EVICT`, wenn `vision`-Capability gesetzt ist (Zeitteilung mit `fast_gpu`).
- `MANUAL`, wenn Health `UNSUPPORTED`/`BROKEN` ist oder (seit Stufe 3) kein Zertifikat vorliegt.
- sonst `IDLE_EVICT`, **nie automatisch `KEEP_RESIDENT`** ohne explizite Nutzeraktion.

Empfohlene Start-Zuordnung als Vorbelegung: `fast_gpu` → QwenPaw-Flash-2B, `orchestrator_cpu` → InternScience_Agents-A1-4B (text-only), `utility` → MiniCPM5-1B, `vision_gpu` → InternScience+MMProj (erst nach Stufe 5 nutzbar).

**Abnahme:** kein neuer automatisierter Test – nach einem echten Scan zeigt die UI die oben beschriebene Standardbelegung, vom Nutzer überprüft.

---

## Stufe 5 – Phase 5: Dual-Mode Vision für InternScience_Agents-A1-4B

**Ziel:** `orchestrator_cpu` läuft InternScience dauerhaft text-only, CPU-resident, ohne MMProj. Bei echtem Bildbedarf startet eine **separate**, MMProj-geladene Instanz auf `vision_gpu`, ohne die Text-Instanz zu stören.

**Bereits verifiziert vorhanden (keine Arbeit nötig):**
- `orchestrator_cpu` ist in `runtime/service.py:948-955` bereits hart auf `n_gpu_layers=0` gepinnt → InternScience braucht dort keine GPU-Exklusivität.
- `requiresVisionSlot`-Gate in `modelSelectionBroker.ts` (Zeile ~837) route korrekt auf `vision_gpu`, wenn Vision gebraucht wird.
- `--mmproj`-Flag-Logik existiert bereits in `launch.py:361-363` und funktioniert – es fehlt nur die Verdrahtung der Anfrage dorthin.

**Konkrete Schritte:**

1. `backend/app/runtime/schemas.py`: `StartModelRequest` um `projector_artifact_id: str | None = None` erweitern (serverseitig über `ModelLabRepository` aufgelöst – nie einen client-gelieferten Dateisystempfad direkt vertrauen).
2. `backend/app/api/runtime.py`: Start-Endpunkt löst `projector_artifact_id` zu einem absoluten Pfad auf und reicht `config["mmproj_path"]` an `service.start_model(..., config=config)` durch.
3. `backend/app/runtime/service.py`: Regressionstest, dass der `orchestrator_cpu`-Sonderfall bei einem parallelen `vision_gpu`-Start desselben Modells **nicht** greift – beide Slots haben getrennte Residency-Einträge.
4. `backend/app/runtime/resource_planner.py`: `plan()` bekommt einen optionalen `mmproj_bytes`-Parameter (0.626 GiB für InternScience), der ins VRAM-Budget einfließt, damit die Sicherheitsreserve nicht durch die ignorierte Projector-Größe unterlaufen wird.
5. `apps/desktop/src/services/modelSelectionBroker.ts`: wenn eine Vision-Aufgabe auf InternScience aufgelöst wird UND dieses Modell zugleich `defaultOrchestratorModelId` ist, die `projector_artifact_id` der zugehörigen `MultimodalPair` bis zum Broker-Ergebnis durchreichen (neues optionales `projectorArtifactId`-Feld).
6. `apps/desktop/src/services/runtimeSlotManager.ts`: `startSlot(slotId, modelId, profile?)` (aktuelle Signatur, Zeile 289) um einen optionalen vierten Parameter bzw. ein Options-Objekt erweitern, das `projectorArtifactId` in den POST-Body (`/runtime/slots/{slotId}/start`) mitgibt.

**Vor Implementierung zu prüfen:** ob `MultimodalPair` auch für scan-abgeleitete (nicht nur manuell gepaarte) Einträge ein `projector_artifact_id`-Feld befüllt; ob `ModelLabRepository` bereits einen Einzel-Artefakt-Lookup hat oder einer ergänzt werden muss.

**Tests:** `test_runtime_service.py` (`vision_gpu`-Start mit `mmproj_path` erzeugt Kommando mit `--mmproj`; `orchestrator_cpu`-Residency bleibt unberührt), `resource_planner`-Test (MMProj-Bytes reduzieren gewählte GPU-Layer auf simuliertem 4-GB-Kartenmodell), `modelSelectionBroker.test.ts` (Vision-Aufgabe → `projectorArtifactId` gesetzt; Text-Aufgabe über `defaultOrchestratorModelId` bleibt unberührt).

**Manuell, nicht sandbox-verifizierbar:** echte Session, `orchestrator_cpu` mit InternScience starten, Vision-Aufgabe auslösen, bestätigen dass zwei unabhängige `llama-server`-Prozesse laufen und `orchestrator_cpu` währenddessen weiter Text-Anfragen beantwortet.

---

## Stufe 6 – Abschlussverifikation

1. `cd apps/desktop && pnpm typecheck` (tsconfig.node.json + tsconfig.web.json) – muss fehlerfrei sein.
2. `cd backend && uv run pytest -q` – alle neuen und bestehenden Tests grün.
3. `cd apps/desktop && pnpm test` – alle neuen und bestehenden Vitest-Suiten grün.
4. Echte Session: Stufe 1 (Scan), Stufe 2 (Slot-Crash provozieren → Verlauf prüfen), Stufe 3 (Zertifizierung per `bundle_id`), Stufe 5 (paralleler Vision-Start) jeweils manuell durchspielen.
5. Dieses Dokument mit dem tatsächlichen Ergebnis pro Stufe aktualisieren (Status-Spalte in Abschnitt 0).

## Aufwands-/Risikoübersicht

| Stufe | Aufwand | Risiko | Abhängig von |
|---|---|---|---|
| 1 – Verifikation | sehr klein | keins | Phase 0/2/3/4 (bereits erledigt) |
| 2 – Health-Historie | mittel | klein (rein additiv) | – |
| 3 – Zertifizierung/Bundle-IDs | mittel–hoch | klein–mittel | Phase 3-Tabelle, Phase-2-Bridge |
| 4 – Residency-Defaults | klein | keins | Stufe 3 (für Zertifikats-Default) |
| 5 – Dual-Mode Vision | hoch | am höchsten (neue Request-Kette, zwei parallele Prozesse) | Stufe 3 UI, Stufe 3 Zertifizierung zur Verifikation |
| 6 – Abschlussverifikation | klein | keins | alle vorherigen Stufen |

**Klare Empfehlung:** nicht mit Stufe 5 beginnen, auch wenn sie inhaltlich am interessantesten ist. Erst Stufe 1–4 abschließen, damit eine stabile, verifizierte Basis existiert, bevor die riskanteste Arbeit (Dual-Mode Vision) angegangen wird.
