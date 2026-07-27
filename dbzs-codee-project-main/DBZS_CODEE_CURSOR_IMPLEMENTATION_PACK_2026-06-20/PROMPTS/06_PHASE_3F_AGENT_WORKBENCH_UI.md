# Cursor Auftrag — Phase 3F: Agent Workbench UI

## Voraussetzung

Backend-Loop aus 3A–3E funktioniert per API und Tests.

## Ziel

Eine kohärente Oberfläche für den bereits funktionierenden Run.

Keine Cursor-Kopie.

## Neue Komponenten

```text
apps/desktop/src/components/agent-workbench/
  AgentWorkbench.tsx
  AgentRunList.tsx
  AgentRunHeader.tsx
  AgentPlanChecklist.tsx
  AgentActivityStream.tsx
  AgentReviewDock.tsx
  AgentOutputDock.tsx
  AgentFollowUpComposer.tsx
  AgentStatusBar.tsx
```

Stores/Services:

```text
apps/desktop/src/stores/agentWorkbenchStore.ts
apps/desktop/src/services/agentWorkbenchService.ts
apps/desktop/src/services/agentWorkbenchSse.ts
```

## Integration

- neuer OperationsNotebook-Tab `agent-workbench`
- Workspace Explorer bleibt links
- Editor bleibt zentral verfügbar
- rechte alte Agenten-Panels nicht weiter aufblähen
- Click auf Datei öffnet Editor
- Click auf Patch öffnet Diff
- SSE reconnect
- Pause/Resume/Stop
- Review
- Outputfilter
- Problems

## Legacy

- `AutonomousSessionPanel` als Legacy markieren
- direkte Apply-Wege entfernen oder deaktivieren
- `ReviewGatePanel` auf Workbench verlinken
- JobMonitor kann Run-ID anzeigen

## Tests

- Run anzeigen
- Steps aktualisieren
- Eventstream
- SSE reconnect
- Review Approve/Reject
- Editor Jump
- Stop/Pause/Resume
- Fehlerzustände
