# Codex Folgeauftrag: DBZS Codee Phase 0 wirklich grün machen

## Ausgangslage

Im hochgeladenen Stand behauptet `HANDOVER.md`, dass alle Gates grün seien. Das stimmt im geprüften ZIP nicht.

Reproduzierter Check:

```bash
cd backend
uv run pytest -q
```

Ergebnis:

```text
37 passed, 4 failed
```

Fehlgeschlagene Tests:

```text
tests/test_config.py::test_ollama_models_dir_prefers_ollama_models_env
tests/test_runtime_service.py::test_runtime_service_starts_llama_server_for_indexed_model
tests/test_runtime_service.py::test_runtime_service_stops_running_model
tests/test_runtime_service.py::test_runtime_service_sends_chat_to_running_llama_server
```

Frontend konnte in der Prüf-Sandbox nicht mit pnpm validiert werden, weil `pnpm` nicht installiert war und `corepack` wegen Registry/DNS scheiterte. Deshalb zuerst Backend grün machen, danach lokal `pnpm typecheck` und `pnpm test` ausführen.

## Ziel

Keine neuen Features. Repariere ausschließlich die verbleibenden Phase-0-Brüche. Danach muss mindestens gelten:

```bash
cd backend && uv run pytest -q
# Erwartung: 41 passed
```

Danach lokal zusätzlich:

```bash
pnpm typecheck
pnpm test
```

## Fix 1: Windows-Pfad-Normalisierung in `backend/app/core/config.py`

Aktueller Fehler:

```text
assert get_ollama_models_dir() == Path("D:/Ollama").resolve()
E AssertionError: assert PosixPath('D:/Ollama') == PosixPath('/.../backend/D:/Ollama')
```

Ursache:

`_normalize_config_path("D:\\Ollama")` gibt bei Windows-Drive-Syntax aktuell `Path("D:/Ollama")` un-resolved zurück. Der Test erwartet aber exakt `Path("D:/Ollama").resolve()` im jeweiligen Host-Kontext.

Reparatur:

In `_normalize_config_path()` nach Backslash-Normalisierung immer `Path(normalized).expanduser().resolve()` zurückgeben, sofern dadurch kein beabsichtigtes Windows-Verhalten kaputtgeht. Der Sonderfall `_WINDOWS_DRIVE_PATH` darf nicht dazu führen, dass der Testpfad unaufgelöst bleibt.

Akzeptanz:

```bash
cd backend
uv run pytest tests/test_config.py -q
```

muss grün sein.

## Fix 2: RuntimeService nutzt falsches `models_dir`

Aktueller Fehler:

```text
RuntimeStatus(state='error', message='Runtime directory not found.')
```

Ursache:

`RuntimeService.__init__()` setzt:

```python
self.model_index_service = model_index_service or ModelIndexService()
...
self.models_dir = get_models_dir()
```

Damit ignoriert `RuntimeService` bei Tests und wahrscheinlich auch bei konfigurierten Instanzen das `models_dir` des injizierten `ModelIndexService`. In den Tests liegt `models.catalog.json` im `tmp_path`, aber `_get_runtime_dir()` sucht in `get_models_dir()` statt in `self.model_index_service.models_dir`.

Reparatur:

Setze in `RuntimeService.__init__()`:

```python
self.models_dir = self.model_index_service.models_dir
```

statt `get_models_dir()`.

Wichtig: Danach verwendet `_get_runtime_dir()`, `_get_preferred_port()`, `_save_last_good_command()` und `_save_selected_model()` dieselbe Modellbasis wie der Index-Service.

Akzeptanz:

```bash
cd backend
uv run pytest tests/test_runtime_service.py -q
```

muss mindestens die drei llama-server-Tests grün machen.

## Fix 3: FakeProcess muss beim Stop wirklich terminiert werden

Nach Fix 2 sollte `stop_model()` den Fake-Prozess terminieren. Prüfe, ob `status()` den Prozess nicht vorher versehentlich verwirft. Erwartung aus Test:

```python
assert runner.process.poll() == 0
```

Falls der Prozess nicht terminiert wird, repariere `stop_model()` so, dass bei laufendem Prozess immer `terminate()` aufgerufen wird, bevor `self._process = None` gesetzt wird.

## Fix 4: Runtime Chat muss nach Start laufen

Nach Fix 2 sollte `service.start_model("coder")` den Status `running` setzen und `chat()` funktionieren.

Akzeptanz:

```bash
cd backend
uv run pytest tests/test_runtime_service.py::test_runtime_service_sends_chat_to_running_llama_server -q
```

muss grün sein.

## Zusatzprüfung: Handover korrigieren

`HANDOVER.md` darf nicht behaupten, alle Gates seien grün, solange sie es nicht sind.

Wenn nach deinen Fixes wirklich grün:

- `cd backend && uv run pytest -q` → `41 passed`
- `pnpm typecheck` → OK
- `pnpm test` → OK

Dann darf HANDOVER entsprechend bleiben oder aktualisiert werden.

Wenn nicht alles grün ist, korrigiere HANDOVER ehrlich mit dem aktuellen Status.

## Erwartete Abschlussmeldung

Bitte liefere am Ende exakt:

1. Welche Dateien geändert wurden.
2. Warum die 4 verbleibenden Tests vorher fehlgeschlagen sind.
3. Exakte Testcommands mit Ergebnis.
4. Ob `HANDOVER.md` weiterhin korrekt ist.
5. Ob `pnpm typecheck` und `pnpm test` wirklich lokal gelaufen sind.

## Harte Grenze

Keine neuen Features, keine UI-Erweiterung, kein Refactor außerhalb der genannten Bruchstellen.
