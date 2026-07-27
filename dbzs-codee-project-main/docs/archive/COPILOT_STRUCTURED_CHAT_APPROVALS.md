# GITHUB COPILOT TASK — Structured Chat Responses and Contextual Approval Buttons

Repository:

`devdbzemusic/dbzs-codee-project`

## Ausgangslage

Im Runtime Chat werden strukturierte Agenteninhalte derzeit teilweise falsch dargestellt.

Aktuell sichtbare Probleme:

- `<reasoning-summary>...</reasoning-summary>` erscheint teilweise noch als Rohtext.
- Reasoning Summary wird doppelt dargestellt: einmal als UI-Karte und zusätzlich als Roh-Markup.
- erkannte Pläne werden nicht in genehmigungspflichtige Chat-Aktionen überführt.
- konkrete Dateiänderungen erzeugen nicht zuverlässig direkt im Chat:
  - `Diff anzeigen`
  - `Änderungen übernehmen`
  - `Ablehnen`
- Terminal- und Web-Aktionen haben keinen einheitlichen Approval-Block im Chat.
- Assistant-Text, Reasoning, Plan, Patch und Actions sind nicht sauber voneinander getrennt.

## Ziel

Der Chat soll alle Agentenantworten in klare semantische Blöcke zerlegen.

Erwartete Struktur:

```text
Assistant Text
→ optional Reasoning Summary
→ optional Plan Proposal
→ optional Patch Proposal
→ optional Command Approval
→ optional Web Approval
→ Action Result
```

Approval-Buttons erscheinen immer direkt unter dem Chat-Block, der eine Nutzerentscheidung benötigt.

Keine neue Agentenarchitektur bauen.
Keine zweite Patch-, Command- oder Web-Pipeline bauen.
Bestehende Actions, Stores, Services und IPC-Methoden wiederverwenden.

## 1. Root Cause auditieren

Prüfe mindestens:

```text
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/services/runtimeChatAgentRunner.ts
apps/desktop/src/services/agentRunService.ts
apps/desktop/src/components/
apps/desktop/src/types/
apps/desktop/electron/agentPatchCoordinator.ts
apps/desktop/electron/preload.ts
apps/desktop/electron/main.ts
packages/shared/src/index.ts
```

Dokumentiere zuerst:

1. Wo Roh-Markup in den Assistant-Text gelangt.
2. Warum `reasoning-summary` doppelt gerendert wird.
3. Wo Planinformationen verloren gehen.
4. Warum aus Plänen keine Chat Actions entstehen.
5. Warum Patch Actions nicht zuverlässig im Chat erscheinen.
6. Welche vorhandenen UI-Komponenten und Actions wiederverwendet werden können.

Keine kosmetische Reparatur ohne geklärten Datenfluss.

## 2. Assistant-Ausgabe zentral parsen

Implementiere oder vervollständige eine zentrale Normalisierung:

```ts
export interface ParsedAssistantPayload {
  visibleText: string;
  reasoningSummary?: AgentReasoningSummary;
  planProposal?: AgentPlanProposal;
  toolCalls: AgentToolCall[];
  warnings: string[];
}
```

Die Normalisierung muss:

- sichtbaren Assistant-Text extrahieren
- `reasoning-summary` separat parsen
- Planinformationen separat parsen
- Tool Calls separat extrahieren
- rohe Steuer-Tags aus `visibleText` entfernen
- unvollständige Tags robust behandeln
- ungültiges JSON als Warnung behandeln
- keine Roh-CoT rekonstruieren
- keine privaten Modellinformationen speichern

Folgende Tags dürfen niemals roh im Chat erscheinen:

```text
<reasoning-summary>
</reasoning-summary>
<tool-call>
</tool-call>
<function-call>
</function-call>
<plan>
</plan>
```

## 3. Reasoning Summary korrekt darstellen

Verwende einen sicheren Contract:

```ts
export interface AgentReasoningSummary {
  id: string;
  runId: string;
  messageId?: string;
  title: string;
  summary: string;
  steps?: string[];
  assumptions?: string[];
  risks?: string[];
  nextAction?: string;
  createdAt: string;
}
```

Darstellung:

```text
▸ Vorgehensweise

CODEE hat die relevanten Dateien identifiziert und plant eine kontrollierte Änderung.

[Details anzeigen]
```

Anforderungen:

- standardmäßig eingeklappt
- kein Roh-JSON
- kein Roh-Markup
- optional ausblendbar
- klar vom normalen Assistant-Text getrennt
- keine private Chain-of-Thought

## 4. Plan Proposal einführen oder vereinheitlichen

Falls bereits ein Plan-Contract existiert, diesen wiederverwenden. Sonst zentral definieren:

```ts
export interface AgentPlanStep {
  id: string;
  title: string;
  description: string;
  riskLevel?: "low" | "medium" | "high";
}

export interface AgentPlanProposal {
  id: string;
  runId: string;
  title: string;
  summary: string;
  steps: AgentPlanStep[];
  createdAt: string;
  state:
    | "proposed"
    | "approved"
    | "rejected"
    | "running"
    | "completed"
    | "failed";
}
```

Plan-Darstellung im Chat:

```text
Geplanter Ablauf

1. calc.py analysieren
2. fehlerhafte Berechnung korrigieren
3. Tests ausführen
4. Ergebnis verifizieren

[Plan übernehmen] [Plan bearbeiten] [Ablehnen]
```

Wichtig:

- `Plan übernehmen` genehmigt die Ausführung des Plans
- es genehmigt noch nicht automatisch konkrete Dateiänderungen
- konkrete Patches benötigen weiterhin eigene Freigabe
- kein Plan darf ohne sichtbare Nutzerentscheidung automatisch loslaufen, wenn die Policy eine Freigabe verlangt

## 5. ChatAction Contract vereinheitlichen

Verwende einen zentralen Shared Contract:

```ts
export type ChatActionKind =
  | "approve_plan"
  | "edit_plan"
  | "reject_plan"
  | "show_diff"
  | "approve_patch"
  | "reject_patch"
  | "apply_patch"
  | "rollback_patch"
  | "run_validation"
  | "open_file"
  | "approve_command"
  | "reject_command"
  | "cancel_command"
  | "approve_web_search"
  | "reject_web_search"
  | "cancel_run";

export interface ChatActionRequest {
  id: string;
  runId: string;
  messageId: string;
  kind: ChatActionKind;
  title: string;
  description?: string;
  riskLevel?: "low" | "medium" | "high";
  payload: Record<string, unknown>;
  approvalVersion?: string;
  expiresAt?: string;
  state:
    | "pending"
    | "approved"
    | "rejected"
    | "running"
    | "completed"
    | "failed"
    | "expired";
  createdAt: string;
}
```

Keine UI-lokalen Sondertypen für dieselbe Aktion.

## 6. RuntimeChatMessage sauber strukturieren

Assistant-Text, Reasoning, Plan, Patch und Actions dürfen nicht in einem String vermischt werden.

```ts
export interface RuntimeChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  reasoningSummary?: AgentReasoningSummary;
  planProposal?: AgentPlanProposal;
  patchProposalId?: string;
  patchPreviewId?: string;
  actions?: ChatActionRequest[];
  createdAt: string;
}
```

Zusätzliche Stores:

```ts
planProposalsById
patchProposalsById
patchPreviewsById
chatActionsById
```

Streaming darf:

- Text ergänzen
- aber Reasoning nicht löschen
- Plan nicht überschreiben
- Patch nicht entfernen
- Action State nicht zurücksetzen

## 7. Wann Buttons erscheinen müssen

### Plan vorhanden

```text
[Plan übernehmen] [Plan bearbeiten] [Ablehnen]
```

### Patch vorhanden

```text
[Diff anzeigen] [Änderungen übernehmen] [Ablehnen]
```

### Patch angewendet

```text
[Tests starten] [Rollback] [Datei öffnen]
```

### Terminalbefehl genehmigungspflichtig

```text
[Befehl ausführen] [Ablehnen]
```

### Laufender Terminalbefehl

```text
[Abbrechen]
```

### Websuche genehmigungspflichtig

```text
[Websuche erlauben] [Ablehnen]
```

### Review Gate / Agentenfortsetzung

```text
[Fortsetzen] [Stoppen]
```

Buttons erscheinen direkt unter dem relevanten Chat-Block.

## 8. Plan Approval anbinden

Beim Klick auf `Plan übernehmen`:

```text
approvePlan(planId)
→ Plan State = approved
→ Agent Run fortsetzen
→ nächster geplanter Schritt beginnt
```

Beim Klick auf `Plan bearbeiten`:

```text
Plan Editor oder Chat Edit öffnen
→ neue Plan-Version erzeugen
→ alte Freigabe ungültig machen
```

Beim Klick auf `Ablehnen`:

```text
rejectPlan(planId)
→ Plan State = rejected
→ Agent Run pausieren oder beenden
```

Anforderungen:

- keine doppelte Freigabe
- stale Plan-Version blockieren
- geänderte Pläne brauchen neue Freigabe
- Ergebnis direkt im Chat anzeigen

## 9. Patch Approval anbinden

Nach `propose_file_changes`:

```text
AgentPatchProposal
→ previewAgentPatch
→ Patch Preview
→ ChatActionRequest erzeugen
```

Chat-Karte:

```text
CODEE möchte 1 Datei ändern

calc.py
Änderung: Modify
Risiko: Niedrig

- return a - b
+ return a + b

[Diff anzeigen] [Änderungen übernehmen] [Ablehnen]
```

Beim Übernehmen:

```text
approveAgentPatch
→ applyAgentPatch
→ Workspace Refresh
→ Monaco Refresh
→ Git Refresh
→ Folgeaktionen
```

## 10. Command Approval anbinden

Chat-Karte:

```text
CODEE möchte folgenden Befehl ausführen:

pytest

Grund:
Überprüfung der vorgenommenen Änderung

Risiko: Niedrig

[Befehl ausführen] [Ablehnen]
```

Bestehende Safe Command Pipeline verwenden.

Keine freien Shell-Strings ausführen.

## 11. Web Approval anbinden

Chat-Karte:

```text
CODEE möchte online recherchieren:

Python unittest assertEqual official documentation

Zweck:
Aktuelle offizielle API verifizieren

[Websuche erlauben] [Ablehnen]
```

Bestehende Web Research Policy verwenden.

Keine Netzwerkaktion vor Freigabe, wenn die Policy eine Freigabe verlangt.

## 12. UI-Komponenten

Erstelle oder vereinheitliche kompakte Chat-Komponenten:

```text
ReasoningSummaryCard
PlanProposalCard
PatchProposalCard
CommandApprovalCard
WebApprovalCard
ChatActionBar
ActionResultCard
```

Keine große UI-Neugestaltung.

Anforderungen:

- direkt im Chat
- eingeklappte Details
- klare Risikokennzeichnung
- Status sichtbar
- Buttons nach Klick deaktiviert
- Fehler inline
- Tastaturbedienung
- Screenreader Labels

## 13. Doppelte Reasoning-Ausgabe verhindern

Der Parser muss garantieren:

```text
Reasoning Summary entweder als strukturierte Karte
oder gar nicht
```

Nie:

```text
Reasoning Karte
+ derselbe Rohtext darunter
```

Füge eine explizite Sanitization- und Deduplication-Stufe hinzu.

## 14. Plan-only bei Coding-Auftrag behandeln

Wenn der Nutzer sagt:

```text
ändere
implementiere
repariere
fixe
korrigiere
refaktoriere
```

darf der Agent nicht unbemerkt mit einem Plan enden.

Erlaubt:

```text
Plan Proposal mit Approval Buttons
```

oder:

```text
konkreter Patch Proposal
```

oder:

```text
strukturierter Fehler mit Grund
```

Nicht erlaubt:

```text
bloße allgemeine Erklärung ohne Action
```

## 15. Fehlerzustände

Beispiele:

```text
Plan konnte nicht erstellt werden.
Grund: keine relevanten Dateien erkannt.
```

```text
Patch konnte nicht vorbereitet werden.
Grund: Datei außerhalb des Workspace.
```

```text
Freigabe ist veraltet.
Bitte prüfe den aktualisierten Plan erneut.
```

```text
Das Modell hat keine ausführbare Änderung erzeugt.
[Erneut versuchen]
```

Keine stillen Fehler.

## 16. Acceptance-Test

Temporärer Workspace:

```python
def add(a, b):
    return a - b
```

Nutzeranfrage:

```text
Korrigiere die add-Funktion und führe die Tests aus.
```

Erwarteter Ablauf:

1. Reasoning Summary wird strukturiert angezeigt.
2. Roh-Markup ist nicht sichtbar.
3. Plan Proposal erscheint.
4. Buttons:
   - `Plan übernehmen`
   - `Plan bearbeiten`
   - `Ablehnen`
5. Test bestätigt den Plan.
6. Agent erzeugt Patch Proposal.
7. Buttons:
   - `Diff anzeigen`
   - `Änderungen übernehmen`
   - `Ablehnen`
8. Test übernimmt Patch.
9. Datei wird real geändert.
10. Buttons:
    - `Tests starten`
    - `Rollback`
    - `Datei öffnen`
11. Test startet Safe Command.
12. Ergebnis erscheint strukturiert im Chat.
13. Rollback funktioniert.

## 17. Pflicht-Tests

1. Reasoning Tag nicht roh sichtbar
2. Reasoning Summary genau einmal gerendert
3. Plan Proposal erscheint
4. Plan Approval funktioniert
5. Plan Edit invalidiert alte Freigabe
6. Plan Reject stoppt Ausführung
7. Patch Approval erscheint
8. Patch Apply funktioniert
9. Command Approval erscheint
10. Web Approval erscheint
11. Streaming überschreibt Actions nicht
12. doppelter Klick blockiert
13. stale Approval blockiert
14. Workspace-Wechsel invalidiert Actions
15. Actions bleiben bis Abschluss sichtbar
16. Fehler inline sichtbar
17. Accessibility Labels vorhanden
18. kein Roh-CoT gespeichert

## 18. Qualitäts-Gates

Vor Abschluss:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke-test
pnpm test:file-apply
pnpm test:chat-file-apply
pnpm test:chat-actions
pnpm test:agent-shell
pnpm test:agent-web
```

Ergänze:

```powershell
pnpm test:structured-chat
```

## 19. Definition of Done

Die Aufgabe ist erst abgeschlossen, wenn:

1. Chat-Antworten sinnvoll strukturiert sind
2. Roh-Markup nicht mehr sichtbar ist
3. Reasoning genau einmal als UI-Karte erscheint
4. Pläne Approval Buttons erhalten
5. Patches Approval Buttons erhalten
6. Commands Approval Buttons erhalten
7. Websuche Approval Buttons erhält
8. Buttons direkt im Chat erscheinen
9. bestehende sichere Actions verwendet werden
10. Action States Streaming und Refresh überstehen
11. ein echter E2E-Test den vollständigen Ablauf beweist

## 20. Nicht Teil dieser Aufgabe

Nicht umsetzen:

- Roh-CoT-Anzeige
- automatische Freigaben
- neue Patch-Pipeline
- neue Command-Pipeline
- neue Web-Pipeline
- automatische Commits oder Pushes
- große UI-Neugestaltung

## 21. Abschlussbericht

Am Ende liefern:

1. Root Cause
2. Parser- und Datenmodelländerungen
3. neue/angepasste Chat-Komponenten
4. unterstützte Approval Actions
5. geänderte Dateien
6. UI-Nachweis
7. E2E-Testnachweis
8. bekannte Einschränkungen
9. nächste sinnvolle Phase

Empfohlene Commits:

```text
fix(chat): remove raw structured markup from assistant messages
feat(chat): add structured reasoning and plan cards
feat(chat): add contextual approval actions
feat(agent): connect plan patch command and web approvals
test(chat): verify structured chat action lifecycle
docs(status): document chat-native approvals
```
