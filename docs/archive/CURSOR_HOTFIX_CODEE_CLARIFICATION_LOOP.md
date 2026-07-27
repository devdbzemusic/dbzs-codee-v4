# CURSOR HOTFIX
# Division By Zeros (DBZS) Codee
# Planungsschleife durch wiederholte Clarification-Fragen beheben

Repository:

`C:\Users\ralle\source\repos\dbzs-codee-project`

Ausgangspunkt:

aktueller `main`, mindestens Merge PR 35 (`5b9d2a7`)

Arbeitsbranch:

`fix/clarification-field-memory-loop`

## Ziel

Behebe ausschließlich die wiederholte Rückfrage-Schleife im Runtime Chat.

Aktuelles reproduzierbares Verhalten:

```text
Benutzer:
Erstelle einen klaren Implementierungsplan mit konkreten Schritten, Risiken und Tests.

Codee:
Woran würdest du erkennen, dass die Planung erfolgreich war?

Benutzer beantwortet die Frage.

Spätere Folgefrage:
Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.

Codee fragt erneut:
Woran würdest du erkennen, dass die Planung erfolgreich war?
```

Die erste Frage ist in der UI bereits als beantwortet markiert. Trotzdem wird dieselbe semantische Frage erneut erzeugt.

Keine neue Architektur.
Keine Änderung an Modellrouting, Lazy Loading oder Context Budget.
Keine Commits, Pushes, PRs oder Merges ohne Freigabe.

---

## Nachgewiesene Ursache

`missingInformationPolicy.ts` prüft fehlende Felder nur gegen die jeweils aktuelle Benutzernachricht.

Für Planung:

```ts
const hasSuccessCriteria = SUCCESS_CRITERIA_PATTERN.test(message);
```

Der bestehende `ActiveTaskContract` und bereits beantwortete Rückfragen werden nicht berücksichtigt.

Zusätzlich erzeugt `questionId()` bei jeder Prüfung eine neue zufällige ID:

```ts
q-success-<timestamp>-<random>
```

Dadurch erkennt die UI dieselbe semantische Frage als neue Frage.

`ActiveTaskContract.answeredQuestions` speichert nur:

```ts
{ question: string; answer: string }
```

Es fehlt eine stabile Feldzuordnung wie:

```text
success_criteria
constraints
target
acceptance_criteria
```

---

# P0 – Semantische Clarification-Felder speichern

Erweitere beantwortete Rückfragen um eine stabile Feld-ID.

```ts
interface AnsweredClarificationField {
  field:
    | "target"
    | "acceptance_criteria"
    | "scope_boundary"
    | "review_target"
    | "review_focus"
    | "success_criteria"
    | "constraints";

  questionId: string;
  question: string;
  answer: string;
  answeredAt: string;
}
```

Im `ActiveTaskContract`:

```ts
answeredFields: Record<string, AnsweredClarificationField>;
```

Migration:

- bestehende `answeredQuestions` weiterhin lesen;
- bekannte Fragen einmalig auf Felder abbilden;
- keine Daten verlieren;
- neue Schreibvorgänge verwenden `answeredFields`.

---

# P0 – RequiredFieldCheck muss stabile Feld-ID tragen

`RequiredFieldCheck.field` ist bereits vorhanden und muss bis zur Frage und Antwort durchgereicht werden.

`AssistantQuestion` additiv erweitern:

```ts
requiredField?: string;
workflow?: ClarificationWorkflow;
```

Beim Erzeugen:

```ts
askIfMissing.requiredField = check.field;
```

Beim Beantworten:

```ts
appendContractFieldAnswer(
  workspaceRoot,
  question.requiredField,
  question.id,
  question.prompt,
  answer
);
```

Kein Matching ausschließlich anhand des Fragetextes.

---

# P0 – Fehlende Informationen gegen Task Contract prüfen

`checkMissingInformation()` erhält zusätzlich:

```ts
interface MissingInformationState {
  answeredFields: ReadonlySet<string>;
  confirmedGoal?: string;
  acceptanceCriteria?: string[];
}
```

Beispiel:

```ts
checkMissingInformation(
  workflow,
  taskType,
  userMessage,
  hasFileContext,
  {
    answeredFields: new Set(Object.keys(contract?.answeredFields ?? {})),
    confirmedGoal: contract?.confirmedGoal,
    acceptanceCriteria: contract?.acceptanceCriteria
  }
);
```

Regeln:

```text
Feld im Contract beantwortet
→ present = true

Feld in aktueller Nachricht enthalten
→ present = true

sonst
→ Rückfrage stellen
```

Für Planung:

```ts
const hasSuccessCriteria =
  state.answeredFields.has("success_criteria") ||
  SUCCESS_CRITERIA_PATTERN.test(message) ||
  Boolean(state.acceptanceCriteria?.length);
```

Eine bereits vorhandene konkrete Feature-Abnahme darf als Planungserfolgskriterium gelten, sofern sie den Zielzustand eindeutig beschreibt.

Für Constraints:

```ts
state.answeredFields.has("constraints")
```

Wenn der Nutzer ausdrücklich keine weiteren Vorgaben nennt, muss auch das als beantwortet gespeichert werden:

```text
constraints = "Keine zusätzlichen Vorgaben; bestehende Projektkonventionen verwenden."
```

---

# P0 – Keine erneute identische Frage

Vor dem Erzeugen einer Frage:

```text
1. Ist requiredField bereits beantwortet?
2. Ist dasselbe requiredField aktuell pending?
3. Ist dieselbe Frage im aktuellen Run bereits completed?
```

Falls ja:

```text
keine neue Frage erzeugen
```

Nicht nur Frage-ID vergleichen, sondern:

```text
workspaceId + workflowId + requiredField
```

als semantischen Schlüssel verwenden.

Beispiel:

```ts
clarificationKey =
  `${workspaceId}:${workflowId}:${requiredField}`;
```

---

# P0 – Pending Question nach Antwort vollständig abschließen

Beim erfolgreichen Beantworten atomar:

```text
1. Antwort validieren
2. answeredFields aktualisieren
3. pending-question.json löschen
4. Frageaktion auf completed setzen
5. Runtime-Workflow fortsetzen
```

Bei App-Neustart:

- completed Frage nicht wiederherstellen;
- nur tatsächlich pending Frage rehydrieren;
- wenn Feld im Contract bereits beantwortet ist, veraltete Pending-Datei löschen.

---

# P0 – PRESET-Folgefragen nicht erneut in Preflight festhalten

Die Presets:

```text
Plan
Next
Summarize
Review
```

müssen den aktiven Task Contract verwenden.

Bei:

```text
Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.
```

und beantwortetem `success_criteria`:

```text
kein ask_user
→ Planning-Run starten
```

Falls `constraints` noch fehlen:

- höchstens diese eine neue Feldfrage stellen;
- danach nicht erneut `success_criteria`.

---

# UI

Die bereits erledigte Frage darf einmal im Verlauf sichtbar bleiben.

Nicht zulässig:

```text
erledigte Frage
+
neue identische Systemfrage
+
neue identische Aktionskarte
```

Optional Diagnose:

```text
Clarification:
success_criteria = answered
constraints = pending
```

---

# Tests

1. Planning fragt `success_criteria` genau einmal.
2. Antwort speichert `requiredField=success_criteria`.
3. nächste Plan-Folgefrage stellt `success_criteria` nicht erneut.
4. zufällige neue Question-ID umgeht die Feldsperre nicht.
5. dieselbe Feldfrage kann nicht gleichzeitig doppelt pending sein.
6. App-Neustart rehydriert keine bereits beantwortete Frage.
7. veraltete `pending-question.json` wird entfernt, wenn Feld beantwortet ist.
8. bestehende Feature-Akzeptanzkriterien können Planungserfolg abdecken.
9. unbeantwortete `constraints` dürfen separat einmal gefragt werden.
10. „Keine weiteren Vorgaben“ erfüllt `constraints`.
11. Workspace A und B besitzen getrennte Clarification-Felder.
12. Workspacewechsel vermischt keine Antworten.
13. PRESET `Next` startet nach beantworteten Pflichtfeldern den Run.
14. PRESET `Plan` startet nach beantworteten Pflichtfeldern den Run.
15. ask_user-Pause/Resume bleibt funktionsfähig.
16. Lazy Runtime Loading bleibt grün.
17. kein Modell wird während einer echten Rückfrage geladen.
18. Rollenmodellrouting bleibt unverändert.
19. Context Budget bleibt unverändert.
20. Typecheck, Desktop-Tests und Build grün.

---

# Reproduktionsabnahme

1. Bestehenden StringLab Task Contract öffnen.
2. Planungserfolg einmal beantworten.
3. Senden:

```text
Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.
```

Erwartet:

```text
keine erneute Erfolgskriterien-Frage
→ Planner-Routing
→ Rollenmodell aus Settings
→ On-Demand-Start
→ Planungsantwort
```

---

# Arbeitsweise

1. aktuellen Head ausgeben
2. Datenfluss Frage → Antwort → Contract → Preflight kartieren
3. tatsächliche Ursache bestätigen
4. kleinen Änderungsplan ausgeben
5. erst danach Code ändern
6. Regressionstests ergänzen
7. Reproduktionsfall ausführen
8. Abschlussbericht liefern
9. nicht committen
10. nicht pushen
11. keinen PR erstellen
12. nicht mergen

Beginne nur mit Analyse und Änderungsplan.
