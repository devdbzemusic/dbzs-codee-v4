# PHASE 3H REPAIR CURRENT STATUS & CURRENT FLOW AUDIT

Dieses Dokument dient als das geforderte initiale Sourcecode-Audit zur Bereinigung und echten Reparatur von Phase 3H in DBZS Codee. Es dokumentiert präzise die Schwachstellen, die Scheinimplementierungen und legt den Fahrplan für die tatsächliche Reallauf-Anbindung des Workers fest.

---

## 1. Wo wird der hartcodierte Acceptance-Pfad aktiviert?

In [backend/app/agent_workbench/worker.py](backend/app/agent_workbench/worker.py) wird am Anfang der Werkzeugaustragung die Umgebungsvariable `DBZS_LIVE_LLM_ACCEPTANCE == "1"` geprüft:

```python
is_live_acceptance = os.getenv("DBZS_LIVE_LLM_ACCEPTANCE") == "1"
```

## 2. Wo werden `calc.py` und `a + b` hartcodiert?

Ebenfalls in `backend/app/agent_workbench/worker.py` ab Zeile ~205:

```python
calc_file = Path(workspace_root) / "calc.py"
...
new_content = "def add(a: float, b: float) -> float:\n    # BUG: Sollte a + b sein, ist aber fälschlicherweise eine Subtraktion.\n    return a + b\n"
```

## 3. Wo schreibt der Worker direkt Dateien?

Direkt im Worker [backend/app/agent_workbench/worker.py](backend/app/agent_workbench/worker.py) via:

```python
if os.getenv("DBZS_LIVE_ACCEPTANCE_AUTO_APPROVE") == "1":
    calc_file.write_text(new_content, encoding="utf-8")
```

Dies umgeht die gesamte Electron Host-Action-Pipeline vollständig.

## 4. Wo startet der Worker direkt `pytest`?

Ebenfalls im Worker [backend/app/agent_workbench/worker.py](backend/app/agent_workbench/worker.py) über `subprocess.run(...)`:

```python
result = subprocess.run(
    [".venv/Scripts/python", "-m", "pytest", str(test_file)],
    ...
)
```

## 5. Wo werden Modell, Provider und Endpoint im Proof Bundle erfunden?

Direkt im Dictionary des Workers:

```python
summary_data = {
    ...
    "provider": "llama.cpp",
    "model_id": "Llama-3.2-3B-CodeReactor.Q8-0",
    "endpoint": "http://127.0.0.1:8091",
}
```

## 6. Wo existiert die echte llama.cpp-/Ollama-Chatstrecke?

In `app/runtime/service.py` via `RuntimeService`, `LlamaServerChatClient` und `OllamaChatClient`. Sie bedient die Endpunkte `/runtime/chat` und `/runtime/chat/stream`.

## 7. Welche bestehenden Services müssen stattdessen benutzt werden?

Es muss der `RuntimeService` genutzt werden, um echtes Chatten an das fertig gestartete Modell zu senden, anstatt Daten lokal zu manipulieren. Die UI und Host-Aktionen müssen die tatsächlichen Plattform-Befehle an Electron binden.

## 8. Welche Runtime-Informationen fehlen derzeit am `AgentRun`?

Es fehlen Felder wie `execution_backend`, `runtime_provider`, `runtime_model_id`, `runtime_endpoint`, die den Zustand des Modells während des Agentenlaufs beweisen.

## 9. Welche Tests beweisen nur den Sonderweg?

`backend/tests/test_agent_workbench_live_llm.py` setzt künstlich `DBZS_LIVE_LLM_ACCEPTANCE="1"` und verifiziert nur den vordefinierten Dateipfad.

## 10. Welche Dokumentation behauptet mehr, als der Code belegt?

Sowohl `docs/PHASE_3H_RESULTS.md` als auch `docs/PHASE_3H_LIVE_LLM_ACCEPTANCE.md` behaupten fälschlicherweise eine reale interaktive GGUF-Modell-Abnahme, obwohl diese hartcodiert simuliert wurde.

---

**Status:** Phase 3H Repair wird hiermit gestartet. Die Scheinimplementierung wird im nächsten Schritt sauber entfernt.
