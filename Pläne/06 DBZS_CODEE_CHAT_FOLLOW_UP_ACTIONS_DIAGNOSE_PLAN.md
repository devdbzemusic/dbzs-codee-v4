# DBZS Codee V4 – Diagnose: Warum der Chat keine Weiterführen-Aktionen anbietet

**Prüfdatum:** 2026-07-28  
**Repository:** `devdbzemusic/dbzs-codee-v4`

## Ergebnis

Das Verhalten ist kein einzelner Darstellungsfehler.

Die aktuelle Chat-Architektur erzeugt bei normalen Assistentenantworten grundsätzlich keine kontextbezogenen Folgeaktionen.

Deshalb erscheint unabhängig vom Antwortergebnis meistens nichts wie:

- Weiter
- Nächsten Schritt ausführen
- Plan umsetzen
- Tests starten
- Ergebnis prüfen
- Fehler beheben
- Vertiefen
- Erneut versuchen

## Hauptursache 1 – Keine generische Post-Response-Aktionserzeugung

`RuntimeChatMessageCard` zeigt nur Aktionen an, die bereits in:

```ts
message.actions
```

vorhanden sind.

Die Komponente erzeugt selbst keine Folgeaktionen.

Die aktuelle Action-Infrastruktur wird hauptsächlich befüllt für:

- Patch freigeben oder ablehnen
- Diff anzeigen
- Rollback
- Tests nach einem angewendeten Patch
- Terminalfreigaben
- Webfreigaben
- Rückfragen
- Review-Artefakte und Review-Findings

Eine normale erfolgreiche Chatantwort bekommt dagegen typischerweise:

```ts
actions: undefined
```

oder:

```ts
actions: []
```

Folge:

```text
keine Actions
→ kein Action-Block
→ keine Weiterführen-Schaltflächen
```

## Hauptursache 2 – `confirm_continue` ist zu eng verwendet

Der Action-Typ `confirm_continue` existiert.

Er wird aktuell aber praktisch nur nach einem erfolgreich angewendeten Patch für:

```text
Tests starten
```

erzeugt.

Er wird nicht automatisch nach normalen Chat-, Analyse-, Planungs-, Coding- oder Debug-Antworten erzeugt.

Der Name klingt allgemein, die Implementierung ist aber workflow-spezifisch.

## Hauptursache 3 – Erfolgreiche Run-Blöcke werden meist ausgeblendet

`RuntimeChatConversationFeed.shouldRenderInlineRun()` rendert einen abgeschlossenen erfolgreichen Run nur, wenn mindestens ein Sonderfall zutrifft:

```text
degraded
repositoryReview
nicht erfolgreich
noch aktiv
```

Ein normal erfolgreich abgeschlossener Chat- oder Agent-Run wird daher nicht als `CodeeRunLiveBlock` unter der Nachricht dargestellt.

Selbst wenn dort später allgemeine Folgeaktionen ergänzt würden, wären sie bei normalen Erfolgsfällen nicht sichtbar.

## Hauptursache 4 – Der einzige allgemeine „Next“-Knopf ist versteckt

Im Runtime Chat gibt es bereits den Preset-Button:

```text
Next
```

Er sendet:

```text
Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.
```

Dieser Button befindet sich jedoch im geschlossenen Bereich:

```text
Schnellaktionen & erweiterte Optionen
```

Er ist:

- nicht an die konkrete letzte Antwort gekoppelt
- kein dynamisches Folgeangebot
- standardmäßig nicht sichtbar
- nur ein weiterer Prompt

Das erklärt, warum der Chat subjektiv immer „einfach endet“.

## Hauptursache 5 – Review-Folgeaktionen sind ein Sonderweg

`CodeeRunLiveBlock` bietet nach einem Repository Review beispielsweise:

- Report öffnen
- Findings öffnen
- Artefaktordner öffnen
- Findings beheben
- Review erneut ausführen

Diese Actions funktionieren nur, weil `run.repositoryReview` vorhanden ist.

Für normale Ergebnisse gibt es kein entsprechendes generisches Abschlussmodell.

---

# Technisch korrekte Lösung

## 1. Zentralen Post-Response Action Builder einführen

Neue Datei:

```text
apps/desktop/src/services/runtimeChatFollowUpActions.ts
```

Beispielvertrag:

```ts
export type FollowUpActionKind =
  | "continue_task"
  | "implement_plan"
  | "run_tests"
  | "inspect_result"
  | "fix_errors"
  | "show_next_steps"
  | "retry"
  | "start_review"
  | "open_file"
  | "new_task";

export interface FollowUpActionContext {
  message: RuntimeChatMessage;
  run: RuntimeChatRun | null;
  taskType: RuntimeTaskType | null;
  workflowKind?: string | null;
  workflowPhase?: string | null;
  outcome?: RuntimeRunOutcome | null;
  hasPlanProposal: boolean;
  hasPatchProposal: boolean;
  hasErrors: boolean;
  workspaceRoot: string | null;
}

export function buildFollowUpActions(
  context: FollowUpActionContext
): ChatActionRequest[];
```

## 2. Actions deterministisch aus dem Run-Ergebnis ableiten

Nicht das Sprachmodell frei entscheiden lassen.

### Normaler Chat

```text
[Vertiefen]
[Nächste Schritte]
[Neue Aufgabe]
```

### Plan erstellt

```text
[Plan umsetzen]
[Plan anpassen]
[Neue Aufgabe]
```

### Analyse abgeschlossen

```text
[Empfehlung umsetzen]
[Betroffene Dateien prüfen]
[Nächste Schritte]
```

### Fehler gefunden

```text
[Fehler beheben]
[Ursache vertiefen]
[Tests starten]
```

### Coding-Vorschlag ohne Patch

```text
[Änderung vorbereiten]
[Plan anzeigen]
[Abbrechen]
```

### Lauf fehlgeschlagen

```text
[Erneut versuchen]
[Diagnose öffnen]
[Anderes Modell wählen]
```

### Erfolgreicher Patch

Bestehend erhalten:

```text
[Tests starten]
[Rollback]
[Datei öffnen]
```

## 3. Eigene Action-Kinds statt Missbrauch von `confirm_continue`

Empfohlene additive Erweiterung:

```ts
export type ChatActionKind =
  | existingKinds
  | "continue_task"
  | "implement_plan"
  | "show_next_steps"
  | "retry_run"
  | "inspect_result"
  | "new_task";
```

`confirm_continue` bleibt für eine echte genehmigungspflichtige Fortsetzung erhalten.

Allgemeine Vorschläge sind keine Sicherheitsfreigaben und sollten deshalb nicht mit Approval-Actions vermischt werden.

## 4. Folgeaktionen direkt unter der letzten Assistentenantwort anzeigen

`RuntimeChatMessageCard` sollte zwei Action-Gruppen unterscheiden:

```text
Required Actions
→ Freigabe, Ablehnung, Rollback, Command, Web

Suggested Follow-ups
→ Weiter, Vertiefen, Umsetzen, Testen, neue Aufgabe
```

Vorgeschlagene Aktionen benötigen:

- keinen Approval-State
- keine Risikokennzeichnung, sofern rein dialogisch
- klaren Prompt oder Store-Handler
- deaktivierten Zustand während `isSending`

## 5. Erfolgreiche Runs nicht zwingend vollständig einblenden

Der komplette `CodeeRunLiveBlock` muss nicht bei jedem Erfolg angezeigt werden.

Besser:

- Folgeaktionen an die Assistentennachricht hängen
- Run-Block weiterhin nur für Diagnose und Sonderfälle verwenden

Damit bleibt die UI ruhig.

## 6. Aktionen an den tatsächlichen Workflow koppeln

Beispiel:

```ts
switch (run.workflowKind) {
  case "planning":
    return ["implement_plan", "show_next_steps", "new_task"];

  case "repository_review":
    return ["fix_errors", "open_review", "rerun_review"];

  case "coding":
    return hasPatchProposal
      ? []
      : ["continue_task", "inspect_result", "new_task"];

  default:
    return ["show_next_steps", "continue_task", "new_task"];
}
```

Zusätzlich Outcome beachten:

```ts
if (run.outcome === "needs_user_input") {
  return [];
}

if (run.status === "failed" || run.status === "timeout") {
  return ["retry_run", "inspect_result"];
}
```

---

# Empfohlener minimaler Fix

## Phase 1

Ohne großen Umbau:

1. Nach Abschluss einer Assistentenantwort `buildFollowUpActions()` aufrufen.
2. Maximal drei vorgeschlagene Actions an die letzte Assistentennachricht hängen.
3. Diese Actions in `RuntimeChatMessageCard` in einem eigenen Block rendern.
4. Klick sendet einen festen, kontextbezogenen Prompt über `sendMessage()`.
5. Approval-Actions unverändert lassen.

## Phase 2

- Workflow-spezifische Handler
- Plan direkt fortsetzen
- Retry mit gleichem Run-Kontext
- Modellwechsel anbieten
- Diagnose öffnen
- persistierte Follow-up-Actions

---

# Pflicht-Tests

```text
normaler Chat zeigt Folgeaktionen
Plan zeigt „Plan umsetzen“
Analyse mit Fehlern zeigt „Fehler beheben“
fehlgeschlagener Run zeigt „Erneut versuchen“
needs_user_input erzeugt keine konkurrierenden Vorschläge
Patch-Approval bleibt unverändert
Patch-Apply zeigt weiterhin Tests/Rollback/Datei öffnen
Review zeigt weiterhin Findings-Aktionen
während isSending sind Folgeaktionen deaktiviert
nur die letzte Assistentenantwort zeigt aktive Vorschläge
alte Vorschläge werden bei neuer Nutzeranfrage deaktiviert
Workspace-Wechsel entfernt stale Follow-ups
```

---

# Schlussurteil

Der Chat bietet nicht deshalb nichts an, weil die Buttons falsch gerendert werden.

Die eigentliche Ursache ist:

```text
Es werden für normale Antwortabschlüsse keine Folgeaktionen erzeugt.
```

Die vorhandene Infrastruktur deckt Entscheidungen und Freigaben ab, aber noch keine allgemeine dialogische Weiterführung.

Der passende Fix ist deshalb ein zentraler, deterministischer:

```text
Post-Response Follow-up Action Builder
```

und kein Prompt-Zusatz wie „Frage am Ende immer, ob du weitermachen sollst“.
