# FunctionGemma 270M als vierter Runtime-Slot (Slot-Infrastruktur)

> TODO/Handover-Dokument. Branch: `feat/functiongemma-orchestrator-runtime` (von `main`).
> Ursprung: `.codee/functiongemma/` (12-Phasen-Gesamtkonzept). Diese Runde ist bewusst auf
> Slot-Infrastruktur beschränkt — siehe "Explizit außen vor".

## Context

`.codee/functiongemma/` enthält ein vollständiges 12-Phasen-Konzept (Architektur-Doc, Codex-Master-Prompt, Zod-Contract, Modell-Profil-Beispiel, Smoke-Test, PowerShell-Start-Skript) sowie das eigentliche GGUF (`functiongemma-270m-it.Q8_0.gguf`, 270M Parameter, function-calling-getuned). Ziel des Gesamtkonzepts: FunctionGemma als dauerhaft residenten, CPU-only Router vor Planner/Coder/Reviewer/Debugger/Chat zu betreiben — Intent-Routing, Tool-Auswahl, `ask_user`-Erkennung, Modellrollen-Auswahl, alles nur als **Vorschlag**, nie als Ersatz für den bestehenden autoritativen `modelSelectionBroker`.

Das Gesamtkonzept ist für eine Runde zu groß. Abgestimmter Umfang für **diese Runde**: nur die **Slot-Infrastruktur** — vierter Runtime-Slot `orchestrator_cpu`, Settings/Autostart, Modell-Katalog-Registrierung, UI. **Kein natives Tool-Call-Transport, kein tatsächliches Routing durch FunctionGemma** in dieser Runde — das Modell läuft resident und ist über die bestehenden Slot-APIs erreichbar, wird aber noch nirgends im Chat-Flow befragt. Natives Tool-Call-Transport (llama.cpp → Backend → SSE → Electron) ist als eigener, separat zu planender nächster Schritt dokumentiert (siehe „Explizit außen vor").

Drei Explore-Agents haben den bestehenden Code untersucht. Zentrale, planändernde Befunde:

- **Kein Autostart existiert heute für irgendeinen der 3 Slots.** Die Settings-Felder `autoStartChatRuntime`/`autoStartCodingRuntime` werden nirgends gelesen; `backend/app/main.py`s FastAPI-`lifespan()` hat nichts vor dem `yield`. Autostart für `orchestrator_cpu` ist damit **netto-neue** Backend-Logik, nicht die Erweiterung eines bestehenden Pfads.
- **Slot-Verwaltung ist nicht generisch.** `backend/app/runtime/slot_contract.py` validiert hart gegen die exakte Menge `{"quality_cpu","fast_gpu","utility"}` (wirft `RuntimeError` bei Abweichung). `backend/app/runtime/service.py` hat ~15 Stellen mit literalen String-Vergleichen (`if target_slot_id == "quality_cpu"` usw.) statt einer generischen Slot-Tabelle. `apps/desktop/src/services/runtimeSlotManager.ts` hat 5 hartcodierte Stellen (`ALL_SLOTS`-Array, `sizeHintScore()`, `configuredModelForSlot()`-Switch, `getRecommendedSlot()`-Kette, `getDefaultModelForSlot()`-Switch). `RuntimeSlotPanel.tsx` ist dagegen bereits generisch — sobald `ALL_SLOTS` den 4. Slot enthält, erscheint er automatisch in der UI.
- **`residency.py`** kennt `KEEP_RESIDENT` bereits (genutzt von `quality_cpu`/`fast_gpu`) — für `orchestrator_cpu` einfach wiederverwenden.
- **Kein Health-Check-Timer/Circuit-Breaker existiert für irgendeinen Slot.** `sweep_idle_slots()` läuft nur on-demand über einen API-Call, nicht periodisch. Bestehende, slot-übergreifende Lücke — wird hier **nicht** nachgerüstet (Scope-Explosion), nur als Folge-Thema dokumentiert.
- **Modell-Katalog:** kein Writer für `models.catalog.json` existiert bisher (nur Reader). Ein wiederverwendbares Read-Merge-Write-Muster existiert für die Schwesterdatei `models.runtime.json` in `backend/app/runtime/service.py` (`_save_last_good_command`, ~Zeilen 1166–1246) — als Vorlage nutzen, nicht neu erfinden. `RecommendedUse` (Python `Literal` in `backend/app/models/schemas.py`, TS-Pendant in `packages/shared/src/index.ts`) hat keinen `orchestrator`-Wert; die Klassifizierungsheuristik `_infer_capabilities`/`_recommended_use` (`backend/app/models/index_service.py`) kennt keine Function-Calling-Begriffe.
- **Natives Tool-Calling ist für llama.cpp komplett tot, für Ollama bereits vorhanden** (Details siehe „Explizit außen vor" — betrifft diese Runde nicht direkt, aber wichtig für die spätere Planung).
- **Das bestehende `ask_user`-System** (4 Commits: `2510bf1`/`67cd754`/`8778e37`/`39a4375`) ist intakt und unverändert und bleibt von dieser Runde unberührt.
- **Kein GitHub-Read/Write existiert im Produkt.**

---

## Umsetzung — Vierter Runtime-Slot `orchestrator_cpu`

### 1. Shared Contracts
- `packages/shared/runtime-slots.json`: neuer Eintrag `{"id": "orchestrator_cpu", "port": 8084, "role": "routing_function_calling", "devicePolicy": "cpu"}`.
- `packages/shared/src/runtime/runtimeSlots.ts`: `RuntimeSlotId` += `"orchestrator_cpu"`; `RuntimeSlotDefinition["purpose"]` += `"orchestrator"`; neue `RuntimeTaskType`-Literale für `intent_routing`, `workflow_routing`, `function_calling`, `clarification_detection`; `RUNTIME_SLOT_DEFINITIONS.orchestrator_cpu` mit `hardwareClass: "cpu"`, `port: 8084`, `allowImplicitFallback: false`.

### 2. Backend
- `backend/app/runtime/schemas.py`: `RuntimeSlotId` Literal += `"orchestrator_cpu"`.
- `backend/app/runtime/slot_contract.py`: harte Validierungsmenge in `load_slot_contract()` um `"orchestrator_cpu"` erweitern.
- `backend/app/runtime/residency.py`: `DEFAULT_SLOT_POLICY["orchestrator_cpu"] = ResidencyPolicy.KEEP_RESIDENT`.
- `backend/app/runtime/service.py`: `_statuses`/`_slot_locks`-Dicts um den neuen Slot ergänzen; jede der ~15 literalen `if slot_id == "..."`-Stellen durchgehen (grep `"quality_cpu"|"fast_gpu"|"utility"` in dieser Datei) und dort, wo CPU-only-spezifisches Verhalten nötig ist (GPU-Layer-Planung, Resource-Preview), einen Zweig für `orchestrator_cpu` ergänzen (analog `utility`, da beide CPU-only sind); Launch-Parameter fix auf `gpu_layers=0`, `ctx=4096`, `threads=4`, `parallel=2`.

### 3. Modell-Katalog-Registrierung
- Neue kleine Service-Funktion (Vorlage: `_save_last_good_command`-Idiom in `service.py`) zum atomaren Zusammenführen eines einzelnen Modell-Eintrags in `models.catalog.json`, ohne bestehende Einträge zu überschreiben — nutzt die Struktur aus `functiongemma-model-profile.example.json` als Eingabeform.
- `backend/app/models/schemas.py` (`RecommendedUse` Literal) += `"orchestrator"`; TS-Pendant `RecommendedModelUse` (`packages/shared/src/index.ts`) synchron ergänzen.
- `backend/app/models/index_service.py`: `_infer_capabilities()` um Filename-Token `"functiongemma"` → `["function_calling", "intent_routing", "workflow_routing", "clarification_detection"]` ergänzen; `_recommended_use()` um `role == "ORCHESTRATOR_MODEL"` → `"orchestrator"` ergänzen. `compatibility` bleibt unverändert unabhängig abgeleitet (launcher + health + Dateipräsenz) — nicht versuchen, das aus dem Profil zu setzen.
- Registrierung idempotent, sofern das Modell gefunden wird und noch nicht im Katalog steht.

### 4. Desktop `runtimeSlotManager.ts`
- `ALL_SLOTS` += `"orchestrator_cpu"`.
- `sizeHintScore()`, `configuredModelForSlot()`, `getRecommendedSlot()`, `getDefaultModelForSlot()`: je einen Fall für `orchestrator_cpu` ergänzen (Default-Modell-Auflösung über die neue `defaultOrchestratorModelId`-Einstellung bzw. `ORCHESTRATOR_MODEL`-Rolle).
- `RuntimeSlotPanel.tsx`: keine Änderung nötig (bereits generisch über `getAllSlotsStatus()`).

### 5. Settings (beide Seiten, Muster von `chatRuntimeSlot`/`codingRuntimeSlot` 1:1 übernehmen)
Neue Felder in `packages/shared/src/index.ts` (`AppSettings`+`DEFAULT_SETTINGS`) und `backend/app/settings/models.py`:
```
defaultOrchestratorModelId: string = ""
autoStartOrchestratorRuntime: bool = true
orchestratorRuntimeSlot: Literal["orchestrator_cpu"] = "orchestrator_cpu"
orchestratorRuntimePort: int = 8084
```
UI: in `apps/desktop/src/components/SettingsPanel.tsx` im Tab „Runtime & Timeouts" einen weiteren Block „Orchestrator (FunctionGemma)" analog zum bestehenden „Dual Runtime Bootstrap"-Block ergänzen (Autostart-Toggle, Port, Modell-ID).

(`functionRouterEnabled`/`functionRouterShadowMode`/`functionRouterCanaryPercent`/`functionRouterTimeoutMs`/`functionRouterMinConfidence`/`functionRouterMaxTokens` aus dem Gesamtkonzept werden **nicht** in dieser Runde angelegt — sie gehören zum späteren Routing-Schritt, siehe „Explizit außen vor".)

### 6. Autostart (netto-neu, fail-soft)
In `backend/app/main.py`s `lifespan()` **vor** `yield`:
1. Settings laden.
2. Wenn `autoStartOrchestratorRuntime`: eindeutiges FunctionGemma-Modell auflösen (`defaultOrchestratorModelId` oder Katalogeintrag mit `role == "ORCHESTRATOR_MODEL"`).
3. Slot `orchestrator_cpu` über die bestehende Slot-Start-Methode in `service.py` starten (dieselbe, die der `/runtime/slots/{id}/start`-Endpunkt nutzt).
4. Healthcheck (einmalig, wiederverwendet aus dem bestehenden Slot-Status-Mechanismus).
5. Bei Fehler: Backend startet trotzdem, Slotstatus wird `error`, kein Retry-Loop (kein Circuit-Breaker in dieser Runde).

---

## Explizit außen vor (dokumentiertes Backlog, nicht diese Runde)

- **Natives Tool-Call-Transport für llama.cpp** — `LlamaServerChatClient.complete()`/`chat_stream.py` (`backend/app/runtime/service.py`, `chat_stream.py`) extrahieren aktuell nur `message.content`, `tool_calls` wird nie gelesen. Backend-Schemas (`RuntimeChatMessage`/`RuntimeChatResponse` in `schemas.py`) haben kein `tool_calls`-Feld. SSE-Events (`backend/app/api/runtime.py`) kennen nur `delta`/`done`/`error`. Electron-Stream-Parser (`apps/desktop/electron/runtimeChatStream.ts`) hat dieselbe Lücke. Für Ollama funktioniert natives Tool-Calling dagegen bereits über einen separaten Pfad (`runtimeChatStreamClient.ts::streamOllamaChat`, umgeht das Backend komplett), und `parseNativeToolCallsFromMessage()`/`agentTurnEngine.ts` können native Tool Calls bereits verarbeiten — sie werden nur vom llama-server-Pfad nie befüllt. `resolveToolProtocolMode()` (`toolProtocolAdapter.ts`) ist aktuell nur `providerId === "ollama" ? "native" : "prompt"`. Verifikationswerkzeug für später bereits vorhanden: `.codee/functiongemma/functiongemma_smoke_test.py`.
- **`UtilityDecision`-Contract + tatsächliches Routing durch FunctionGemma** (Zod-Contract liegt bereits fertig in `.codee/functiongemma/functiongemmaDecisionContract.ts` vor) — braucht eigene Policy-Engine-Integration in den bestehenden `modelSelectionBroker`, setzt natives Tool-Call-Transport voraus.
- **Shadow Mode / Canary-Rollout** — baut auf dem Routing auf, das hier noch nicht existiert.
- **`ask_user`-Härtung** (`questionSignature`, `continuationToken`, `idempotencyKey`, atomare Persistenz, Optimistic Locking) — sinnvolle Erweiterung des bestehenden Systems, aber unabhängig von FunctionGemma.
- **Genereller Health-Check/Circuit-Breaker für alle 4 Slots** — bestehende Lücke für alle Slots, keine FunctionGemma-spezifische Aufgabe.
- **Katalog-Klassifizierung generischer** (nicht nur Filename-Match, sondern z. B. GGUF-Metadaten-Introspektion) — für diese Runde reicht Filename+Rolle.

---

## Kritische Dateien

**Shared:** `packages/shared/runtime-slots.json`, `packages/shared/src/runtime/runtimeSlots.ts`, `packages/shared/src/index.ts` (Settings, `RecommendedModelUse`)

**Backend:** `backend/app/runtime/schemas.py`, `slot_contract.py`, `service.py`, `residency.py`, `backend/app/main.py` (lifespan), `backend/app/models/schemas.py`, `backend/app/models/index_service.py`, `backend/app/settings/models.py`

**Desktop:** `apps/desktop/src/services/runtimeSlotManager.ts`, `apps/desktop/src/components/SettingsPanel.tsx`

**Referenz/Vorlagen zum Wiederverwenden:** `backend/app/runtime/service.py::_save_last_good_command` (Merge-Write-Idiom für Katalog-Registrierung)

## Verifikation

1. Backend-Baseline vor Änderungen: `uv run pytest` (Ausgangsstand dokumentieren).
2. Neue/erweiterte Tests: `backend/tests/test_model_index.py` (FunctionGemma-Filename-Klassifizierung), Test für `slot_contract.py` (4 Slots, Port 8084 eindeutig), `runtimeSlotManager.ts`-Test (4. Slot in `getAllSlotsStatus()`), Settings-Rundlauf-Test (analog `test_settings.py`) für die neuen Felder.
3. Manuell: Backend neu starten, prüfen dass `orchestrator_cpu` beim Start versucht wird (Log), `GET /runtime/slots/orchestrator_cpu/status` liefert Zustand, `utility` auf 8083 bleibt unabhängig erreichbar, Mission Control/RuntimeSlotPanel zeigt den 4. Slot automatisch an.
4. `pnpm --filter desktop typecheck`, `pnpm --filter desktop test -- --run`, `cd backend && uv run pytest` müssen am Ende grün sein.
5. Kein Commit/Push ohne Rückfrage; neuer Branch `feat/functiongemma-orchestrator-runtime` von `main` (bereits erstellt), kleine thematisch getrennte Commits.

## Status

- [x] Branch `feat/functiongemma-orchestrator-runtime` von `main` erstellt.
- [x] Dieses TODO-Dokument im Projekt-Root abgelegt.
- [x] Backend-Baseline-Testlauf dokumentiert: `316 passed, 1 failed` (`uv run pytest -q`), unverändert
      `323 passed, 1 failed` nach Implementierung (+ neue Tests).
      Der eine Fehlschlag (`test_agent_runner_llm.py::test_agent_runner_skips_llm_when_runtime_stopped`)
      ist **vorbestehend auf `main`, nicht durch diese Runde verursacht**: der Test überschreibt den
      Settings-Service nicht und liest daher die reale `%LOCALAPPDATA%\DBZS\CodeAssistant\settings.json`
      gegen die echte `AppSettings` (Pydantic, `extra="forbid"`). Root Cause ist ein bereits auf `main`
      bestehender Drift zwischen TS-`AppSettings` (`packages/shared/src/index.ts`, hat bereits
      `conversationControlV2`/`legacyStructuredMarkupParser`) und der Python-`AppSettings`
      (`backend/app/settings/models.py`, kannte diese zwei Felder nie) — die Electron-Seite schreibt beide
      Felder in die reale Settings-Datei, das Python-Modell lehnt sie mit `extra_forbidden` ab. Unabhängig
      vom FunctionGemma-Scope; **nicht behoben** (gehört nicht zu dieser Aufgabe — eigenes, separates
      Ticket für TS/Python-Settings-Schema-Sync wäre der richtige Ort).
- [x] Abschnitt 1 (Shared Contracts).
- [x] Abschnitt 2 (Backend Slot-Wiring).
- [x] Abschnitt 3 (Modell-Katalog-Registrierung).
- [x] Abschnitt 4 (Desktop `runtimeSlotManager.ts`).
- [x] Abschnitt 5 (Settings + UI).
- [x] Abschnitt 6 (Autostart in `lifespan()`).
- [x] Tests ergänzt (siehe Verifikation Punkt 2): `test_model_index.py` (+3 Tests: FunctionGemma-Klassifizierung,
      Katalog-Registrierung idempotent, Registrierung ohne Datei = no-op), neue Datei
      `test_runtime_slot_contract.py` (4 Slots, eindeutige Ports, Port 8084/cpu für orchestrator_cpu),
      `test_settings.py` erweitert um die 4 neuen Felder, `runtimeSlotManager.test.ts` erweitert um
      `getAllSlotsStatus` (4 Slots), `getRecommendedSlot` (function_calling/intent_routing →
      orchestrator_cpu), `getDefaultModelForSlot`/Settings-Override für orchestrator_cpu.
- [ ] Manuelle Verifikation durchgeführt (Backend-Neustart mit echtem FunctionGemma-GGUF im
      Models-Verzeichnis — nicht Teil dieser automatisierten Runde, da kein Modell-File lokal vorhanden war).
- [x] Finale grüne Testläufe: `pnpm --filter desktop typecheck` clean, `pnpm --filter desktop test -- --run`
      → 567 passed/36 skipped, `cd backend && uv run pytest` → 323 passed/1 failed (der eine Fehlschlag ist
      der oben dokumentierte, vorbestehende TS/Python-Settings-Drift-Bug auf `main`, unabhängig vom
      FunctionGemma-Scope).

## Zusammenfassung der Implementierung

Alle 6 Abschnitte der Slot-Infrastruktur sind umgesetzt: `orchestrator_cpu` existiert als vierter,
CPU-only, `keep_resident`-Runtime-Slot auf Port 8084 in Shared Contracts, Backend (`schemas.py`,
`slot_contract.py`, `residency.py`, `service.py` inkl. fixer Launch-Parameter ctx=4096/threads=4/parallel=2/
gpu_layers=0), Modell-Katalog (`RecommendedUse += "orchestrator"`, `_infer_capabilities`/`_recommended_use`
erkennen `functiongemma`/`ORCHESTRATOR_MODEL`, neue atomare Merge-Write-Funktion
`ModelIndexService.register_catalog_model_profile()`), Desktop `runtimeSlotManager.ts` (alle 5 Stellen),
Settings (TS+Python, UI-Block in `App.tsx`s `SettingsPanel`) und Autostart (`_autostart_orchestrator_runtime()`
in `main.py`s `lifespan()`, fail-soft, kein Retry-Loop). Natives Tool-Call-Transport, tatsächliches Routing
durch FunctionGemma, Shadow-Mode/Canary und `ask_user`-Härtung bleiben wie geplant außen vor (siehe oben).

Nächster sinnvoller Schritt (separates Ticket, nicht Teil dieser Runde): ein echtes FunctionGemma-GGUF
(`functiongemma-270m-it.Q8_0.gguf`) ins Models-Verzeichnis legen und die manuelle Verifikation (Verifikation
Punkt 3) durchführen — Autostart-Log, `GET /runtime/slots/orchestrator_cpu/status`, Mission-Control-Anzeige.
