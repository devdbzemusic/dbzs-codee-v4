# Workflow-Studie: Codex-ähnliche Chat-Abläufe für Codee

**Projekt:** Division By Zeros – Codee  
**Quelle:** aktueller GitHub-Stand `devdbzemusic/dbzs-codee-project`  
**Analysierter Commit:** `6b56ee03025272e6f5726167a3664631ffe4b61f`  
**Ziel:** Codee soll Arbeitsabläufe im Chat so geschlossen, nachvollziehbar und interaktiv darstellen wie Codex in VS Code.

---

## 1. Kernaussage

Codee besitzt bereits fast alle technischen Bausteine:

- Agent-Turn-Loop
- Run- und Event-Modell
- Tool-Calls
- Streaming
- Workspace-Kontext
- Plan- und Approval-Mechanismen
- Patch-Vorschau und Patch-Anwendung
- Repository-Review
- Modell-Routing
- Runtime-Slots
- Diagnose und Trajectory-Daten

Was aktuell fehlt, ist eine **einheitliche visuelle Workflow-Sprache**.

Der aktuelle Chat verteilt einen Arbeitslauf auf:

- normale Chat-Nachrichten
- Aktivitätsbereich
- Tool-Bar
- Approval-Panel
- Patch-Panel
- Research-Panel
- Slot-Panel
- Diagnose-Panel
- `CODEE RUN`-Block

Codex wirkt geschlossener, weil alle Aktionen als ein chronologischer Ablauf direkt zwischen Benutzerauftrag und Endantwort erscheinen.

---

## 2. Aktueller Codee-Ablauf

```text
User-Nachricht
   ↓
runtimeChatStore.sendMessage()
   ↓
Kontextaufbau / Routing / Modellstart
   ↓
Agent-Turn-Loop
   ↓
Tool-Aufrufe / Patch / Test / Review
   ↓
verschiedene Stores und Panels
   ↓
Assistant-Endantwort
```

Technisch ist das solide. Visuell entsteht jedoch ein fragmentierter Ablauf.

### Aktuelle Hauptkomponenten

```text
RuntimeChatTab.tsx
├── RuntimeChatToolsBar
├── RuntimeChatActivityPanel
├── RuntimeChatApprovals
├── RuntimeChatPatchPanel
├── RuntimeChatResearchPanel
├── RuntimeSlotPanel
├── RuntimeModelTestPanel
├── ChatMessageCard
└── CodeeRunLiveBlock
```

---

## 3. Zielbild

Der Chat soll nicht mehr nur Nachrichten anzeigen, sondern **Arbeitsläufe**.

```text
Benutzerauftrag
└── Codee Run
    ├── Auftrag verstanden
    ├── Kontext untersucht
    │   ├── package.json gelesen
    │   ├── RuntimeChatTab.tsx gelesen
    │   └── 14 relevante Dateien gefunden
    ├── Plan erstellt
    │   ├── 1. Event-Modell vereinheitlichen
    │   ├── 2. UI-Timeline einbauen
    │   └── 3. Patch validieren
    ├── Änderungen
    │   ├── RuntimeChatTab.tsx +84 / -31
    │   └── CodeeRunTimeline.tsx neu
    ├── Prüfung
    │   ├── TypeScript ✓
    │   ├── Tests ✓
    │   └── Build ✓
    └── Ergebnis
        └── Zusammenfassung und nächste Schritte
```

Der Benutzer sieht dadurch jederzeit:

1. Was Codee gerade macht.
2. Warum Codee es macht.
3. Welche Dateien betroffen sind.
4. Was ausgeführt wurde.
5. Was bestätigt werden muss.
6. Ob die Arbeit erfolgreich war.

---

## 4. Zentrale Architekturentscheidung

### Nicht weitere Panels bauen

Die vorhandenen Daten sollen in eine zentrale Timeline projiziert werden:

```typescript
type CodeeWorkflowItem =
  | UserRequestItem
  | StatusItem
  | ReasoningSummaryItem
  | ContextItem
  | PlanItem
  | ToolCallItem
  | CommandItem
  | FileChangeItem
  | ApprovalItem
  | TestResultItem
  | WarningItem
  | FinalAnswerItem;
```

Diese Timeline wird aus den bereits existierenden Daten erzeugt:

```text
RuntimeChatRun
RuntimeChatEvent[]
RuntimeChatTurn[]
RuntimeChatToolCall[]
RuntimeChatFileChange[]
RuntimeChatMessage[]
Approval State
Patch State
Repository Review State
```

Wichtig: Die bestehenden Stores bleiben zunächst erhalten. Eine neue **Presentation-/Projection-Schicht** führt sie nur zusammen.

---

## 5. Empfohlene neue Komponenten

```text
apps/desktop/src/components/chat/workflow/
├── CodeeWorkflowThread.tsx
├── CodeeWorkflowRun.tsx
├── CodeeWorkflowHeader.tsx
├── CodeeWorkflowTimeline.tsx
├── CodeeWorkflowItem.tsx
├── CodeePlanCard.tsx
├── CodeeToolCallCard.tsx
├── CodeeCommandCard.tsx
├── CodeeFileChangeCard.tsx
├── CodeeApprovalCard.tsx
├── CodeeTestResultCard.tsx
├── CodeeRunSummary.tsx
└── CodeeWorkflowComposer.tsx
```

Dazu:

```text
apps/desktop/src/services/
├── runtimeChatWorkflowProjection.ts
├── runtimeChatWorkflowGrouping.ts
└── runtimeChatWorkflowLabels.ts
```

---

## 6. Workflow-Projection

Die wichtigste neue Funktion:

```typescript
export function projectRunToWorkflowItems(
  run: RuntimeChatRun,
  messages: RuntimeChatMessage[],
  approvals: RuntimeApproval[],
  pendingChanges: ProposedChange[]
): CodeeWorkflowItem[] {
  // bestehende Ereignisse chronologisch normalisieren
}
```

### Aufgaben der Projection

- Events chronologisch sortieren
- doppelte Statusmeldungen zusammenfassen
- Tool-Start und Tool-Ende zu einer Karte verbinden
- Dateizugriffe gruppieren
- Patches mit betroffenen Dateien verbinden
- Approval direkt an die auslösende Aktion hängen
- Tests dem vorherigen Patch zuordnen
- technische Events in verständliche Bezeichnungen übersetzen
- interne Diagnosedaten standardmäßig einklappen

---

## 7. Event-Modell erweitern

Das vorhandene Event-System sollte langfristig semantische Events liefern.

```typescript
type RuntimeChatEventType =
  | "run.started"
  | "intent.detected"
  | "context.scan.started"
  | "context.file.read"
  | "context.ready"
  | "plan.created"
  | "plan.updated"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "command.started"
  | "command.output"
  | "command.completed"
  | "patch.proposed"
  | "patch.approval_required"
  | "patch.approved"
  | "patch.applied"
  | "patch.rejected"
  | "validation.started"
  | "validation.completed"
  | "run.waiting_for_user"
  | "run.completed"
  | "run.failed";
```

Jedes Event sollte diese Basis besitzen:

```typescript
interface RuntimeWorkflowEvent {
  id: string;
  runId: string;
  turnId?: string;
  parentEventId?: string;
  type: RuntimeChatEventType;
  timestamp: string;
  status: "pending" | "running" | "success" | "warning" | "error";
  title: string;
  summary?: string;
  details?: Record<string, unknown>;
  visibility: "user" | "diagnostic";
}
```

`parentEventId` ermöglicht echte verschachtelte Abläufe.

---

## 8. Codex-ähnliche UX-Regeln

### Ein Auftrag = ein Run-Block

Die Benutzeranfrage und alle Aktionen bleiben optisch zusammen.

### Progressive Disclosure

Standardansicht:

```text
✓ 12 Dateien untersucht
✓ 3 Dateien geändert
✓ Typecheck bestanden
```

Aufgeklappt:

```text
package.json
apps/desktop/src/components/RuntimeChatTab.tsx
apps/desktop/src/stores/runtimeChatStore.ts
...
```

### Nur aktive Arbeit automatisch öffnen

- laufender Schritt: geöffnet
- abgeschlossener Schritt: kompakt
- Fehler: geöffnet
- Diagnose: standardmäßig verborgen

### Aktionen am passenden Ort

Nicht in separaten Panels:

```text
Patch vorgeschlagen
[Diff öffnen] [Übernehmen] [Verwerfen]
```

```text
Befehl benötigt Freigabe
pnpm test
[Einmal erlauben] [Für diesen Run erlauben] [Ablehnen]
```

### Abschluss immer sichtbar

Der Run endet mit:

- Ergebnis
- geänderte Dateien
- Tests
- offene Risiken
- nächste sinnvolle Aktion

---

## 9. Composer wie Codex

Der Composer sollte eine kompakte Kontrollleiste erhalten:

```text
[Agent ▾] [Modell ▾] [Kontext: Projekt ▾] [Berechtigung: Fragen ▾]
```

### Modus

```text
Ask
Agent
Full
```

### Kontext

```text
Aktive Datei
Geöffnete Dateien
Auswahl
Ordner
Gesamtes Projekt
Automatisch
```

### Berechtigung

```text
Nur lesen
Vor Änderungen fragen
Vor Befehlen fragen
Run vollständig erlauben
```

Der aktuelle Unterschied zwischen `Auto`, `Agent` und `toolProfile` sollte visuell zusammengeführt werden. Momentan sind Modus, Profil und Provider getrennte Konzepte, obwohl sie für den Benutzer einen gemeinsamen Ausführungsmodus bilden.

Empfohlen:

```typescript
interface CodeeExecutionPreset {
  mode: "ask" | "agent" | "full";
  contextScope: ContextScope;
  approvalPolicy: ApprovalPolicy;
  providerMode: "auto" | "fixed";
}
```

---

## 10. Tool-Calls

Tool-Aufrufe sollen nicht wie Debug-Logs aussehen.

### Lesen

```text
▾ Datei gelesen
  apps/desktop/src/components/RuntimeChatTab.tsx
```

### Suche

```text
▾ Projekt durchsucht
  „RuntimeChatRun“
  18 Treffer in 7 Dateien
```

### Terminal

```text
▾ Befehl ausgeführt
  pnpm typecheck
  Exit Code 0 · 8,4 s
```

### Patch

```text
▾ Änderungen vorbereitet
  3 Dateien · +126 / -44
  [Diff anzeigen]
```

Technische Rohdaten bleiben über „Details“ verfügbar.

---

## 11. Patch- und Diff-Workflow

Der bestehende Patch-Workflow sollte direkt in den Run eingebettet werden.

```text
Änderungen vorbereitet
├── RuntimeChatTab.tsx       +42 / -19
├── CodeeWorkflowRun.tsx     neu
└── workflowProjection.ts    neu

[Alle Diffs] [Übernehmen] [Verwerfen]
```

Für einzelne Dateien:

```text
RuntimeChatTab.tsx
[Öffnen] [Diff] [Übernehmen] [Verwerfen]
```

Nach Anwendung:

```text
✓ 3 Änderungen übernommen
↶ Rückgängig
```

Für Produktionsreife ist ein echter Restore Point vor jeder Agent-Änderung erforderlich.

---

## 12. Approval-Workflow

Eine Freigabe ist kein separates Panel, sondern ein pausierter Workflow-Schritt.

```text
Codee benötigt eine Entscheidung

Der folgende Befehl kann Dateien verändern:

pnpm lint --fix

[Erlauben] [Nur diesmal] [Ablehnen]
```

Run-Zustand:

```typescript
status: "waiting_for_user"
```

Nach Entscheidung läuft exakt derselbe Run weiter.

---

## 13. Plan-Darstellung

Codex-artig sollte Codee bei größeren Aufgaben einen Plan zeigen:

```text
Plan
✓ Architektur untersuchen
✓ Event-Daten normalisieren
● Timeline-Komponente implementieren
○ Tests ergänzen
```

Der Plan ist kein statischer Text, sondern ein Objekt:

```typescript
interface CodeeRunPlan {
  id: string;
  version: number;
  steps: Array<{
    id: string;
    title: string;
    status: "pending" | "running" | "completed" | "blocked" | "skipped";
  }>;
}
```

Plan-Updates werden als neue Version gespeichert, nicht überschrieben. So bleibt der Ablauf nachvollziehbar.

---

## 14. Was aus dem aktuellen UI verschwinden sollte

Nicht zwingend löschen, aber aus der Primäransicht entfernen:

- großer permanenter Aktivitätsbereich
- separates Approval-Panel
- separates Patch-Panel
- separates Research-Panel
- separates Diagnose-Panel
- doppelte Aktivitätsanzeige im Header und Run
- technische Slot-Daten in der normalen Run-Karte
- Modell-ID, Settings Revision und Warmup-Details als Standardansicht

Diese Daten gehören in:

```text
Run → Details → Diagnose
```

---

## 15. Konkreter Umbauplan

### Phase 1 – Workflow Projection

Neue Dateien:

```text
runtimeChatWorkflowProjection.ts
runtimeChatWorkflowTypes.ts
runtimeChatWorkflowProjection.test.ts
```

Keine Store-Änderungen. Nur bestehende Daten normalisieren.

### Phase 2 – Neue Run-Timeline

`CodeeRunLiveBlock` schrittweise ersetzen durch:

```text
CodeeWorkflowRun
└── CodeeWorkflowTimeline
```

Bestehende Aktionen weiterverwenden.

### Phase 3 – Inline Approvals und Patches

- Approval-Karten in die Timeline
- Patch-Aktionen in FileChange-Karten
- separate Panels nur noch als Diagnose-/Übersichtsmodus

### Phase 4 – Composer vereinheitlichen

- Auto/Agent/Profile zusammenführen
- Kontext-Scope auswählbar
- Berechtigungsprofil sichtbar
- Provider unter „Erweitert“

### Phase 5 – Semantische Events

Store und Runner erzeugen sauber definierte Workflow-Events statt UI-spezifischer Aktivitätstexte.

### Phase 6 – Persistenz

Runs speichern:

```text
.codee/
└── runs/
    ├── <run-id>.json
    └── <run-id>.trajectory.json
```

Dadurch können Runs nach Neustart geöffnet und fortgeführt werden.

---

## 16. Akzeptanzkriterien

Die Umsetzung ist erfolgreich, wenn:

1. Ein kompletter Agentenlauf innerhalb eines einzigen Chat-Blocks sichtbar ist.
2. Tool-Calls chronologisch und gruppiert erscheinen.
3. Dateilesen, Suche, Terminal, Patch und Tests unterscheidbar sind.
4. Freigaben direkt im laufenden Schritt erscheinen.
5. Der Run nach einer Freigabe fortgesetzt wird.
6. Geänderte Dateien mit Diff und Status sichtbar sind.
7. technische Diagnosedaten die normale Ansicht nicht überladen.
8. der Benutzer jederzeit erkennt, ob Codee arbeitet, wartet, fertig ist oder gescheitert ist.
9. jeder Run exportierbar und reproduzierbar ist.
10. der aktuelle Agent-Loop und die vorhandenen Stores weiterverwendet werden.

---

## 17. Priorität für Codee

### P0

- Workflow Projection
- einheitlicher Run-Block
- Inline Tool-Calls
- Inline Approval
- Inline Patch Status

### P1

- Plan-Karte
- Terminal-Ausgaben
- Test-Zusammenfassung
- Undo für Agent-Änderungen
- persistente Runs

### P2

- Run-Fortsetzung
- parallele Subagenten
- Dateigruppierung
- Timeline-Filter
- vollständiger Diagnoseexport

---

## 18. Meine klare Empfehlung

Nicht versuchen, Codex optisch 1:1 zu kopieren.

Codee hat bereits mehr eigene Runtime-, Modell-, Slot-, Review- und Local-AI-Funktionen. Die richtige Lösung ist:

> **Codex-artige Ablaufklarheit mit Codees eigener Runtime-Tiefe.**

Der nächste konkrete Entwicklungsschritt sollte ein isolierter PR sein:

```text
feat(chat): introduce unified Codee workflow timeline projection
```

Inhalt:

1. `runtimeChatWorkflowTypes.ts`
2. `runtimeChatWorkflowProjection.ts`
3. `CodeeWorkflowRun.tsx`
4. `CodeeWorkflowTimeline.tsx`
5. vorhandenen `CodeeRunLiveBlock` intern auf die neue Projection umstellen
6. Unit-Tests für Event-Gruppierung
7. keine Änderungen am Agent-Loop

Damit wird die Benutzerwirkung stark verbessert, ohne die derzeit komplexe Runtime-Logik erneut umzubauen.
