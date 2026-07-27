# PHASE 3H - CURRENT FLOW AUDIT

Dieses Audit-Dokument gibt Aufschluss über den tatsächlichen Sourcecode der Agent Workbench im DBZS Codee System und dokumentiert die Stellen, wo Runs erstellt und gestoppt werden, wie Tools ausgeführt werden, wie derzeit simuliert wird und wie Patches/Testkommandos übertragen werden.

---

## 1. Wo Agent Workbench Runs erstellt werden

Die Runs der Agent Workbench werden in [backend/app/agent_workbench/router.py](backend/app/agent_workbench/router.py) über den Endpunkt `POST /api/v1/agent-workbench/runs` initiiert, welcher wiederum den `AgentWorkbenchService` in [backend/app/agent_workbench/service.py](backend/app/agent_workbench/service.py) aufruft (`create_run` Methode).

## 2. Wo Steps geplant werden

In [backend/app/agent_workbench/service.py](backend/app/agent_workbench/service.py) in `create_run` werden standardmäßig Demo-Schritte via `demo_readonly_steps()` oder `demo_pipeline_steps()` geplant. Es wird keine dynamische Modellplanung durchgeführt, es sei denn, `simulate_llm` ist gesetzt, wo ebenfalls feste Step-Listen herangezogen werden.

## 3. Wo der Worker einen Step ausführt

In [backend/app/agent_workbench/worker.py](backend/app/agent_workbench/worker.py) in der zentralen Methode `_execute_run` und `_run_step` / `_run_tool_step`. Ein Hintergrund-Thread pollt periodisch über `_run_loop`.

## 4. Wo derzeit simulierte LLM-Ausgaben erzeugt werden

Im Worker ([backend/app/agent_workbench/worker.py](backend/app/agent_workbench/worker.py)) wird am Ende von `_run_tool_step` ein Event erzeugt: `simulated: True`. Der Agent selbst hat momentan gar keine Anbindung an ein echtes Modell, sondern schlägt hartcodierte Tools abhängig vom Titel des Steps vor.

## 5. Welche bestehende Runtime-API bereits echte Chat-Requests sendet

In [backend/app/runtime/service.py](backend/app/runtime/service.py) gibt es die Klasse `RuntimeService`, die über `LlamaServerChatClient` oder `OllamaChatClient` echte Chat-Requests an `llama-server` sendet (über den Port `8091` / `8092`).

## 6. Wie Provider, Modell, Port und Endpoint ausgewählt werden

Dies geschieht über `RuntimeService.status()`, welcher den aktiven Subprozess analysiert und dessen Endpoint ansteuert. Die Identifizierung erfolgt über das `models.catalog.json` oder über das Fallback-System.

## 7. Wie Tool Calls im Runtime Chat bereits verarbeitet werden

Im Runtime Chat steuert das Frontend die Tool-Ausführungen. In [apps/desktop/src/stores/runtimeChatStore.ts](apps/desktop/src/stores/runtimeChatStore.ts) und [apps/desktop/src/services/runtimeKernelService.ts](apps/desktop/src/services/runtimeKernelService.ts) wird der Runtime-Kernel bzw. `orchestrationClient` aufgerufen.

## 8. Wie Host Actions an Electron übertragen werden

Host Actions werden über IPC-Events übertragen. In [backend/app/agent_workbench/host_actions.py](backend/app/agent_workbench/host_actions.py) werden File-Change-Vorschläge und Command-Requests verwaltet. Electron fragt diese via Preload-Bridge und Polling/SSE-Events ab.

## 9. Wie Patches angewendet werden

Das Frontend oder Electron empfangen einen Patch über Host-Actions, speichern einen Restore Point und wenden den Patch direkt auf dem lokalen Dateisystem an.

## 10. Wie Testkommandos gestartet werden

Testkommandos werden über die Electron Host Bridge als Host Action ausgeführt, die im lokalen Arbeitsverzeichnis des Benutzers läuft. Das Ergebnis (Exit-Code, stdout, stderr) wird zurück an den Event-Stream oder Host Action Status gemeldet.

## 11. Recovery-Zustand Arbeit

Wenn das Backend abstürzt und neu startet, pollt der Worker nach unvollständigen Runs und markiert diese als `paused_recovery` oder verbleibt im Zustand `paused`.

---

Dieses Audit diente als Grundlage für die Implementierung der Phasen 3H in Codee.
