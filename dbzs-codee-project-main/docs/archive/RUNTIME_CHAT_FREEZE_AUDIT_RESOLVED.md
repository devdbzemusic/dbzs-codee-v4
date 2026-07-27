# Hinweis: Dieser Bug (fehlendes AbortSignal, keine Frontend-Timeouts) ist mittlerweile behoben — AbortController + Gesamt-Timeout sind in runtimeChatStore.ts implementiert. Archiviert am 2026-07-25.
# RUNTIME CHAT FREEZE AUDIT

Dieses Dokument dokumentiert die Detailanalyse der aktuellen Schwachstellen im Runtime Chat System von DBZS Codee, welche zum "Frieren" der Oberfläche, unvollständigen Abbrüchen und fehlenden Timeouts führen.

---

## 1. Wann wird `isSending` gesetzt?
`isSending` wird erst in `apps/desktop/src/stores/runtimeChatStore.ts` innerhalb der Methode `sendMessage` auf `true` gesetzt (Zeile 429). Da jedoch in `apps/desktop/src/components/RuntimeChatTab.tsx` die Composer-Eingabe erst im `.then()` des asynchronen `sendMessage` gelöscht wird:
```typescript
const sent = await sendMessage(...);
if (sent) {
  setDraft("");
  setShowPanels(true);
}
```
bleibt der Text bis zum vollständigen Empfang der Antwort im Eingabefeld stehen.

## 2. Wann wird die User-Nachricht in den Chat eingefügt?
Die User-Nachricht wird erst nach mehreren sequenziellen Vorstufen in das `messages`-Array eingetragen (ca. Zeile 718 in `runtimeChatStore.ts`):
```typescript
const userMessage: RuntimeChatMessage = { role: "user", content: trimmedContent };
const nextMessages = [...get().messages, userMessage];
set({ messages: nextMessages });
```
Zuvor laufen bereits:
1. `refreshRuntimeStatus` (bis zu 3 Versuche mit Pausen)
2. `agentRunService.resolveRouting` (Scannen aller Modelle und Provider)
3. `bootstrapRuntimeLayer` (Initialisierung)
4. Context 준비 (Signals ranking & prepareContext)
5. Sequenzielles Einlesen von Workspace-Dateien via `buildWorkspaceContext`

Dies führt dazu, dass die Nachricht für den Nutzer oft sekundenlang gar nicht im Chatfenster auftaucht.

## 3. Welche Schritte laufen vor dem eigentlichen Modellrequest?
1. **Runtime-Prüfung**: Status via `getRuntimeStatus()` abholen.
2. **Modell-Routing**: Bestimmung des optimalen Modells via `resolveRouting()`, was ggf. Cloud- und lokale Provider-Registrys aktualisiert.
3. **Kontext vorbereiten**: Orchestrierung, Signalranking und Einlesen von Workspace-Dateien via `buildWorkspaceContext`.
4. **Desktop-Tools & Indexe**: List-Files-Abfragen, SQLite-Memory-Abfragen und Code-Index-Suche.

## 4. Wo wird `AbortSignal` nicht weitergereicht?
- In `apps/desktop/src/services/runtimeChatStreamClient.ts` unter `streamRuntimeChat`: Das Argument `signal` wird hier nicht einmal als Parameter akzeptiert oder an `backendClient.streamRuntimeChat` übermittelt.
- In `electron/preload.ts`: `streamRuntimeChat` nimmt kein `signal` entgegen und `ipcRenderer.invoke("dbzs:runtime:chat-stream")` hat keine Möglichkeit, abgebrochen zu werden.
- In `electron/main.ts` existiert im Handler `"dbzs:runtime:chat-stream"` kein Signal oder Tracker, um den gestarteten Node-Fetch zum Backend bei einem Client-Abbruch zu stoppen.
- In allen Vorverarbeitungsschritten wie `buildWorkspaceContext` und Orchestrierungsaufrufen gibt es keinen Check auf `signal?.aborted`.

## 5. Welche Timeouts existieren tatsächlich?
Es existiert standardmäßig nur ein Backend-Timeout von 300 Sekunden (`DBZS_RUNTIME_CHAT_TIMEOUT_SECONDS`) für HTTP-Anfragen. Im Frontend/Electron-Prozess gibt es absolut **keine Timeouts** für Routing, Kontextaufbau, First-Token oder den Gesamt-Stream. Jede Blockade dort lässt die App unendlich hängen.

## 6. Wann wird der Agent-Turn-Loop aktiviert?
In `runtimeChatStore.ts` wird `useTurnLoop` wie folgt bestimmt:
```typescript
const useTurnLoop = sendOptions?.useAgentTurnLoop ?? shouldUseAgentTurnLoop(toolsEnabled, profile, effectiveAgent, sendOptions?.agentMode === "agent");
```
`shouldUseAgentTurnLoop` in `runtimeChatAgentConfig.ts` liefert `true` zurück, wenn `profile === "agent" || profile === "full"`. 

## 7. Warum aktiviert `Full` auch im Auto-Modus den kompletten Agentenloop?
Weil `shouldUseAgentTurnLoop` im Falle von `profile === "full"` (entspricht dem Status "Full" im UI) immer `true` liefert, solange `toolsEnabled` aktiv ist. Es gibt keine Unterscheidung, ob der Modus auf `Auto` oder `Agent` steht oder ob ein einfacher Chat-Intent vorliegt.

## 8. Wie wird Runtime-Readiness derzeit bestimmt?
Lediglich über `runtimeStatus.state === "running"`. Der Backend-Service prüft in `status()` nur, ob das Handle des gestarteten Prozesses noch aktiv/nicht terminiert ist (`self._process.poll() is None`). Ob der `llama-server` intern läuft, ob er die Weights erfolgreich geladen hat oder ob der HTTP-Endpoint überhaupt antwortet, wird **nicht** tiefergehender validiert.

## 9. Welche Stelle kann minutenlang blockieren?
1. **`buildWorkspaceContext()`**: Liest alle passenden Dateien sequenziell ohne Abbruchprüfung ein.
2. **`requestAssistantResponse()` / `llama-server`**: Die HTTP-Verbindung blockiert bis zu 5 Minuten, wenn das GGUF-Modell überlastet ist oder der Host-RAM swappt.
3. **`refreshModels` / `resolveRouting`**: Bei Verzug im Netzwerk oder langsamen IO-Anfragen bei entfernten Providern.

## 10. Welche Tests良 (fehlen)?
Es fehlen automatisierte Tests für:
- Sofortiges Update der UI (`messages`) beim Absenden.
- Trivial/Non-Agent Fast-Path.
- Echtes Durchreichen der Stopp/Abbruchkette vom UI-Event-Controller über die IPC-Kanäle bis zum Fetch im Electron Main-Prozess.
- First-Token-Timeout-Erkennung für stockende Streams.
- Echte Readiness-Checks des llama-servers.
