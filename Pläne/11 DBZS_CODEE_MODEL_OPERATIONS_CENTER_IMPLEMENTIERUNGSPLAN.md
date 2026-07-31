# DBZS Codee Model Operations Center — Implementierungsplan

**Basis:** `DBZS_Codee_Model_Operations_Center_Entwurf.md` (22 Abschnitte, WinUI3-Entwurf)
**Stand:** 2026-07-31
**Status:** Planungsdokument — noch keine Umsetzung begonnen

---

## 1. Entscheidungsprotokoll

Der ursprüngliche Entwurf schlägt eine eigenständige WinUI3/C#/.NET-Anwendung vor, die über REST/SSE
dasselbe FastAPI-Backend wie Codee anspricht — technisch getrennt vom bestehenden Electron/React-Frontend,
mit eigenem Build- und Release-Prozess.

**Entscheidung:** Kein zweiter Frontend-Stack. Das Model Operations Center wird als Erweiterung der
bestehenden Electron/React-Anwendung geplant.

**Begründung:**
- Ein Frontend-Stack statt zwei — kein zusätzliches Build-/Signing-/Update-System, keine zweite Menge an
  Plattform-Eigenheiten zu pflegen.
- Direkte Wiederverwendung bestehender, bereits modularisierter UI-Patterns (siehe Abschnitt 2).
- Die Backend-Seite (FastAPI, SQLite, Job-Queue, Runtime-Adapter) bleibt ohnehin identisch zum Entwurf —
  nur die Präsentationsschicht ändert sich.
- Alle im Entwurf beschriebenen UI-Bereiche (Dashboard, Model Library, Scanner, Model Inspector,
  Benchmark Lab, Runtime Tuner, Certification Center, Jobs & Logs) sind eins-zu-eins als React-Ansichten
  abbildbar.

---

## 2. Wiederverwendungs-Tabelle

Ein großer Teil dessen, was der Entwurf als "neu zu bauen" beschreibt, existiert im Repository bereits in
einfacherer Form. Diese Tabelle ist die verbindliche Referenz dafür, was **erweitert** statt neu geschrieben
wird — sie sollte vor jeder neuen Phase erneut geprüft werden, da sich der Code seit diesem Planungsstand
weiterentwickeln kann.

| Entwurf verlangt | Existiert bereits als | Datei |
| --- | --- | --- |
| Rekursiver Scanner, Artefakttyp-/Modalitäts-/Quantisierungs-Erkennung | `_infer_artifact_type`, `_infer_capabilities`, `_infer_modality`, `_infer_quantization`, GGUF-Header-Validierung | `backend/app/models/index_service.py` (1456 Zeilen) |
| Bundle-/Komponentenerkennung (Base + Tokenizer + MMProj + …) | `_infer_multimodal_pairs`, `MultimodalPair`-Schema, manuelle Pairing-Verwaltung — bisher nur für Vision-Projektoren, nicht generisch | `backend/app/models/index_service.py`, `schemas.py` |
| Hardware-Inventar (CPU/GPU/RAM) | GPU-Erkennung, Hardware-Fingerprint | `backend/app/runtime/gpu_detect.py`, `hardware_fingerprint.py` |
| Benchmark-System | Existiert, aber nur 5 feste Wortzahl-Prompts, ein Profil, keine Historie, kein Vergleich | `backend/app/runtime/benchmark.py` |
| Runtime-Testprobe / Ladeverifikation | Modell-Ladbarkeitstest, Resource-Planung | `backend/app/runtime/model_test.py`, `resource_planner.py` |
| Datenbank + Migrations-Infrastruktur | `sqlite_connection()`-Context-Manager + `MigrationManager` mit nummerierten `migration_00N_*`-Funktionen, `run_all_migrations()` — **direkt wiederverwendbar**, keine zweite DB-Schicht nötig | `backend/app/core/sqlite.py`, `migrations.py` |
| Model-Registry-Schema | `IndexedModel` (id, artifact_type, capabilities, modality, quantization, compatibility, recommended_use) — **fehlt:** SHA-256-Identität, Confidence/Evidence pro Capability, Zertifizierungsstatus | `backend/app/models/schemas.py` |
| Vorbild für ein zweites Migrations-Framework | Settings-Migrationen (dict-basiert, anderes Muster als `core/migrations.py`, aber als Präzedenzfall relevant) | `backend/app/settings/migrations.py` |
| Event-/Job-Fortschritt (für Scan-/Benchmark-Events) | Job-Spooler mit Status-Events | `backend/app/job_spooler/` |
| UI-Tab-Modularisierung (Vorbild für "Model Lab"-Tab) | `controller.ts` / `sections.tsx` / `rows.tsx` / `primitives.tsx` / `pairing.tsx` — genau das Muster, dem die neue Tab-Familie folgen sollte | `apps/desktop/src/components/notebook/RuntimeModelsTab.*` |

**Klar neu (existiert noch gar nicht):**
- SHA-256-basierte Artefakt-/Bundle-Identität (`artifact_id`, `bundle_id`, `installation_id` getrennt von
  Pfad und Modellname).
- Web-Enrichment (Hugging Face API, GitHub, Ollama Library, Quellen-Vertrauensbewertung).
- Mehrstufige, generische Capability-Erkennung mit Confidence-Score und Evidence-Liste.
- Strukturierte Benchmark-Szenarien pro Modalität (Chat/Coding/Reasoning/Vision/Embedding/Audio/Diffusion).
- Zertifizierungs-Statuskette und Scoring (`DISCOVERED` → … → `CERTIFIED_FOR_CODEE`).
- Automatische Runtime-Profil-Generierung aus Benchmark-Ergebnissen.
- Duplikat-/Varianten-Analyse, Speicheroptimierungsvorschläge.

---

## 3. Vollständiger Phasenfahrplan

Angepasst von Entwurf-Abschnitt 18 — WinUI durch die bestehende React-App ersetzt, jede Phase referenziert
die Wiederverwendungs-Tabelle statt bei null zu beginnen.

### Phase 1 — Inventory MVP
- Neues Backend-Modul `backend/app/model_lab/` (Registry, Identität, Scanner-Wrapper, API).
- Neue Tab-Familie `ModelLabTab.*` im bestehenden Notebook, nach dem `RuntimeModelsTab`-Muster.
- SHA-256-Artefaktidentität, generische Bundle-Erkennung (nicht nur Vision).
- Rückschreiben nach `IndexedModel` bleibt additiv — keine Breaking Changes am laufenden Model-Index.
- Siehe Abschnitt 4 für die volle Ausarbeitung.

### Phase 2 — Capability & Enrichment
- Vierstufige Capability-Erkennung (statische Metadaten → Regeln → Runtime-Probe → Confidence-Score) als
  eigenständiges `capability_detection/`-Untermodul, das die bestehenden `_infer_*`-Funktionen aus
  `index_service.py` als Stufe-1-Quelle konsumiert statt sie zu duplizieren.
- Hugging-Face-Anbindung zuerst (höchster Datennutzen, offizielle API), GitHub/Ollama-Library/Web-Suche
  danach in dieser Reihenfolge.
- Quellen-Vertrauensbewertung + Pflichtfelder pro externem Wert (Quelle, Abrufzeit, Vertrauensscore,
  Feldstatus) — nie lokale Daten überschreiben, nur ergänzen.
- Lizenzdaten-Erfassung, Dubletten-/Variantenprüfung über die SHA-256-Identität aus Phase 1.

### Phase 3 — Benchmark Core
- Hardwareprofil-Persistierung (aufbauend auf `gpu_detect.py`/`hardware_fingerprint.py`, bisher nur
  Laufzeitwerte, keine Historie).
- `benchmark.py` zu einem `benchmark/coordinator.py` mit Szenario-Bibliothek ausbauen (CPU/GPU/Hybrid/
  Eco/Max-Profile statt einem einzelnen Lauf), erste Adapter-Erweiterung bleibt llama.cpp-only.
- Lade-/Inferenz-/Ressourcen-/Qualitätsmessung pro Lauf, Benchmark-Historie in SQLite (neue Tabellen
  `model_benchmark_runs`, `model_benchmark_measurements`, über dieselbe Migrations-Infrastruktur).
- Benchmark-Vergleichsansicht im Model Inspector.

### Phase 4 — Certification
- Volle Statuskette aus Entwurf-Abschnitt 11 (`DISCOVERED` … `CERTIFIED_FOR_CODEE`, `DEGRADED`,
  `QUARANTINED`) ersetzt das in Phase 1 eingeführte reduzierte `discoveryStatus`-Feld.
- Capability-Probes + Qualitäts-Tests + Scoring-Formel, Ergebnis fließt in `recommended_use`/Codee-Rollen
  ein (bestehendes Feld in `IndexedModel`, jetzt datengetrieben statt heuristisch).
- Automatischer Runtime-Profil-Generator aus Benchmark-Daten (ersetzt die aktuell statischen
  Default-Modelle pro Slot in `runtimeSlotManager.ts`).

### Phase 5 — Multi-Modal
- Vision-, Embedding-, Reranker-, Whisper-, Diffusion-Testpfade — Vision-Teil baut auf der bereits
  bestehenden `vision_gpu`-Slot-Infrastruktur und GPU-Exklusivität aus der vorherigen Produktionsreife-
  Revision auf (`packages/shared/src/runtime/runtimeSlots.ts`, `backend/app/runtime/gpu_exclusivity.py`).
- Test-Asset-Bibliothek (`backend/test_assets/model_lab/`) mit versionierten, lizenzierten Test-Dateien.
- Interaktive Testkonsole je Modalität im Model Inspector, nutzt denselben Runtime-Adapter wie die
  automatisierten Benchmarks (keine zweite Implementierung).

### Phase 6 — Autonomous Model Operations
- Dateiwächter für neue/geänderte Modelle (Watcher pro Modellquelle, aus Entwurf-Abschnitt 4.1).
- Geplante Hintergrund-Benchmarks, Regressionserkennung nach Runtime-Updates.
- Automatisch optimierte Codee-Routingprofile — Rückkopplung in `modelSelectionBroker.ts`s
  Rollenmodell-Fallback-Kette (bereits vorhanden, siehe HANDOVER.md Produktionsreife-Revision Phase 1).

---

## 4. Phase 1 im Detail — Inventory MVP

### 4.1 Backend: neues Modul `backend/app/model_lab/`

- **`registry.py`** — SQLite-Tabellen `model_sources`, `model_artifacts`, `model_bundles` über die
  bestehende `sqlite_connection()`/`MigrationManager`-Infrastruktur (`backend/app/core/sqlite.py`,
  `migrations.py`). Neue, fortlaufend nummerierte `migration_00N_model_lab_*`-Funktionen im bestehenden
  `MigrationManager` ergänzen — **keine zweite Datenbankdatei**, dieselbe SQLite-DB wie Agents/Jobs/
  Context-Pack.
- **`identity.py`** — SHA-256-Artefakt-ID (Streaming-Hash großer GGUF-Dateien, nicht komplett in den
  Speicher laden), stabile Bundle-ID (Hash über die Menge primärer Artefaktpfade eines Bundles). Löst
  Entwurf-Abschnitt 12s Identitätsmodell (`model_id`/`artifact_id`/`bundle_id`/`installation_id`) — heute
  basiert `index_service.py`s `_stable_id()` nur auf Name/Pfad, nicht auf Dateiinhalt, das heißt zwei
  identische Dateien an unterschiedlichen Pfaden gelten aktuell als unterschiedliche Modelle.
- **`scanner.py`** — dünner Wrapper um `index_service.py`s bestehende Inferenzfunktionen
  (`_infer_artifact_type`, `_infer_capabilities`, `_infer_modality`, `_infer_quantization`), ergänzt um
  SHA-256-Identität aus `identity.py` und generische Bundle-Gruppierung (verallgemeinert
  `_infer_multimodal_pairs`s Ansatz über Vision-Projektoren hinaus auf Tokenizer/Config/LoRA/Adapter).
- **`service.py`** — orchestriert Scan → Registry-Schreiben, exponiert die Kernendpunkte aus
  Entwurf-Abschnitt 13 als neuer FastAPI-Router (registriert wie die bestehenden `app/models`/
  `app/runtime`-Router in `app/main.py`):
  - `GET /model-lab/sources`, `POST /model-lab/sources`
  - `POST /model-lab/scan`, `GET /model-lab/jobs`
  - `GET /model-lab/models`, `GET /model-lab/models/{id}`
- **Scan-Events** (`scan.started`, `scan.file_detected`, `scan.bundle_created`) über Server-Sent Events,
  nach demselben Muster wie die bestehenden Job-Spooler-Status-Events (`backend/app/job_spooler/`).

### 4.2 Frontend: neue Komponentenfamilie `ModelLabTab.*`

Direkt neben `RuntimeModelsTab.*` in `apps/desktop/src/components/notebook/`, demselben
Modularisierungsmuster folgend:

- **`ModelLabTab.controller.ts`** — State/Actions, spiegelt `RuntimeModelsTab.controller.ts`s Aufbau
  (Datenladen, Fehlerbehandlung, Aktionen als reine Funktionen für Testbarkeit).
- **`ModelLabTab.sections.tsx` / `.rows.tsx` / `.primitives.tsx`** — Model-Library-Tabelle (Name, Typ,
  Format, Größe, Quantisierung, Capabilities, Status) plus Quellen-/Scanner-Bereich mit Live-Fortschritt
  über die SSE-Events aus 4.1.
- **Model Inspector** als Detail-Panel (Overview/Files/Metadata/Capabilities in Phase 1; Benchmarks/
  Quality/Profiles/Certification als weitere Reiter kommen in Phase 2–4 dazu, ohne die Grundstruktur zu
  ändern).
- Neuer Navigationseintrag im Notebook neben dem bestehenden Runtime-Models-Tab (kein Ersatz — beide
  bleiben nebeneinander bestehen, da `RuntimeModelsTab` den aktiven Slot-Betrieb steuert und `ModelLabTab`
  die Inventar-/Analyseseite abdeckt).

### 4.3 Datenmodell-Erweiterung

`IndexedModel` (`backend/app/models/schemas.py`) bekommt additive, optionale Felder — bestehende Nutzung
bleibt unverändert:

```python
artifact_hash: str | None = None
bundle_id: str | None = None
discovery_status: Literal["DISCOVERED", "IDENTIFIED", "LOADABLE", "BROKEN"] | None = None
```

Die volle Statuskette aus Entwurf-Abschnitt 11 (inkl. `CERTIFIED_FOR_CODEE`, `QUARANTINED`, …) kommt erst
mit Phase 4, wenn die dafür nötigen Zertifizierungskriterien (Capability-Probes, Qualitäts-Tests) existieren
— ein verfrühtes vollständiges Enum ohne belastbare Datenbasis dahinter wäre irreführend.

---

## 5. Sicherheitsregeln — sofort verbindlich

Aus Entwurf-Abschnitt 17, ab Phase 1 verankert statt erst bei Einführung des Benchmark-Systems in Phase 3
nachgerüstet:

- Modelle werden nie automatisch beim App-Start geladen (Scanner liest nur Metadaten/Hashes, startet keine
  Runtime).
- Hash und Pfad werden vor jeder Aktion, die ein Modell anfasst, erneut geprüft (nicht nur beim Scan
  zwischengespeichert).
- Keine Shell-Kommandos aus Webquellen (relevant erst ab Phase 2, aber die Regel gehört von Anfang an in
  die Modul-Konventionen von `model_lab/`).
- Externe Metadaten werden nie ungeprüft als Startparameter übernommen.
- API-Tokens für Enrichment-Quellen (Phase 2) ausschließlich über denselben Mechanismus wie bestehende
  Secrets (Windows Credential Manager / Settings-Redaction, siehe `backend/app/settings/`), nicht in Klartext
  in der Registry.

---

## 6. Offene Entscheidungen für spätere Phasen

- **Web-Enrichment-Reihenfolge:** Plan schlägt Hugging Face zuerst vor (offizielle API, höchster
  Datennutzen). GitHub/Ollama-Library/allgemeine Websuche folgen situativ — konkrete Priorisierung erst bei
  Phase-2-Planung festlegen.
- **Benchmark-Adapter-Reihenfolge ab Phase 3:** llama.cpp zuerst (bereits vorhandene Runtime-Anbindung),
  Ollama/ONNX/Diffusion/Whisper erst mit Bedarf — nicht alle Adapter aus Entwurf-Abschnitt 2 auf einmal.
- **Zertifizierungs-Scoring-Formel (Phase 4):** Entwurf zeigt ein Beispielergebnis (Coding: 92/100 etc.),
  aber keine konkrete Berechnungsvorschrift — muss vor Phase-4-Umsetzung eigens spezifiziert werden.
