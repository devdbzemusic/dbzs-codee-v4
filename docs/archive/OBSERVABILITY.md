# DBZS Observability-System

## Übersicht

Das Observability-System ermöglicht die vollständige Nachverfolgung von Runtime-Chat-Sessions, Agenten-Handoffs, Tool-Aufrufen und Context-Verwendung im DBZS Codee-Projekt.

## Problemstellung

Bisher gab es keine Möglichkeit nachzuvollziehen:
- Welcher Kontext wurde bei einer Chat-Anfrage verwendet?
- Welche Agenten waren beteiligt?
- Welche Tools wurden ausgeführt?
- Wie kam eine Entscheidung zustande?

## Lösung

Ein umfassendes Tracking-System mit folgenden Komponenten:

### 1. Typen und Interfaces (`chatSessionTrace.ts`)

**Core-Typen:**

| Typ | Beschreibung |
|-----|-------------|
| `ChatSessionTrace` | Komplette Session mit allen Nachrichten, Metadaten und Events |
| `ContextProof` | Dokumentiert exakt welche Kontextdaten verwendet wurden |
| `AgentHandoffLog` | Protokolliert Agenten-Übergaben mit Grund und Ergebnis |
| `ToolExecutionLog` | Zeichnet jeden Tool-Aufruf mit Input/Output auf |

**Wichtige Funktionen:**
- `createTraceId()` – Generiert eindeutige IDs
- `createContextProof()` – Erstellt Context-Nachweis
- `createAgentHandoffLog()` – Erstellt Handoff-Log
- `createToolExecutionLog()` – Erstellt Tool-Log
- `sanitizeInputForLogging()` – Entfernt Secrets aus Logs

### 2. ObservabilityService (`observabilityService.ts`)

Zentrales Service für:
- **Persistente Speicherung** im localStorage (max. 100 Sessions)
- **Event-Handling** für alle Observability-Events
- **Export-Funktionen** für JSON-Downloads
- **Statistiken** über alle Sessions

**Wichtige Methoden:**
```typescript
// Initialisierung
await observabilityService.initialize();

// Event-Listener registrieren
const unsubscribe = observabilityService.onEvent((event) => {
  console.log("Event:", event);
});

// Traces abrufen
const traces = observabilityService.getAllTraces();
const trace = observabilityService.getTrace(sessionId);

// Export
const json = observabilityService.exportTrace(sessionId);
const allJson = observabilityService.exportAllTraces();

// Statistik
const stats = observabilityService.getStatistics();
```

### 3. Runtime-Chat Integration (`runtimeChatObservability.ts`)

Integrationsschicht zwischen Store und Observability:

```typescript
// Session starten
const sessionId = startChatSession(workspaceRoot, targetAgent, firstMessage);

// Context-Proof erstellen
captureContextProof(sessionId, {
  workspaceRoot,
  workspaceName,
  activeFile,
  sampledFiles,
  fileTree,
  contextMentions,
  enabledSkillIds,
  toolProfile
});

// Agent-Handoff erfassen
captureAgentHandoff(sessionId, {
  fromAgent: "user",
  toAgent: "planner",
  reason: "Complex task requires planning",
  inputSummary: "Refactor the auth module"
});

// Tool-Aufruf erfassen
captureToolExecutionStart(sessionId, {
  toolName: "run_terminal_command",
  input: { command: "npm test" },
  turn: 1
});

// Session beenden
finishChatSession(sessionId, "completed");
```

### 4. TraceViewer-Komponente (`RuntimeChatTraceViewer.tsx`)

UI-Komponente zur Inspektion der gesammelten Daten:

**Features:**
- Sessions-Liste mit Status und Metadaten
- Context-Proofs mit Dateiliste und Mentions
- Agent-Handoffs mit Gründen und Ergebnissen
- Tool-Execution-Logs mit Input/Output
- Statistiken und Export-Funktionen

**Verwendung:**
```tsx
import { RuntimeChatTraceViewer } from "@/components/RuntimeChatTraceViewer";

// Im App-Layout einbinden
<RuntimeChatTraceViewer onClose={() => setShowTraceViewer(false)} />
```

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                    Runtime Chat Store                        │
│  (sendMessage, runAgentChatTurnLoop, tool execution)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              runtimeChatObservability.ts                     │
│  (startChatSession, captureContextProof, etc.)              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 observabilityService.ts                      │
│  (handleEvent, persistTrace, getStatistics)                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    localStorage                              │
│  (dbzs-observability-traces-index, dbzs-observability-*)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              RuntimeChatTraceViewer.tsx                      │
│  (UI zur Inspektion und Export)                             │
└─────────────────────────────────────────────────────────────┘
```

## Events

Das System emittiert folgende Event-Typen:

| Event-Typ | Beschreibung |
|-----------|-------------|
| `chat_session_started` | Neue Session beginnt |
| `chat_message_sent` | Nachricht wird gesendet |
| `context_proof_created` | Context-Proof wurde erstellt |
| `agent_handoff_initiated` | Agent-Handoff startet |
| `agent_handoff_completed` | Agent-Handoff abgeschlossen |
| `tool_execution_started` | Tool-Aufruf beginnt |
| `tool_execution_completed` | Tool-Aufruf abgeschlossen |
| `chat_session_finished` | Session beendet |

## Datenschutz

Das System beachtet folgende Sicherheitsregeln:

1. **Keine Secrets**: API-Keys, Tokens, Passwörter werden automatisch entfernt
2. **Content-Capping**: Lange Inhalte werden gekappt (max. 500-2000 Zeichen)
3. **Content-Hashes**: Datei-Inhalte werden nur als Hash gespeichert
4. **Manuelle Löschung**: User kann alle Traces löschen

## Statistiken

Das System berechnet folgende Metriken:

- Gesamte Sessions
- Aktive Sessions
- Abgeschlossene Sessions
- Fehlgeschlagene Sessions
- Tool-Aufrufe gesamt
- Agent-Handoffs gesamt
- Durchschnittliche Session-Dauer

## Erweiterung

### Eigene Observability-Events hinzufügen

```typescript
// In chatSessionTrace.ts neuen Event-Typ definieren
export type ObservabilityEvent =
  | { type: "chat_session_started"; trace: ChatSessionTrace }
  | { type: "custom_event"; sessionId: string; data: unknown };

// In observabilityService.ts Handler hinzufügen
handleEvent(event: ObservabilityEvent): void {
  this.emitEvent(event);
  switch (event.type) {
    case "custom_event":
      // Custom logic
      break;
  }
}
```

### TraceViewer erweitern

Neue Tabs oder Detailansichten in `RuntimeChatTraceViewer.tsx` hinzufügen.

## Dateiliste

```
apps/desktop/src/runtime/observability/
├── index.ts                    # Export-Schnittstelle
├── chatSessionTrace.ts         # Typen und Factory-Funktionen
├── observabilityService.ts     # Zentrales Service
└── agentTrajectory.ts          # Agent-Trajectory (bereits vorhanden)

apps/desktop/src/services/
└── runtimeChatObservability.ts # Integrationsschicht

apps/desktop/src/stores/
└── runtimeChatStore.ts         # Integriert Observability

apps/desktop/src/components/
└── RuntimeChatTraceViewer.tsx  # UI-Komponente

docs/
└── OBSERVABILITY.md            # Diese Dokumentation
```

## Nächste Schritte

1. **TraceViewer in App einbinden**: Button im Runtime-Chat-Panel hinzufügen
2. **Backend-Integration**: Observability auch für Backend-Calls aktivieren
3. **Export-Formate**: CSV, Markdown zusätzlich zu JSON
4. **Suchfunktion**: Traces nach Inhalt durchsuchen
5. **Retention-Policy**: Automatische Löschung alter Traces

## Troubleshooting

### Traces werden nicht gespeichert
- localStorage verfügbar prüfen (Incognito-Mode blockiert manchmal)
- Browser-Konsole auf Fehler prüfen

### Zu wenig Speicher
- Max. Sessions in `observabilityService.ts` anpassen (MAX_TRACES)
- Alte Traces manuell löschen über TraceViewer

### Performance-Probleme
- TraceViewer nur bei Bedarf laden
- Event-Listener korrekt unsubscriben

---

*Erstellt: 2026-06-21*
*DBZS – Division By Zeros*
