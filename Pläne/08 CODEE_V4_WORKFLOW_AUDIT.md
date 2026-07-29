# Codee v4 – Workflow-Audit zum Runtime-Chat

## Befund

Der Screenshot zeigt keinen vollständig abgeschlossenen Agentenlauf, sondern einen technisch erfolgreichen Tool-Aufruf ohne fachliche Endantwort.

Ablauf:

1. Nutzer: „Zähle alle GGUF Modelle im Workspace.“
2. Codee routet auf `Qwen2.5-VL-3B-Instruct.Q4_K_M`.
3. Allgemeiner Workspace-Kontext wird aufgebaut.
4. Das Modell erzeugt:
   `<CODEE_TOOL_CALL>{"name":"list_files","arguments":{"path":"/models","recursive":true}}</CODEE_TOOL_CALL>`
5. `list_files` läuft technisch erfolgreich.
6. Ergebnis: `[]`.
7. Der rohe Tool-Envelope bleibt als Assistant-Antwort sichtbar.
8. Das Tool-Ergebnis wird als Systemnachricht angehängt.
9. Es folgt kein Modellturn, der das Ergebnis interpretiert.
10. Trotzdem wird der Run als abgeschlossen behandelt.

## Hauptursachen im Repo

### 1. Transporterfolg wird noch als Zielerfolg akzeptiert

`runtimeRunFinalization.ts` sagt zwar ausdrücklich:

> Transport-/Streaming-Erfolg ≠ fachlich verwertbare Endantwort.

Die konkrete Prüfung `isValidFinalAnswer()` akzeptiert aber praktisch jeden nichtleeren Text. Ein reiner `<CODEE_TOOL_CALL>...</CODEE_TOOL_CALL>` ist damit formal eine „gültige Endantwort“.

### 2. Agent-Finalisierung setzt offene Tools pauschal auf null

In `runtimeChatStoreAgentTurnFinalization.ts` wird an `finalizeRuntimeRun()` übergeben:

```ts
pendingToolCalls: 0,
agentLoopCompleted: true
```

Damit kann die Abschlusslogik nicht mehr erkennen, dass der sichtbare Inhalt nur ein Tool-Aufruf war oder dass das Tool-Ergebnis noch nicht in eine Endantwort eingeflossen ist.

### 3. Systemmeldungen werden direkt in den Chat geschoben

`agentResult.systemMessages` werden nach der Assistant-Nachricht direkt an `resultMessages` angehängt. Deshalb erscheinen im Hauptchat:

- Stream-Artefakte
- Desktop-Tool-Ergebnis
- Analyse-Protokoll

Diese Informationen gehören in die Run-Details, nicht in die Unterhaltung.

### 4. Der gewählte Pfad ist semantisch falsch

Der Auftrag nennt den Workspace. Das Modell wählt jedoch `/models`.

Für Workspace-Tools muss Codee hostseitig erzwingen:

```text
path = "."
```

oder einen validierten relativen Workspacepfad. Absolute oder unbelegte Pfade dürfen nicht still ausgeführt werden.

### 5. Ungeeignetes Modell

Für eine reine Dateisystemabfrage wird ein Visionmodell gestartet. Ohne Bildinput ist das unnötig langsam und fachlich nicht besser.

## Richtiger Workflow für diese Anfrage

```text
Intent erkennen:
workspace_file_query

Parameter extrahieren:
extension = ".gguf"
scope = workspace_root
operation = count

Deterministisches Tool:
search_workspace_files(glob="**/*.gguf")

Host zählt Treffer.

Ergebnis validieren.

Natürliche Endantwort erzeugen.
```

Optimales Tool-Ergebnis:

```json
{
  "count": 3,
  "files": [
    "models/a.gguf",
    "models/b.gguf",
    "test/c.gguf"
  ]
}
```

Antwort:

```text
Im Workspace wurden 3 GGUF-Modelle gefunden.
```

## Benötigte Workflow-Klassen

### Deterministic Query

Für:

- Dateien zählen
- Dateinamen suchen
- Erweiterungen auflisten
- Ordnergrößen
- einfache Git-Abfragen

Kein großer Agentenloop:

```text
Intent → Read-only Tool → Host-Aggregation → Antwort
```

### Analysis

```text
Scope → Suche → relevante Dateien lesen → Evidence → Analyse → Antwort
```

### Planning

```text
Ziel klären → Kontext → Plan → Freigabe
```

### Implementation

```text
Task Contract → Plan → Dateien lesen → Patch → Diff → Tests → Abschluss
```

### Debugging

```text
Reproduktion → Logs → Hypothese → Beweis → Fix → Regressionstest
```

### Review

```text
Scope → Batches → Checks → Findings → Deduplizierung → Bericht
```

### Vision

Nur bei Bildinput:

```text
Vision Evidence → relevante Sourcefiles → Coder → Prüfung
```

## P0-Fixes

### A. Tool-Envelope darf keine Endantwort sein

```ts
function isToolOnlyAnswer(text: string): boolean
```

Wenn wahr:

```text
nicht als Assistant-Antwort anzeigen
Tool ausführen
Tool-Ergebnis in nächsten Turn einspeisen
```

### B. Completion Gate

```ts
interface CompletionGate {
  toolResultsConsumed: boolean;
  finalNaturalAnswerPresent: boolean;
  rawProtocolHidden: boolean;
  goalAddressed: boolean;
}
```

Nur bei allen `true`:

```text
outcome = success
```

### C. Workspacepfade erzwingen

Workspace-Tools akzeptieren ausschließlich normalisierte relative Pfade.

### D. Eigene Workspace-Suchtools

```text
search_workspace_files
count_workspace_files
find_workspace_text
```

Das Modell soll nicht riesige Dateilisten selbst filtern und zählen.

### E. Systemdiagnosen aus dem Hauptchat entfernen

Speichern als:

```text
Run → Technische Details
```

### F. Taskabhängiges Routing

```text
Dateiabfrage:
kein Visionmodell
kleiner Orchestrator oder vollständig deterministisch

Coding:
Coder-Modell

Bildanalyse:
Visionmodell
```

## Empfohlene PR-Reihenfolge

1. `fix(runtime-chat): reject tool-only content as final answer`
2. `feat(runtime): add deterministic workspace query workflow`
3. `refactor(chat): move technical system artifacts into run details`
4. `feat(runtime): add workflow capability routing`

## Schlussurteil

Codee kann das Tool bereits ausführen. Was fehlt, ist die verbindliche Workflow-Klammer:

```text
Tool auswählen
→ korrekt ausführen
→ Ergebnis konsumieren
→ Zielerfüllung prüfen
→ verständliche Antwort liefern
```

Aktuell endet der Lauf nach „Tool technisch erfolgreich“. Künftig darf er erst nach „Auftrag fachlich erledigt“ erfolgreich enden.
