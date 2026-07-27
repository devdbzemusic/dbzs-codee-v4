# Codex Auftrag: DBZS Codee Phase 0 Stabilisierung

## Ziel
Stabilisiere das aktuelle Repository `dbzs-codee-project-main`, damit der vorhandene MVP wieder technisch belastbar wird. Keine neuen Features. Kein UI-Redesign. Kein Architektur-Umbau. Erst Build-, Typecheck- und Testfähigkeit herstellen.

Das Projekt ist eine Electron/React Desktop-App mit FastAPI-Backend für Division By Zeros (DBZS) Codee. Der aktuelle Stand ist ein Integrationsbruch-Stand: viele gute Module sind vorhanden, aber einige Brücken zwischen Electron Preload, Frontend-Typen, Backend Model Index und Runtime-Service sind defekt.

## Arbeitsmodus
Arbeite wie an einem präzisen GitHub-Issue.

1. Prüfe zuerst den aktuellen Zustand mit den vorhandenen Commands.
2. Repariere nur die konkreten Bruchstellen, die Tests/Typecheck/Build verhindern.
3. Behalte bestehende öffentliche APIs bei, wenn möglich.
4. Ergänze oder korrigiere Tests nur, wenn die Tests offensichtlich nicht mehr zum beabsichtigten Verhalten passen.
5. Keine neuen Production-Dependencies ohne zwingenden Grund.
6. Dokumentiere am Ende exakt:
   - geänderte Dateien
   - Ursache pro Fix
   - welche Commands gelaufen sind
   - welche Tests grün sind
   - was bewusst nicht angefasst wurde

## Wichtige Projektbefehle
Vom Repo-Root:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Backend separat:

```bash
cd backend
uv run pytest -q
```

## Aktuell reproduzierter Backend-Teststand
Beim letzten Check im Backend:

```text
33 passed, 8 failed
```

Fehlende/kaputte Bereiche:

- `tests/test_config.py::test_ollama_models_dir_prefers_ollama_models_env`
- `tests/test_model_index.py::test_model_index_prefers_existing_catalog`
- `tests/test_model_index.py::test_model_index_scans_gguf_when_catalog_is_missing`
- `tests/test_model_index.py::test_model_index_scans_ollama_manifests`
- `tests/test_runtime_service.py::test_runtime_service_starts_llama_server_for_indexed_model`
- `tests/test_runtime_service.py::test_runtime_service_stops_running_model`
- `tests/test_runtime_service.py::test_runtime_service_sends_chat_to_running_llama_server`
- `tests/test_runtime_service.py::test_runtime_service_starts_ollama_for_indexed_manifest`

## Konkrete Fix-Prioritäten

### 1. Electron Preload/API-Brücke reparieren
Prüfe und repariere:

- `apps/desktop/electron/preload.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/src/types/global.d.ts`
- `apps/desktop/src/App.tsx`

Bekannter Verdacht:

- `reloadBackend` wird in `App.tsx` über `window.dbzs.reloadBackend()` genutzt.
- `global.d.ts` kennt diese Methode vermutlich nicht oder nicht korrekt.
- `preload.ts` muss `reloadBackend` sauber innerhalb des exportierten `api`-Objekts bereitstellen.
- Der IPC-Handler muss in `main.ts` existieren oder sauber ergänzt werden.

Akzeptanz:

- `window.dbzs.reloadBackend()` ist typisiert.
- Preload kompiliert ohne Syntaxfehler.
- `pnpm --filter @dbzs/desktop typecheck` läuft durch.

### 2. Ungültiges Button-Nesting in `App.tsx` beseitigen
Prüfe die Settings-/Backend-Control-Sektion in:

- `apps/desktop/src/App.tsx`

Bekannter Verdacht:

- Ein `<button>` ist in einen anderen `<button>` verschachtelt.

Akzeptanz:

- Keine verschachtelten Buttons.
- Die UI-Funktion bleibt gleich.
- Typecheck bleibt grün.

### 3. Windows-artige Pfade in Backend Config normalisieren
Prüfe:

- `backend/app/core/config.py`
- `backend/tests/test_config.py`

Bekannter Fehler:

```text
get_ollama_models_dir() liefert bei OLLAMA_MODELS="D:\\Ollama" unter Linux/CI einen falschen relativen PosixPath.
```

Ziel:

- Env-Pfade wie `D:\Ollama` sollen intern konsistent wie `D:/Ollama` behandelt werden.
- Nicht blind Windows-only Logik bauen. Das Repo kann unter Windows und Linux/CI laufen.

Akzeptanz:

- `test_ollama_models_dir_prefers_ollama_models_env` ist grün.
- Bestehendes Verhalten für normale POSIX-Pfade bleibt intakt.

### 4. ModelIndexService V2/V1-kompatibel reparieren
Prüfe:

- `backend/app/models/index_service.py`
- `backend/app/models/schemas.py`
- `backend/tests/test_model_index.py`
- `backend/tests/test_model_index_api.py`

Bekannte Fehler:

- `ModelIndexService.build_index()` ruft `_from_filesystem()` auf, aber diese Methode existiert nicht.
- `models.runtime.json` wird teils im neuen Schema `models: {}` erwartet, Tests und bestehende Dateien nutzen aber auch `artifacts: []`.
- `models.state.json` kann `health: { model_id: { status: ... } }` enthalten.
- `llama_server_ready` bleibt 0, obwohl Catalog + Runtime + Health einen startbaren llama.cpp/GGUF-Eintrag beschreiben.

Ziel:

- `models.catalog.json` mit `artifacts: []` muss weiterhin funktionieren.
- `models.runtime.json` muss beide Formen lesen:
  - V1/Legacy: `artifacts: [{ id, runtime, server }]`
  - V2: `models: { [id]: { runtime, server, ... } }`
- `models.state.json` muss beide Formen lesen:
  - Legacy: `health: { [id]: { status } }`
  - V2: `models: { [id]: { health/status/... } }`
- `_from_filesystem()` muss GGUF-Dateien im `models_dir` erkennen, sinnvolle Rollen/Capabilities ableiten und Ollama-Manifeste ergänzen.
- Ollama-Manifeste müssen IDs nach vorhandenem Testschema erzeugen, z. B. `ollama_qwen2_5_coder_latest`.

Akzeptanz:

- Alle Tests in `backend/tests/test_model_index.py` sind grün.
- `/models/index` bleibt API-kompatibel.
- Keine echten Modellstarts beim Index-Scan.

### 5. RuntimeService testbar und realistisch starten lassen
Prüfe:

- `backend/app/runtime/service.py`
- `backend/app/runtime/multi_server_manager.py`
- `backend/tests/test_runtime_service.py`
- `backend/tests/test_runtime_api.py`

Bekannte Fehler:

- FakeProcessRunner startet einen Fake-Prozess, aber `RuntimeService.start_model()` setzt danach auf echten Endpoint-Check und fällt auf `error` zurück.
- Dadurch schlagen Start, Stop und Chat-Tests fehl.
- In `multi_server_manager.py` gibt es vermutlich einen Aufruf auf `RuntimeService.start_model_with_config`, diese Methode existiert nicht.

Ziel:

- Tests dürfen mit FakeProcessRunner ohne echten HTTP-Server grün laufen.
- Realbetrieb soll weiterhin Endpoint-Prüfung behalten.
- Mögliche saubere Lösung: Endpoint-Check dependency-injectable machen oder nur im echten Runner erzwingen.
- `RuntimeStatus.provider` muss für Ollama korrekt `ollama` und für llama.cpp korrekt `llama.cpp`/Default sein, damit `chat()` den richtigen Client nutzt.
- `stop_model()` muss den Fake-Prozess terminieren, sodass `poll()` danach 0 liefert.
- `start_model_with_config` entweder sauber implementieren oder den Multi-Server-Code so anpassen, dass keine tote Methode referenziert wird.

Akzeptanz:

- Alle Tests in `backend/tests/test_runtime_service.py` sind grün.
- Kein echter llama-server oder Ollama muss für Unit Tests laufen.
- Realer Start nutzt weiterhin `llama-server.exe` bzw. `ollama.exe serve`.

### 6. Model Profiles API initialisieren
Prüfe:

- `backend/app/api/model_profiles.py`
- `backend/app/main.py`
- `backend/tests/test_model_profiles.py`
- `backend/tests/test_model_profiles_api.py`

Bekannter Verdacht:

- `model_profiles.py` erwartet Service-Initialisierung über `set_services(...)`, aber `main.py` verdrahtet das eventuell nicht.

Akzeptanz:

- API-Tests für Model Profiles sind grün.
- Keine Route hängt an nicht initialisierten Services.

### 7. Job-Spooler Brücke prüfen, aber nicht ausbauen
Prüfe nur auf offensichtliche fehlende Verdrahtung:

- `backend/app/api/job_spooler.py`
- `apps/desktop/src/stores/jobSpoolerStore.ts`
- `apps/desktop/src/services/backendClient.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/src/types/global.d.ts`

Ziel:

- Wenn UI-Code Job-Funktionen erwartet, müssen sie entweder sauber typisiert/gebunden sein oder die UI muss defensiv prüfen.
- Keine neue Job-Orchestrierung bauen.

Akzeptanz:

- Typecheck grün.
- Bestehende Job-Spooler-Tests bleiben grün.

## Definition of Done
Der Auftrag ist erst fertig, wenn mindestens diese Gates erfüllt sind:

```bash
cd backend && uv run pytest -q
pnpm typecheck
pnpm test
```

Wenn `pnpm build` wegen fehlender lokaler Toolchain/Umgebung scheitert, dokumentiere den genauen Grund und stelle sicher, dass Typecheck + Tests grün sind.

## Harte Grenzen

- Keine neuen Features.
- Kein UI-Redesign.
- Keine großen Umbenennungen.
- Keine Entfernung bestehender Module, nur weil sie aktuell nicht perfekt sind.
- Keine Mock-Lösung, die den Realbetrieb kaputt macht.
- Keine Secrets, Tokens oder absolute private User-Daten in Logs oder Tests schreiben.

## Erwartete Abschlussantwort von Codex
Bitte liefere am Ende:

1. Kurze technische Zusammenfassung.
2. Liste der geänderten Dateien.
3. Pro Datei: Was wurde repariert und warum.
4. Test-/Build-Ergebnis mit exakten Commands.
5. Noch offene Risiken, falls vorhanden.
6. Vorschlag für den nächsten kleinen Codex-Auftrag nach Phase 0.

