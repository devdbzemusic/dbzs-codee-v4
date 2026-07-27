# Conversation Control V2

## Zweck

Dieses Dokument beschreibt die Zielarchitektur fuer den Runtime-Chat-Pfad in CODEE.
Der Schwerpunkt liegt auf einer robusten Trennung zwischen sichtbarem Chattext,
strukturierter Aktionsauswertung und eventbasierter Freigabe.

## Root Cause im Altpfad

Der bisherige Control Layer vermischt mehrere Verantwortungen:

- Streaming-Textaufbau
- XML-/JSON-Heuristik waehrend des Streams
- Action-Erkennung im freien Chattext
- Approval-Rendering
- Approval-Resume per Polling

Das fuehrt besonders bei kleinen lokalen Modellen zu:

- zerstoertem oder gekuerztem Chattext
- flackernden UI-Zustaenden
- fragilen Partial-Parse-Pfaden
- doppelten Approval-Quellen
- langsamer oder unzuverlaessiger Fortsetzung

## Zielprinzip

```text
Chattext bleibt Chattext.
Ausfuehrbare Aktionen werden als separate strukturierte Events behandelt.
```

## Zielmodell

`RuntimeChatMessage` fuehrt drei Ebenen parallel:

- `rawContent`: unveraenderte Modellantwort
- `visibleContent`: menschenlesbarer Chattext fuer die UI
- `reasoningSummary`: optionale sichere Zusammenfassung

Strukturierte Aktionen leben separat als `AgentAction` und werden ueber
`actionIds` mit einer Chatnachricht verknuepft.

`message.actions` bleibt nur als Transport- und Interaktionsmaterial fuer die
konkreten UI-Buttons erhalten. Der kanonische Laufzeitstatus liegt in
`agentActionsById` plus `message.actionIds`.

## AgentAction V2

V2 verwendet eine zentrale Union:

- `plan`
- `patch`
- `command`
- `web`

Alle Varianten teilen:

- `id`
- `runId`
- `version`
- `riskLevel`
- `state`

## Streaming-Regeln

Waerend des Streams ist nur erlaubt:

- `rawContent` anhaengen
- `visibleContent` throttled aktualisieren
- Stop/Abort bedienen

Waerend des Streams ist nicht erlaubt:

- strukturelles JSON-/XML-Parsing
- Action-Erkennung aus Fragmenten
- Partial-JSON-Reparatur
- Approval-Erzeugung

Die strukturierte Auswertung erfolgt genau einmal nach `stream completed`.

## Approval-Modell

V2 fuehrt einen zentralen `ApprovalCoordinator` ein.

Verantwortung:

- Action registrieren
- Status pflegen
- Benutzerentscheidung entgegennehmen
- wartende Fortsetzung aufloesen
- stale oder abgebrochene Aktionen bereinigen

Die UI darf nur auf diese API zugreifen und keine eigene Ausfuehrungslogik
oder Polling-Schleifen enthalten.

## Legacy-Pfade hinter Flags

Folgende Altmechanismen bleiben vorerst erhalten, werden aber logisch von V2
abgetrennt:

- heuristische Planerkennung
- XML-Reasoning-Zwang
- Partial-JSON-Reparatur
- Parsing auf jedem Streaming-Delta
- Polling-basierte Approval-Fortsetzung
- implizite Action-Erkennung aus freiem Chattext

Aktive Basis-Flags:

```ts
conversationControlV2: true
legacyStructuredMarkupParser: false
```

## Einfuehrungsreihenfolge

1. Shared Contracts und Flags
2. Streaming-Pfad entkoppeln
3. finalen Action-Decoder einfuehren
4. ApprovalCoordinator einziehen
5. eventbasiertes Resume aktivieren
6. Kontextbudget und Tool-Output-Layer umstellen
7. E2E- und Performance-Tests absichern

## Betroffene Kernstellen

- `packages/shared/src/index.ts`
- `apps/desktop/src/stores/runtimeChatStore.ts`
- `apps/desktop/src/services/assistantPayloadParser.ts`
- `apps/desktop/src/services/runtimeChatAgentRunner.ts`
- `apps/desktop/src/services/approvalHub.ts`
- `apps/desktop/src/stores/runtimeChatApprovalStore.ts`
- `apps/desktop/src/components/RuntimeChatApprovals.tsx`
- `apps/desktop/src/components/RuntimeChatTab.tsx`
