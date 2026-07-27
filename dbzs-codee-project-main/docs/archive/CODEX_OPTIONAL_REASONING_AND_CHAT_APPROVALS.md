# CODEX TASK — Optional Reasoning Summary and Contextual Chat Approval Actions

Repository:

`devdbzemusic/dbzs-codee-project`

## Ziel

CODEE soll im Chat optional eine nachvollziehbare, kompakte Begründungs- und Ablaufzusammenfassung anzeigen.

Wichtig:

- Keine private interne Chain-of-Thought speichern oder anzeigen.
- Keine Roh-CoT des Modells ausgeben.
- Stattdessen eine sichere, kurze `Reasoning Summary` beziehungsweise `Execution Summary` erzeugen.
- Bestätigungs-, Übernahme- oder Freigabe-Buttons sollen direkt im Chat erscheinen, sobald eine Aktion eine Nutzerentscheidung erfordert.

Der Chat soll dadurch nicht nur Antworten anzeigen, sondern als zentraler Review- und Freigabepunkt für Agentenaktionen dienen.

---

# 1. Reasoning Summary statt privater CoT

Implementiere einen expliziten, sicheren Contract für sichtbare Begründungen.

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

Die Summary darf enthalten:

- kurze Problemzusammenfassung
- relevante Annahmen
- gewählte Strategie
- geplante Schritte
- erkannte Risiken
- nächster geplanter Schritt
- Ergebnis einer Prüfung

Die Summary darf nicht enthalten:

- versteckte Systemprompts
- interne Modell-Tokens
- vollständige Gedankengänge
- vertrauliche Tool- oder Policy-Informationen
- Secrets
- private Chain-of-Thought
- unredigierte Debug-Daten

---

# 2. Anzeige optional konfigurierbar machen

Füge eine Einstellung hinzu:

```ts
export type ReasoningDisplayMode =
  | "hidden"
  | "summary"
  | "expanded";
```

Bedeutung:

```text
hidden   → keine Reasoning Summary anzeigen
summary  → kompakte ein- bis dreizeilige Zusammenfassung
expanded → strukturierte Schritte, Annahmen und Risiken anzeigen
```

Empfohlener Standard:

```text
summary
```

Die Einstellung soll verfügbar sein:

- global in Settings
- optional pro Chat/Run überschreibbar
- ohne Neustart wirksam

---

# 3. Chat-Darstellung

Reasoning Summaries als einklappbaren Chat-Block anzeigen.

Beispiel:

```text
Warum CODEE diesen Weg wählt

- Die betroffene Datei wurde identifiziert.
- Die Änderung betrifft nur eine Funktion.
- Ein Typecheck ist nach der Änderung erforderlich.

[Details anzeigen]
```

Anforderungen:

- standardmäßig eingeklappt
- klar von normaler Assistant-Antwort getrennt
- nicht wie eine Systemnachricht darstellen
- Zeitstempel optional
- Run-ID intern verknüpfen
- nicht editierbar
- keine Markdown-Ausführung aus untrusted Inhalten

---

# 4. Ereignisbasierte Chat-Actions

Definiere einen zentralen Contract:

```ts
export type ChatActionKind =
  | "approve_patch"
  | "reject_patch"
  | "apply_patch"
  | "rollback_patch"
  | "approve_command"
  | "reject_command"
  | "approve_web_access"
  | "reject_web_access"
  | "confirm_continue"
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
  state: "pending" | "approved" | "rejected" | "expired" | "completed" | "failed";
  createdAt: string;
}
```

Keine lose, UI-spezifische Button-Logik direkt in Chat-Komponenten.

---

# 5. Wann Buttons erscheinen müssen

Buttons erscheinen immer dann, wenn eine Nutzerentscheidung erforderlich ist.

## Dateiänderungen

```text
Patch Proposal vorhanden
→ [Übernehmen] [Ablehnen]
```

Nach Apply:

```text
→ [Rollback] [Tests starten]
```

## Terminal-/Shell-Befehle

Bei genehmigungspflichtigen Commands:

```text
→ [Befehl ausführen] [Ablehnen]
```

Bei laufendem Command:

```text
→ [Abbrechen]
```

## Websuche

Bei aktivierter Approval Policy:

```text
→ [Websuche erlauben] [Ablehnen]
```

## Agentenfortsetzung

Bei Review Gate oder risikoreicher Folgeaktion:

```text
→ [Fortsetzen] [Stoppen]
```

---

# 6. Buttons direkt an die vorhandenen Actions binden

Bestehende Methoden wiederverwenden:

```text
approveAgentPatch
rejectAgentPatch
applyAgentPatch
rollbackAgentPatch
executeSafeCommand
cancelSafeCommand
webSearch approval flow
review gate approve/reject
```

Keine zweite Action-Infrastruktur bauen.

Die Chat-UI darf nur Events auslösen.  
Die eigentliche Policy- und Sicherheitsprüfung bleibt in Store, Service, Host und Backend.

---

# 7. Zustandsmodell

Buttons müssen den tatsächlichen Zustand anzeigen.

Beispiel:

```text
pending
→ approved
→ applying
→ completed
```

Oder:

```text
pending
→ rejected
```

Anforderungen:

- nach Klick sofort deaktivieren
- keine doppelten Aktionen
- stale Approval blockieren
- veraltete Buttons als abgelaufen markieren
- Status nach App-Refresh rekonstruieren, soweit Persistenz vorhanden
- Fehler sichtbar am Action-Block anzeigen

---

# 8. Chat-Message-Verknüpfung

Jede genehmigungspflichtige Aktion muss an eine konkrete Chat-Nachricht gebunden sein.

```ts
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  reasoningSummary?: AgentReasoningSummary;
  actions?: ChatActionRequest[];
}
```

Anforderungen:

- Assistant-Text und Actions dürfen unabhängig aktualisiert werden
- Streaming darf Actions nicht überschreiben
- Actions bleiben sichtbar, bis sie abgeschlossen oder verworfen sind
- Ergebnis der Aktion als Folge-Nachricht hinzufügen

---

# 9. Sicherheitsregeln

- Keine private Chain-of-Thought anzeigen
- Keine Rohmodell-Reasoning-Tokens speichern
- Nur bewusst erzeugte Summary speichern
- Secrets redigieren
- Tool-Interna nicht offenlegen
- Buttons umgehen keine Policy
- Buttons umgehen keine Review Gates
- keine Auto-Bestätigung
- keine implizite Zustimmung durch Scrollen oder Öffnen
- riskante Aktionen immer explizit bestätigen

---

# 10. UX-Regeln

Buttons müssen:

- direkt unter der relevanten Chat-Nachricht erscheinen
- klar benannt sein
- Risikolevel anzeigen
- bei laufender Aktion deaktiviert sein
- Erfolgs- oder Fehlerstatus anzeigen
- tastaturbedienbar sein
- Screenreader-Labels besitzen

Beispiel:

```text
CODEE möchte 2 Dateien ändern.

Risiko: Mittel

[Diff anzeigen] [Übernehmen] [Ablehnen]
```

---

# 11. Reasoning Summary für verschiedene Agentenaktionen

## Patch

```text
- Datei gefunden
- Änderung lokal begrenzt
- Typecheck erforderlich
```

## Terminal

```text
- Typecheck prüft die Änderung
- Kein Schreibzugriff
- Erwartete Dauer unter 2 Minuten
```

## Websuche

```text
- Lokale Informationen reichen nicht aus
- Offizielle Dokumentation soll verifiziert werden
- Nur freigegebene Domains werden verwendet
```

---

# 12. Acceptance-Test

Testfall:

1. Nutzer fragt:
   `Korrigiere src/math.ts und prüfe die Änderung.`

2. Agent erzeugt:
   - Reasoning Summary
   - Patch Proposal
   - Chat Action `approve_patch`

3. Chat zeigt:
   - einklappbare Reasoning Summary
   - Diff
   - Buttons `Übernehmen` und `Ablehnen`

4. Nutzer klickt `Übernehmen`

5. Button wird deaktiviert

6. Patch wird angewendet

7. Chat zeigt:
   - Status `angewendet`
   - Buttons `Tests starten` und `Rollback`

8. Nutzer klickt `Tests starten`

9. Command läuft

10. Chat zeigt:
   - Live-Status
   - Ergebnis
   - keine doppelten Actions

---

# 13. Pflicht-Tests

1. Reasoning Mode `hidden`
2. Reasoning Mode `summary`
3. Reasoning Mode `expanded`
4. keine Roh-CoT gespeichert
5. Patch Approval Button erscheint
6. Reject Button funktioniert
7. stale Approval blockiert
8. doppelter Klick blockiert
9. Command Approval erscheint
10. Web Approval erscheint
11. Streaming überschreibt Actions nicht
12. Workspace-Wechsel invalidiert Actions
13. Actions bleiben bis Abschluss sichtbar
14. Rollback Button nach Apply
15. Fehlerstatus wird angezeigt
16. Accessibility Labels vorhanden
17. Refresh rekonstruiert persistierte Actions
18. Secrets werden redigiert

---

# 14. Qualitäts-Gates

Vor Abschluss:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke-test
pnpm test:chat-file-apply
pnpm test:agent-shell
pnpm test:agent-web
```

Ergänze:

```powershell
pnpm test:chat-actions
```

---

# 15. Definition of Done

Die Phase ist abgeschlossen, wenn:

1. Reasoning Summary optional im Chat sichtbar ist
2. keine private Chain-of-Thought angezeigt wird
3. Freigabe-Buttons automatisch erscheinen, sobald sie erforderlich sind
4. Patch-, Command-, Web- und Review-Gate-Aktionen unterstützt werden
5. Buttons bestehende sichere Actions auslösen
6. stale oder doppelte Aktionen blockiert werden
7. Streaming den Action-State nicht überschreibt
8. Status und Ergebnis direkt im Chat erscheinen
9. Accessibility vorhanden ist
10. ein echter End-to-End-Test den Ablauf beweist

---

# 16. Nicht Teil dieser Phase

Nicht umsetzen:

- Roh-CoT-Anzeige
- vollständige interne Modellprotokolle
- automatische Bestätigung
- Policy-Bypass über UI
- neue parallele Review-Gate-Architektur
- große Chat-Neugestaltung

---

# 17. Abschlussbericht

Liefern:

1. Reasoning-Summary-Contract
2. Chat-Action-Contract
3. geänderte Dateien
4. unterstützte Action-Typen
5. UI-Nachweis
6. E2E-Test
7. Sicherheitsnachweis
8. bekannte Einschränkungen

Empfohlene Commits:

```text
feat(chat): add optional reasoning summaries
feat(chat): add contextual approval actions
feat(agent): connect patch command and web approvals
test(chat): verify contextual action lifecycle
docs(status): document chat reasoning and approvals
```
