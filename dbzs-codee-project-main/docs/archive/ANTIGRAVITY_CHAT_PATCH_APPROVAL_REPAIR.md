# ANTIGRAVITY TASK — Chat-native Patch Approval and Reasoning UI Repair

Repository:

`devdbzemusic/dbzs-codee-project`

## Ausgangslage

Im aktuellen Runtime Chat wird eine Modellantwort wie diese roh angezeigt:

```text
<reasoning-summary>{ ... }</reasoning-summary>
```

Das ist falsch.

Außerdem erscheint kein Button zum Übernehmen, weil aus der Antwort kein echter `AgentPatchProposal` und keine `ChatActionRequest` erzeugt werden.

Der aktuelle fehlerhafte Ablauf ist:

```text
Modell erzeugt reasoning-summary als Text
→ Tag wird roh im Chat gerendert
→ kein Patch Proposal
→ keine Preview
→ keine Approval Action
→ kein Übernehmen-Button
```

## Ziel

Der Chat soll der zentrale Review- und Freigabepunkt für Agentenaktionen werden.

Erwarteter Ablauf:

```text
Nutzer fordert Änderung an
→ Agent analysiert
→ Reasoning Summary wird strukturiert geparst
→ Agent erzeugt propose_file_changes
→ AgentPatchProposal entsteht
→ Preview und Diff werden erzeugt
→ Chat zeigt Diff-Karte
→ Chat zeigt [Übernehmen] [Ablehnen]
→ Nutzer bestätigt
→ Patch wird real angewendet
→ Chat zeigt [Tests starten] [Rollback] [Datei öffnen]
```

Keine neue Patch-Pipeline bauen.  
Keine neue parallele Action-Infrastruktur bauen.  
Bestehende Contracts und IPC-Methoden wiederverwenden.

---

# 1. Root Cause zuerst nachweisen

Prüfe mindestens:

```text
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/services/runtimeChatAgentRunner.ts
apps/desktop/src/services/agentRunService.ts
apps/desktop/src/components/
apps/desktop/electron/agentPatchCoordinator.ts
apps/desktop/electron/preload.ts
apps/desktop/electron/main.ts
packages/shared/src/index.ts
```

Dokumentiere:

1. Wo `<reasoning-summary>` aktuell als String in die Assistant-Nachricht gelangt.
2. Warum es nicht in `AgentReasoningSummary` normalisiert wird.
3. Wo `propose_file_changes` erkannt oder aktuell ignoriert wird.
4. Warum kein `AgentPatchProposal` entsteht.
5. Warum keine `ChatActionRequest` an die Chat-Nachricht gehängt wird.
6. Welche vorhandene Diff-/Approval-Komponente wiederverwendet werden kann.

Keine UI-Kosmetik durchführen, bevor der Datenfluss geklärt ist.

---

# 2. Rohes Reasoning-Markup aus Chattext entfernen

Der Chat darf niemals rohe Tags wie diese anzeigen:

```text
<reasoning-summary>
</reasoning-summary>
<tool-call>
</tool-call>
<function-call>
</function-call>
```

Implementiere eine zentrale Normalisierung:

```ts
export interface ParsedAssistantPayload {
  visibleText: string;
  reasoningSummary?: AgentReasoningSummary;
  toolCalls: AgentToolCall[];
  warnings: string[];
}
```

Die Normalisierung muss:

- sichtbaren Antworttext extrahieren
- `reasoning-summary` separat parsen
- Tool Calls separat extrahieren
- unbekannte Tags als Warnung behandeln
- rohe Steuer-Tags aus `visibleText` entfernen
- unvollständige Tags robust behandeln
- keine private Chain-of-Thought rekonstruieren
- keine Roh-CoT speichern

Wenn das Modell JSON innerhalb des Tags liefert, muss dieses JSON strikt validiert werden.

---

# 3. Reasoning Summary korrekt darstellen

Verwende den bestehenden oder ergänzten Contract:

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

Darstellung im Chat:

```text
▸ Vorgehensweise

CODEE hat die betroffenen Bereiche analysiert und plant eine kontrollierte Änderung.

[Details anzeigen]
```

Expanded:

```text
Vorgehensweise

Schritte:
1. Betroffene Datei prüfen
2. Patch erzeugen
3. Diff anzeigen
4. Nach Freigabe anwenden
5. Tests ausführen

Risiken:
- Änderung betrifft öffentliche API
```

Anforderungen:

- standardmäßig eingeklappt
- niemals als Roh-JSON anzeigen
- klar von der Assistant-Antwort getrennt
- optional über Settings ausblendbar
- keine private CoT
- keine Debug- oder Systemprompt-Inhalte

---

# 4. Coding-Intent erkennen

Wenn der Nutzer einen Änderungsauftrag formuliert, darf der Agent nicht mit einem bloßen Plan enden.

Mindestens folgende Intents erkennen:

```text
ändere
implementiere
repariere
fixe
korrigiere
ergänze
entferne
benenne um
refaktoriere
update
modify
implement
repair
fix
change
refactor
```

Bei erkanntem Coding-Intent gilt:

```text
entweder AgentPatchProposal erzeugen
oder klaren strukturierten Fehler liefern
```

Zulässiger Fehler:

```text
Keine Dateiänderung erzeugt.

Grund:
- keine betroffene Datei erkannt
- Workspace nicht geöffnet
- Tool propose_file_changes nicht verfügbar
- Modellantwort war ungültig
```

Nicht zulässig:

```text
nur allgemeiner Plan
nur Reasoning Summary
nur Erklärung ohne Patch
```

---

# 5. `propose_file_changes` verbindlich verarbeiten

Tool-Call:

```json
{
  "name": "propose_file_changes",
  "arguments": {
    "title": "Fix add implementation",
    "summary": "Replace subtraction with addition.",
    "changes": [
      {
        "file_path": "src/math.ts",
        "change_type": "modify",
        "proposed_content": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
        "reason": "The function subtracts instead of adding.",
        "risk_level": "low"
      }
    ],
    "validation_commands": [
      "typecheck",
      "test"
    ]
  }
}
```

Ablauf:

```text
Tool Call erkannt
→ Argumente validieren
→ AgentPatchProposal erzeugen
→ AgentPatchCoordinator.previewAgentPatch()
→ AgentPatchPreview speichern
→ ChatActionRequest erzeugen
→ Chat neu rendern
```

Keine Dateiänderung während des Tool Calls.

---

# 6. ChatActionRequest korrekt erzeugen

Verwende einen zentralen Contract:

```ts
export type ChatActionKind =
  | "show_diff"
  | "approve_patch"
  | "reject_patch"
  | "apply_patch"
  | "rollback_patch"
  | "run_validation"
  | "open_file";

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

Nach Preview erzeugen:

```text
[Diff anzeigen]
[Übernehmen]
[Ablehnen]
```

Nach Apply:

```text
[Tests starten]
[Rollback]
[Datei öffnen]
```

---

# 7. Patch-Karte direkt im Chat

Erstelle oder erweitere eine kompakte Chat-Komponente:

```text
CODEE möchte 1 Datei ändern

src/math.ts
Änderung: Modify
Risiko: Niedrig

- return a - b;
+ return a + b;

[Diff anzeigen] [Übernehmen] [Ablehnen]
```

Bei mehreren Dateien:

```text
CODEE möchte 3 Dateien ändern

1. src/math.ts
2. src/math.test.ts
3. README.md

[Alle Diffs anzeigen] [Übernehmen] [Ablehnen]
```

Anforderungen:

- Action-Karte direkt unter der relevanten Assistant-Nachricht
- kein separater versteckter Tab als Voraussetzung
- Buttonzustand sichtbar
- Fehler inline anzeigen
- stale Actions als abgelaufen markieren
- Buttons tastaturbedienbar
- Screenreader-Labels

---

# 8. „Übernehmen“ korrekt verdrahten

Button-Ablauf:

```text
Übernehmen
→ approveAgentPatch(proposalId, approvalVersion)
→ applyAgentPatch(proposalId, approvalVersion)
→ Status APPLYING
→ Datei real ändern
→ Status APPLIED
→ Workspace Refresh
→ Monaco Refresh
→ Git Refresh
→ Folge-Actions anzeigen
```

Anforderungen:

- Button nach Klick sofort deaktivieren
- doppelten Apply verhindern
- stale Approval blockieren
- Fehler sichtbar machen
- keine Auto-Freigabe
- keine direkte Renderer-Dateioperation

---

# 9. „Ablehnen“ korrekt verdrahten

```text
Ablehnen
→ rejectAgentPatch(proposalId)
→ Status REJECTED
→ Actions deaktivieren
→ Chat zeigt „Änderung verworfen“
```

Der Agent darf denselben Proposal nicht später automatisch anwenden.

---

# 10. Nach Apply Folgeaktionen anzeigen

Nach erfolgreichem Apply:

```text
Änderung angewendet

Dateien:
- src/math.ts

[Tests starten] [Rollback] [Datei öffnen]
```

## Tests starten

Über Safe Command Pipeline:

```text
validationCommands
→ run_workspace_command
→ Live Status
→ Resultat im Chat
```

## Rollback

```text
rollbackAgentPatch
→ Workspace Refresh
→ Monaco Refresh
→ Git Refresh
→ Chat-Status aktualisieren
```

## Datei öffnen

Betroffene Datei im Editor öffnen.

---

# 11. Store-Zustände trennen

Assistant-Text, Reasoning, Proposal und Actions dürfen nicht in einem einzelnen String-State vermischt werden.

Empfohlen:

```ts
interface RuntimeChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  reasoningSummary?: AgentReasoningSummary;
  patchProposalId?: string;
  patchPreviewId?: string;
  actions?: ChatActionRequest[];
  createdAt: string;
}
```

Zusätzliche Stores:

```ts
patchProposalsById
patchPreviewsById
chatActionsById
```

Streaming darf:

- Text ergänzen
- aber Reasoning nicht überschreiben
- Proposal nicht löschen
- Actions nicht entfernen
- Apply-Status nicht zurücksetzen

---

# 12. Fehlerzustände sichtbar machen

Beispiele:

```text
Patch konnte nicht vorbereitet werden.
Grund: Datei außerhalb des Workspace.
```

```text
Änderung konnte nicht angewendet werden.
Grund: Freigabe ist veraltet.
```

```text
Das Modell hat keinen gültigen Patch erzeugt.
[Erneut versuchen]
```

Keine stillen Fehler.

---

# 13. UI-Zielbild

Der relevante Chat-Bereich soll ungefähr so funktionieren:

```text
ASSISTENT

Ich habe die fehlerhafte Berechnung gefunden.

▸ Vorgehensweise

CODEE möchte 1 Datei ändern:

src/math.ts

- return a - b;
+ return a + b;

[Diff anzeigen] [Übernehmen] [Ablehnen]
```

Nach Apply:

```text
✓ Änderung angewendet

[Tests starten] [Rollback] [Datei öffnen]
```

---

# 14. Verbindlicher Acceptance-Test

Temporärer Workspace:

```ts
export function add(a: number, b: number): number {
  return a - b;
}
```

Nutzeranfrage:

```text
Korrigiere die add-Funktion.
```

Erwartung:

1. Agent erkennt Coding-Intent
2. Modell-Fixture liefert Reasoning Summary und `propose_file_changes`
3. rohe Tags erscheinen nicht im Chat
4. Reasoning Summary wird einklappbar angezeigt
5. Patch Preview wird erzeugt
6. Buttons `Diff anzeigen`, `Übernehmen`, `Ablehnen` erscheinen
7. Test klickt `Übernehmen`
8. Datei wird real geändert
9. Buttons `Tests starten`, `Rollback`, `Datei öffnen` erscheinen
10. Rollback stellt Originalinhalt wieder her

---

# 15. Pflicht-Tests

1. Reasoning Tag wird nicht roh angezeigt
2. gültige Reasoning Summary wird gerendert
3. ungültiges Reasoning JSON erzeugt Warnung
4. Coding-Intent verlangt Patch oder Fehler
5. Plan-only-Antwort wird als unvollständig markiert
6. `propose_file_changes` erzeugt Proposal
7. Preview erzeugt Chat Actions
8. Übernehmen schreibt reale Datei
9. Ablehnen schreibt keine Datei
10. doppelter Klick blockiert
11. stale Approval blockiert
12. Streaming überschreibt Actions nicht
13. Workspace-Wechsel invalidiert Actions
14. Apply zeigt Folgeaktionen
15. Rollback aktualisiert Chat und Editor
16. Teststart nutzt Safe Command Pipeline
17. kein Roh-CoT wird gespeichert
18. Accessibility Labels vorhanden

---

# 16. Qualitäts-Gates

Vor Abschluss:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke-test
pnpm test:file-apply
pnpm test:chat-file-apply
pnpm test:chat-actions
```

Ergänze bei Bedarf:

```powershell
pnpm test:chat-patch-ui
```

---

# 17. Definition of Done

Die Aufgabe ist erst abgeschlossen, wenn:

1. `<reasoning-summary>` nicht mehr roh im Chat erscheint
2. Reasoning als einklappbare UI-Komponente erscheint
3. Coding-Aufträge nicht mit einem bloßen Plan enden
4. `propose_file_changes` einen echten Proposal erzeugt
5. der Diff direkt im Chat erreichbar ist
6. `Übernehmen` und `Ablehnen` sichtbar sind
7. `Übernehmen` die Datei real ändert
8. nach Apply `Tests starten`, `Rollback` und `Datei öffnen` erscheinen
9. Store und Streaming den Action-State nicht zerstören
10. ein echter E2E-Test den vollständigen Ablauf beweist

---

# 18. Nicht Teil dieser Aufgabe

Nicht umsetzen:

- neue Patch-Pipeline
- neue Agentenarchitektur
- Roh-CoT-Anzeige
- automatische Patch-Freigabe
- automatische Commits
- große UI-Neugestaltung
- versteckte Actions außerhalb des Chats

---

# 19. Arbeitsweise für Antigravity

Arbeite agentisch und liefere überprüfbare Artefakte:

1. Audit-Artefakt mit Root Cause
2. Implementierungsplan
3. kleine, logisch getrennte Änderungen
4. Screenshots des reparierten Chat-Flows
5. Testnachweise
6. abschließende Dateiliste
7. offene Restpunkte

Nutze Browser-/UI-Verifikation nur für die lokale Anwendung.  
Keine System- oder Projektdateien außerhalb des Workspace verändern.  
Keine destruktiven Terminalbefehle.  
Vor jeder Schreibaktion vorhandene Restore-/Patch-Mechanismen respektieren.

Empfohlene Commits:

```text
fix(chat): parse reasoning summaries into structured messages
feat(chat): render patch approval actions inline
feat(agent): require patch proposals for coding intents
feat(chat): connect approve reject apply and rollback actions
test(chat): verify inline patch approval lifecycle
docs(status): document chat-native patch approval
```
