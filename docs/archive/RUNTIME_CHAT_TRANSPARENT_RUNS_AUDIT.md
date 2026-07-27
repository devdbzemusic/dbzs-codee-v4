# Runtime Chat Transparent Runs Audit

**Datum:** 2026-06-22  
**Autor:** Codex Agent  
**Projekt:** DBZS CodeE

---

## 1. TypeScript-Fehler im `createChatRun()`-Aufruf

**Ort:** `apps/desktop/src/stores/runtimeChatStore.ts`, `sendMessage()`-Methode

**Fehler:** Der aktuelle Code verwendet `sendOptions`-Parameter, die nicht alle korrekt extrahiert werden:

```typescript
// Aktuelle Signatur in runtimeChatRunHelpers.ts:
export function createChatRun(
  userMessageId: string,
  mode: "auto" | "agent",
  profile: "ask" | "agent" | "full",
  contextEnabled: boolean,
  workspaceRoot?: string,
  activeFile?: string
): RuntimeChatRun
```

**Problem:** Im `sendMessage()`-Aufruf wird `profile` nicht korrekt aus `toolProfile` abgeleitet. Es existiert keine direkte Mapping-Logik zwischen `AgentToolProfile` und dem `"ask" | "agent" | "full"`-Enum.

**Zusätzlich:** `useSettingsStore` wird in `runtimeChatStore.ts` importiert, aber an einigen Stellen nicht konsistent verwendet.

---

## 2. Warum verschwindet der Run-Block nach Abschluss?

**Ort:** `apps/desktop/src/stores/runtimeChatStore.ts`

**Ursache:** In der `sendMessage()`-Methode wird `activeRun` nach Abschluss auf `null` gesetzt:

```typescript
set((state) => ({
  // ...
  activeRun: null,
  historicalRuns: lastActiveRun ? { ...state.historicalRuns, [lastActiveRun.id]: lastActiveRun } : state.historicalRuns
}));
```

**Problem:** Der `CodeeRunLiveBlock` wird in `RuntimeChatTab.tsx` nur für `activeRun` gerendert, nicht für `historicalRuns`:

```tsx
{activeRun && (
  <CodeeRunLiveBlock
    run={activeRun}
    onCancel={cancelSend}
    isSending={isSending}
  />
)}
```

**Folge:** Abgeschlossene Runs verschwinden aus der UI, obwohl sie in `historicalRuns` gespeichert sind.

---

## 3. Verbindung zwischen User-Nachricht, Run und Assistant-Nachricht

**Aktuelle Struktur:**

```typescript
// RuntimeChatRun (shared/src/index.ts)
export interface RuntimeChatRun {
  id: string;
  userMessageId: string;  // ✓ vorhanden
  assistantMessageId?: string;  // ✓ vorhanden, aber nicht befüllt
  // ...
}

// RuntimeChatMessage (shared/src/index.ts)
export interface RuntimeChatMessage {
  role: ChatRole;
  content: string;
  runId?: string;  // ✓ vorhanden, aber nicht befüllt
  // ...
}
```

**Problem:** Die IDs werden zwar erzeugt, aber nicht konsistent gesetzt:

1. `userMessageId` wird beim Erstellen des Runs gesetzt ✓
2. `assistantMessageId` wird **nicht** gesetzt ✗
3. `runId` wird in den Nachrichten **nicht** gesetzt ✗

**Folge:** Die Zuordnung erfolgt implizit über die Reihenfolge, nicht über stabile IDs.

---

## 4. Warum werden `turns` und `commands` nicht befüllt?

**Ort:** `apps/desktop/src/stores/runtimeChatStore.ts` und `apps/desktop/src/services/runtimeChatRunHelpers.ts`

**Ursache:**

- `turns: RuntimeChatTurn[]` wird initial als leeres Array angelegt
- `commands: RuntimeChatCommand[]` wird initial als leeres Array angelegt
- Es gibt **keine Logik**, die diese Arrays während des Run-Lifecycles befüllt

**Fehlende Integration:**

- `agentTurnEngine.ts` erzeugt Turns, aber aktualisiert nicht den Run
- Tool Calls werden in `message.toolCalls` gespeichert, nicht in `run.toolCalls`
- Commands (Shell-Befehle) werden nirgends erfasst

---

## 5. Warum zeigt jedes Event ein grünes Häkchen?

**Ort:** `apps/desktop/src/components/chat/CodeeRunLiveBlock.tsx`

**Ursache:** Die Event-Darstellung verwendet keine statusbasierte Symbollogik:

```tsx
// Aktuelle Darstellung (vereinfacht):
run.events.map((event) => (
  <div>{event.message}</div>  // Kein Status-Symbol
))
```

**Fehlende Logik:**

- Keine Unterscheidung zwischen `started`, `completed`, `failed`, `cancelled`
- Keine Dauer-Anzeige pro Event
- Keine visuelle Hierarchie (aktiv vs. abgeschlossen)

---

## 6. Warum ist die Diff-Darstellung kein echter Diff?

**Ort:** `apps/desktop/src/components/chat/CodeeRunLiveBlock.tsx`

**Aktuelle Darstellung:**

```tsx
{change.status === "proposed" && (
  <div className="mt-2.5 flex items-center gap-2">
    <button onClick={() => handleOpenDiff(change.filePath)}>
      Diff anzeigen
    </button>
    // ...
  </div>
)}
```

**Problem:**

- `RuntimeChatFileChange.diff` enthält einen String, aber dieser wird **nicht gerendert**
- Es gibt keinen Unified-Diff-Viewer im Run-Block
- `handleOpenDiff` öffnet nur die Datei im Editor, zeigt aber keinen Diff-Vergleich

**Fehlende Integration:**

- Kein Diff-Editor-Component im Run-Kontext
- `additions`/`deletions` werden angezeigt, aber der eigentliche Diff-Inhalt nicht

---

## 7. Warum ist der aktuelle Abbruch nicht requestbezogen?

**Ort:** `apps/desktop/src/stores/runtimeChatStore.ts`

**Aktueller Code:**

```typescript
let activeSendAbort: AbortController | null = null;

// In sendMessage():
if (activeSendAbort) {
  activeSendAbort.abort();
  activeSendAbort = null;
}

activeSendAbort = new AbortController();
```

**Problem:**

- Es gibt nur **einen globalen** `activeSendAbort` für den gesamten Chat
- Bei mehreren parallelen Requests würde der erste Abbruch alle betreffen
- Der Abort wird nicht pro Run gespeichert

**Fehlende Struktur:**

```typescript
// Sollte sein:
runsAbortControllers: Record<string, AbortController>
```

---

## 8. Warum kann ein echter Abbruch als normaler Fehler erscheinen?

**Ort:** `apps/desktop/src/stores/runtimeChatStore.ts`, Error-Handling

**Aktueller Code:**

```typescript
if (error instanceof Error && error.name === "AbortError") {
  failStep("llm-request", "Modell-Anfrage senden", "Abgebrochen");
  updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "cancelled"), "chat.cancelled", "Abgebrochen"));
  // ...
  return false;
}
```

**Problem:**

- Der `AbortError` wird korrekt behandelt ✓
- ABER: Andere Transportfehler (z.B. `AbortError` vom Backend) werden nicht immer erkannt
- Die Fehlermeldung erscheint im Chat als Assistant-Nachricht statt als Fehlerkarte

**Fehlende Logik:**

```typescript
// Fehler wird in error state gespeichert, aber nicht als Run-Error:
set({ error: "Verbindung zum Backend war kurz unterbrochen..." })
```

---

## 9. Welche Timeouts fehlen?

**Fehlende Implementierung:**

1. **First-Token-Timeout:** Keine Logik, die prüft, ob nach X Sekunden das erste Token kommt
2. **Gesamt-Timeout:** Keine Logik, die die Gesamtdauer eines Runs begrenzt

**Ort für Implementierung:**

- `apps/desktop/src/services/runtimeChatStreamClient.ts`
- `apps/desktop/src/stores/runtimeChatStore.ts`

**Benötigte Logik:**

```typescript
// First-Token-Timeout
const firstTokenTimeout = setTimeout(() => {
  if (!hasFirstToken) {
    abortController.abort();
    updateRunStatus(run, "timeout");
  }
}, FIRST_TOKEN_TIMEOUT_MS);

// Gesamt-Timeout
const totalTimeout = setTimeout(() => {
  abortController.abort();
  updateRunStatus(run, "timeout");
}, TOTAL_TIMEOUT_MS);
```

---

## 10. Wo werden Transportfehler als künstliche Assistant-Antwort ausgegeben?

**Ort:** `apps/desktop/src/stores/runtimeChatStore.ts`

**Aktuelles Pattern:**

```typescript
// Im Error-Handler:
set({
  error: "Verbindung zum Backend war kurz unterbrochen. Bitte Nachricht erneut senden.",
  messages: (() => {
    const current = get().messages;
    const last = current.at(-1);
    if (last?.role === "assistant" && last.content.trim().length === 0) {
      return current.slice(0, -1);
    }
    return current;
  })(),
  // ...
});
```

**Problem:**

- Die Fehlermeldung wird im `error`-State gespeichert (UI zeigt Toast/Banner)
- ABER: In manchen Pfaden wird eine leere Assistant-Nachricht erzeugt
- Diese leere Nachricht bleibt im Chatverlauf

**Besser:**

- Fehler sollten als `RuntimeChatError` im Run gespeichert werden
- Keine Assistant-Nachricht bei Fehlern erzeugen
- Fehlerkarte im Run-Block rendern

---

## Zusammenfassung der Defekte

| # | Defekt | Schwere | Dateien betroffen |
|---|--------|---------|-------------------|
| 1 | TypeScript-Fehler bei `createChatRun()` | Hoch | `runtimeChatStore.ts`, `runtimeChatRunHelpers.ts` |
| 2 | Run-Block verschwindet nach Abschluss | Hoch | `RuntimeChatTab.tsx`, `CodeeRunLiveBlock.tsx` |
| 3 | Fehlende stabile IDs für Nachrichten/Runs | Mittel | `shared/src/index.ts`, `runtimeChatStore.ts` |
| 4 | `turns` und `commands` leer | Mittel | `runtimeChatRunHelpers.ts`, `agentTurnEngine.ts` |
| 5 | Events zeigen falsche Status | Niedrig | `CodeeRunLiveBlock.tsx` |
| 6 | Diff-Darstellung unvollständig | Mittel | `CodeeRunLiveBlock.tsx`, `editorStore.ts` |
| 7 | Abbruch nicht requestbezogen | Hoch | `runtimeChatStore.ts` |
| 8 | Abbruch vs. Fehler unklar | Mittel | `runtimeChatStore.ts` |
| 9 | Fehlende Timeouts | Hoch | `runtimeChatStreamClient.ts`, `runtimeChatStore.ts` |
| 10 | Transportfehler als Assistant-Nachricht | Hoch | `runtimeChatStore.ts` |

---

## Empfohlene Priorisierung

**Phase 1 (Kritisch):**
1. TypeScript-Fehler beheben (Typecheck muss grün sein)
2. Request-bezogener Abbruch
3. First-Token-Timeout + Gesamt-Timeout
4. Transportfehler als Fehlerkarte

**Phase 2 (Hoch):**
5. Run-Persistenz im Chatverlauf
6. Stabile IDs für Nachrichten/Runs
7. Turns und Commands befüllen

**Phase 3 (Mittel):**
8. Echte Diff-Darstellung
9. Event-Statussymbole korrigieren

---

## Nächste Schritte

Gemäß Aufgabenstellung muss **vor der Implementierung** sichergestellt werden:

1. ✅ Dieses Audit liegt vor
2. ⏳ `pnpm typecheck` muss ausgeführt werden
3. ⏳ TypeScript-Fehler müssen behoben werden
4. ⏳ Dann erst Implementierung beginnen
