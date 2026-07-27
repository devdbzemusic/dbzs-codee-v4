# CURSOR MASTERPROMPT
# Division By Zeros (DBZS) Codee
# Binding Model Roles + Conversation-aware Workflow + Grounded Planning

Repository:

`C:\Users\ralle\source\repos\dbzs-codee-project`

Arbeitsbranch:

`fix/binding-model-roles-workflow-grounding`

## Mission

Behebe ausschließlich die aktuell nachgewiesenen Routing- und Grounding-Fehler im Runtime Chat.

Keine neue Agentenarchitektur.
Keine UI-Neugestaltung.
Keine neuen Produktfeatures.
Lazy Runtime Loading muss erhalten bleiben.

Der bereits funktionierende Ablauf darf nicht beschädigt werden:

```text
Codee startet
→ kein Arbeitsmodell geladen
→ Benutzer beschreibt Aufgabe
→ Rückfragen werden gestellt
→ Antworten werden übernommen
→ Context Budget wird berechnet
→ genau ein Modell wird On-Demand gestartet
```

Der aktuelle Fehler beginnt danach:

```text
Rollenmodell in Settings gewählt
→ Runtime Chat ignoriert oder überschreibt diese Auswahl
→ Workflow-Fortsetzung wird als neue Einzelanfrage klassifiziert
→ falsche Agentenrolle
→ falsches Modell
→ Antwort ist thematisch unpassend
→ unbelegte oder falsche Dateipfade werden genannt
```

---

# Nachgewiesener Reproduktionsfall

Workspace:

`C:\Users\ralle\source\repos\dbzssl`

Ausgangsaufgabe:

```text
Wir bauen heute eine kleine neue Funktion für StringLab
```

Featureantwort:

```text
Eine Smart Practice Session für Gitarre und Bass mit Übungsziel, Dauer, BPM, Start, Pause, Fortsetzen und lokaler Speicherung.
```

Akzeptanzkriterien:

```text
Die Funktion ist korrekt, wenn eine Session für Gitarre oder Bass angelegt, gestartet, pausiert, fortgesetzt und beendet werden kann. Dauer, BPM, Übungsziel und Status müssen korrekt angezeigt und lokal gespeichert werden. Nach einem Neustart muss eine unterbrochene Session wiederhergestellt werden. Bestehende StringLab-Funktionen dürfen nicht beeinträchtigt werden.
```

Folgefrage:

```text
Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.
```

Aktuelles Fehlverhalten:

- Folgefrage wird als `casual_chat` oder neuer isolierter Task klassifiziert.
- aktiver Smart-Practice-Session-Workflow wird nicht bindend berücksichtigt.
- Rollenmodell aus Settings wird nicht zuverlässig verwendet.
- Slotmanager oder nachgelagerter Router wählt erneut ein Modell.
- Qwen2.5-VL kann ohne Bild erscheinen.
- sichtbare Modell-ID und Modellname können nicht zusammenpassen.
- Antwort schlägt falsche Themen vor:
  - AudioVisualizer/Tuner
  - Rig Grid Editor
  - Musiker-Navigator
  - Practice Coach Agent
- Dateipfade werden genannt, ohne vorherige Tool-Verifikation.
- `0 Tool-Ergebnisse`, aber konkrete Dateien werden als existent dargestellt.

---

# P0 – Eine einzige bindende Modellentscheidung

## Ziel

Es darf pro Run genau eine autoritative Modellentscheidung geben.

Neue oder bereinigte Struktur:

```ts
interface BindingModelDecision {
  decisionId: string;
  workspaceId: string;
  runId: string;

  taskType: RuntimeTaskType;
  workflowId?: string;
  targetAgent:
    | "runtime_chat"
    | "planner"
    | "coder"
    | "reviewer"
    | "debugger";

  configuredModelId: string;
  resolvedModelId: string;
  resolvedModelName: string;

  slotId: RuntimeSlotId;
  providerId: "llama-cpp";

  selectionSource:
    | "role_setting"
    | "manual_selection"
    | "explicit_fallback";

  fallbackReason?: string;
  capabilities: string[];
  hasImageInput: boolean;
  requiresVision: boolean;

  createdAt: string;
}
```

Danach gilt zwingend:

```text
Broker entscheidet Modell und Slot
→ Slotmanager erhält exakt resolvedModelId
→ Slotmanager startet exakt resolvedModelId
→ keine zweite Modellwahl
→ kein stiller Ersatz
```

Der Slotmanager darf nur ausführen:

```ts
startSlot(decision.slotId, decision.resolvedModelId)
```

Nicht mehr:

```ts
resolveDefaultModelForSlot(...)
selectDefaultModelForSlot(...)
erstes passendes lokales Modell
bereits laufendes Modell bevorzugen
```

wenn bereits eine bindende Entscheidung existiert.

---

# P0 – Settings-Rollen sind Source of Truth

Diese Felder müssen verbindlich sein:

```text
defaultChatModelId
defaultPlannerModelId
defaultCoderModelId
defaultReviewerModelId
defaultDebugModelId
```

Zuordnung:

```text
runtime_chat → defaultChatModelId
planner      → defaultPlannerModelId
coder        → defaultCoderModelId
reviewer     → defaultReviewerModelId
debugger     → defaultDebugModelId
```

Regeln:

1. Rollenmodell aus Settings zuerst auflösen.
2. ID muss im Modellindex existieren.
3. Modell muss lauffähig sein.
4. Capability muss zur Rolle passen.
5. Modell darf nicht still ersetzt werden.
6. Bei Fehler:
   - klarer Diagnosefehler;
   - sichtbare Fallback-Auswahl;
   - kein automatischer beliebiger Kandidat.

Beispiel:

```text
Plan-Modell nicht lauffähig:
gemma-4-E4B-it-Q4_K_M benötigt mehr Ressourcen als verfügbar.

Optionen:
A – Qwen2.5-Coder-3B verwenden
B – anderes Plan-Modell auswählen
C – abbrechen
```

Kein unsichtbarer Wechsel.

---

# P0 – Zweite Router entfernen oder entmachten

Prüfe insbesondere:

```text
apps/desktop/src/services/modelSelectionBroker.ts
apps/desktop/src/services/modelRouterService.ts
apps/desktop/src/services/runtimeSlotManager.ts
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/services/runtimeSlotValidator.ts
backend/app/runtime/*
```

Anforderungen:

- `modelSelectionBroker` oder ein neuer klar benannter Service ist einzige Entscheidungsinstanz.
- `modelRouterService` darf nicht:
  - bereits laufendes Modell statt Rollenmodell zurückgeben;
  - ersten lokalen Kandidaten wählen;
  - Chat-Rolle auf `defaultModelId` statt `defaultChatModelId` legen.
- `runtimeSlotManager` ist nur Executor.
- Backend darf nicht erneut routen.
- Slotprüfung darf nur validieren:
  - Slot existiert;
  - Modell passt technisch;
  - Ressourcen reichen;
  - keine ID-Änderung.

---

# P0 – Modell-ID und Modellname müssen zusammengehören

Aktueller Fehler:

```text
Modell gewählt: <Hash-ID>
Analyse-Protokoll: Qwen2.5-VL...
Settings: anderes Rollenmodell
```

Regel:

`resolvedModelId` und `resolvedModelName` müssen aus demselben `IndexedModel` stammen.

Nicht zulässig:

```ts
modelId: selectedRoleModelId
modelName: settings.defaultModelName
```

Stattdessen:

```ts
const indexedModel = modelIndex.getById(resolvedModelId);

decision.resolvedModelId = indexedModel.id;
decision.resolvedModelName = indexedModel.name;
```

UI und Diagnose verwenden ausschließlich die bindende Entscheidung.

Anzeigen:

```text
Workflow: planning
Agent: planner
Modell: Qwen2.5-Coder-3B-Instruct-Q4_K_M
Modell-ID: ...
Slot: fast_gpu
Quelle: role_setting
Auswahlgrund: active_workflow_planning
```

Keine Hash-ID als alleinige Anzeige.

---

# P0 – Visionmodell-Gate

Ein Visionmodell darf ausschließlich gewählt werden, wenn:

```text
hasImageInput === true
ODER
requiresVision === true
```

Reine Textfolgefragen:

```text
hasImageInput = false
requiresVision = false
```

Dann sind Modelle mit Rollen oder Capabilities wie:

```text
vision
multimodal
image_text_to_text
vision_chat
```

ausgeschlossen.

Manuelle explizite Auswahl eines Visionmodells ohne Bild:

- darf respektiert werden;
- muss aber eine sichtbare Warnung erzeugen;
- niemals als automatischer Fallback.

---

# P0 – Workflow-Fortsetzung vor Einzel-Intent

## Problem

Die Folgefrage:

```text
Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.
```

wird isoliert klassifiziert und verliert den bereits bestätigten Auftrag.

## Lösung

Vor neuer Intent-Klassifikation prüfen:

```text
Gibt es einen aktiven Workspace-gebundenen Workflow?
Gibt es einen bestätigten Task Contract?
Ist die Nachricht semantisch eine Folgefrage?
```

Neue Struktur:

```ts
interface ActiveTaskContract {
  workspaceId: string;
  workflowId: string;
  runId: string;

  originalRequest: string;
  confirmedGoal: string;
  acceptanceCriteria: string[];

  currentPhase:
    | "clarification"
    | "planning"
    | "awaiting_plan_approval"
    | "implementation"
    | "testing"
    | "review"
    | "completed"
    | "cancelled";

  assignedAgent: ModelTargetAgent;
  answeredQuestions: Array<{
    question: string;
    answer: string;
  }>;

  createdAt: string;
  updatedAt: string;
}
```

Routing-Priorität:

```text
1. expliziter Abbruch / neuer Task
2. aktiver Task Contract
3. Folgefragen-Erkennung
4. erst danach Einzel-Intent-Klassifikation
```

Beispiele für Follow-up:

```text
Was sind die nächsten Schritte?
Mach weiter.
Zeig mir den Plan.
Welche Dateien wären betroffen?
Warum ist das nötig?
Gib mir drei Prioritäten.
```

Diese Nachrichten bleiben im aktiven Workflow.

Erwartet:

```text
workflow = smart_practice_session
phase = planning
targetAgent = planner
taskType = planning_follow_up
```

Nicht:

```text
casual_chat
small_code_change ohne Workflowbezug
```

---

# P0 – Task Contract bindend in den Kontext

Nach den Rückfragen muss Codee einen kompakten verbindlichen Block erzeugen:

```text
[ACTIVE TASK CONTRACT]

Projekt:
DBZS StringLab Workbench

Ziel:
Smart Practice Session für Gitarre und Bass

MVP:
- Übungsziel
- Dauer
- BPM
- Start
- Pause
- Fortsetzen
- Beenden
- lokale Speicherung
- Wiederherstellung nach Neustart

Akzeptanz:
- Lifecycle funktioniert
- Status korrekt
- lokale Persistenz
- bestehende Funktionen bleiben intakt

Aktuelle Phase:
Planung

Benutzerfrage:
Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.
```

Dieser Block hat höhere Priorität als:

- allgemeine README-Ideen;
- alte Projektprioritäten;
- STUB-TODO-Vorschläge;
- generische RAG-Treffer.

---

# P0 – Grounded Planning

Projektdateien dürfen nur als vorhanden bezeichnet werden, wenn sie verifiziert wurden.

Vor jeder planenden Antwort mit Dateinennung:

1. `list_files` oder Indexabfrage ausführen.
2. relevante Datei mit `read_file` oder bestätigtem Index öffnen.
3. Existenz und Pfad dokumentieren.
4. erst danach Datei in der Antwort nennen.

Regel:

```text
0 Tool-Ergebnisse
→ keine konkreten Dateien als existent darstellen
```

Ohne Verifikation formulieren:

```text
Voraussichtlich betroffen:
- Domain-Modell
- Persistenzdienst
- Practice-UI

Die exakten Dateien müssen zuerst im Workspace geprüft werden.
```

Mit Verifikation:

```text
Bestätigt vorhanden:
- src/domain/...
- src/app/AppProvider.tsx
- ...
```

Keine erfundenen Pfade wie:

```text
src/agents/MuzNavigatorAgent
src/agents/PracticeCoachAgent.js
```

sofern nicht tatsächlich vorhanden.

---

# P1 – Planungsantwort gegen Task Contract validieren

Vor Ausgabe eine leichte Relevanzprüfung:

```ts
interface GroundingValidation {
  taskGoalMentioned: boolean;
  acceptanceCriteriaCovered: boolean;
  proposedStepsRelevant: boolean;
  citedFilesVerified: boolean;
  unrelatedTopicDetected: boolean;
}
```

Wenn die Antwort stark vom bestätigten Auftrag abweicht:

```text
Rig Grid
Tuner
AudioVisualizer
Musiker-Navigator
```

obwohl Smart Practice Session gefragt ist:

- Antwort verwerfen;
- einmal mit kompaktem Task Contract neu generieren;
- kein Retry-Loop.

Diagnose:

```text
answer_relevance_retry
reason: unrelated_project_topics
```

---

# P1 – Settings-UI ehrlich machen

Die Rollen-Auswahl ist aktuell semantisch zu stark formuliert, solange sie nicht bindend ist.

Nach dieser Reparatur soll sie tatsächlich bindend sein.

Anzeigen:

```text
Plan:
<Modellname>
Status: bindend
Capability: chat/code
Lauffähig: ja/nein
Ressourcenprofil: passend/grenzwertig/nicht passend
```

Bei nicht lauffähigem Modell:

- Dropdown-Eintrag deaktivieren oder klar warnen;
- gespeicherte fehlerhafte Auswahl nicht still verwenden;
- kein automatischer Ersatz ohne sichtbare Entscheidung.

Die Hash-ID darf sekundär angezeigt werden, nicht als primärer Name.

---

# P1 – Lazy Runtime Loading erhalten

Vor Aufgabe:

```text
Arbeitsmodell: nicht geladen
```

Während Rückfragen:

```text
kein Arbeitsmodell starten
```

Nach bindender Entscheidung:

```text
genau das konfigurierte Rollenmodell On-Demand starten
```

Kein Vorladen, kein Slot-Default, kein beliebiges resident Modell.

---

# Tests

## Rollenbindung

1. Chat nutzt exakt `defaultChatModelId`.
2. Plan nutzt exakt `defaultPlannerModelId`.
3. Coding nutzt exakt `defaultCoderModelId`.
4. Review nutzt exakt `defaultReviewerModelId`.
5. Debug nutzt exakt `defaultDebugModelId`.
6. mehrere Rollen dürfen denselben Slot, aber unterschiedliche Modelle verwenden.
7. Slotmanager ändert die Modell-ID nicht.
8. Backend routet nicht erneut.
9. laufendes anderes Modell überschreibt Rollenwahl nicht.
10. kein stiller erster lokaler Kandidat.

## Modellidentität

11. ID und Name stammen aus demselben Indexeintrag.
12. Diagnose zeigt Name, ID, Rolle, Slot und Quelle.
13. unbekannte ID erzeugt Fehler.
14. nicht lauffähiges Modell erzeugt sichtbare Fallback-Entscheidung.
15. keine falsche `defaultModelName`-Anzeige.

## Workflow-Fortsetzung

16. offene Featureanfrage erzeugt Task Contract.
17. erste und zweite Antwort werden gespeichert.
18. „Gib die nächsten 3 Schritte“ bleibt im Planning-Workflow.
19. Follow-up wird nicht als casual_chat klassifiziert.
20. explizit „Neue Aufgabe:“ startet neuen Workflow.
21. Workspacewechsel deaktiviert alten Task Contract.
22. Neustart stellt aktiven Task Contract korrekt wieder her.

## Vision

23. Textfrage ohne Bild wählt kein Visionmodell.
24. Bildanhang erlaubt Visionmodell.
25. manuelle Visionauswahl ohne Bild zeigt Warnung.

## Grounding

26. ohne Toolergebnis keine konkrete Datei als vorhanden ausgeben.
27. verifizierte Dateien dürfen genannt werden.
28. nicht vorhandene Datei wird erkannt.
29. erfundene Agentenpfade führen zum Validierungsfehler.
30. Cross-Workspace-Pfade bleiben ausgeschlossen.

## Antwortrelevanz

31. Smart-Practice-Auftrag erzeugt Smart-Practice-Schritte.
32. Rig-Grid/Tuner-Vorschläge werden als thematisch fremd erkannt.
33. genau ein Relevanz-Retry erlaubt.
34. Retry nutzt kompakten Task Contract.
35. keine Endlosschleife.

## Lazy Loading

36. Chatöffnung lädt kein Arbeitsmodell.
37. ask_user lädt kein Arbeitsmodell.
38. nach Planning-Entscheidung startet exakt das Plan-Modell.
39. Abbruch vor Start lädt kein Modell.
40. Workspacewechsel während Start verwirft den Start.

---

# Reproduktions-Erwartung

Nach dem beschriebenen Interview und der Folgefrage muss Codee sinngemäß antworten:

```text
1. Bestehende Practice-, Domain- und Persistenzstrukturen prüfen
   Begründung: Das neue Feature muss in vorhandene Projekt- und Storage-Verträge integriert werden, ohne eine Parallelarchitektur zu erzeugen.

2. Versioniertes PracticeSession-Datenmodell und Lifecycle definieren
   Begründung: Start, Pause, Fortsetzen, Beenden und Wiederherstellung benötigen eindeutige Zustände und migrationsfähige Persistenz.

3. UI- und Persistenzintegration planen und anschließend zur Freigabe vorlegen
   Begründung: Vor Dateiänderungen müssen betroffene Komponenten, Tests, Safe-Mode-Verhalten und Definition of Done bestätigt sein.
```

Wenn konkrete Dateien genannt werden, müssen sie vorher verifiziert worden sein.

---

# Definition of Done

- Rollenmodelle aus Settings sind bindend.
- Nur eine autoritative Modellentscheidung pro Run.
- Slotmanager ist reiner Executor.
- Kein zweiter Router überschreibt die Entscheidung.
- Chat verwendet `defaultChatModelId`.
- ID und Name stimmen überein.
- Visionmodell ohne Bild ausgeschlossen.
- aktiver Workflow wird vor Einzel-Intent berücksichtigt.
- Task Contract wird gespeichert und fortgeführt.
- Folgefragen bleiben im selben Workflow.
- Dateipfade sind verifiziert.
- Antwort ist auf bestätigtes Ziel und Akzeptanzkriterien bezogen.
- Lazy Loading bleibt aktiv.
- Workspace-Isolation bleibt aktiv.
- Context Budget bleibt grün.
- Typecheck grün.
- Desktop-Tests grün.
- Backend-Tests grün.
- Produktions-Build grün.
- keine Commits, Pushes, PRs oder Merges ohne Freigabe.

---

# Arbeitsweise

1. aktuellen Head und Branch ausgeben
2. tatsächliche Routingpfade vollständig kartieren
3. alle Stellen nennen, die Modellentscheidungen verändern
4. minimalen Implementierungsplan vorlegen
5. erst danach Code ändern
6. kleine überprüfbare Schritte
7. Tests nach jedem Schritt
8. Reproduktionsfall ausführen
9. Diagnoseausgabe zeigen
10. Abschlussbericht liefern
11. nicht committen
12. nicht pushen
13. keinen PR erstellen
14. nicht mergen

---

# Abschlussbericht

Liefere:

1. Ausgangs-Head
2. geänderte Dateien
3. vorherige Mehrfach-Router
4. neue Source of Truth
5. Rollenmodell-Zuordnung
6. Workflow-Fortsetzung
7. Task-Contract-Persistenz
8. Vision-Gate
9. Grounding-Prüfung
10. Testergebnisse
11. Reproduktionsnachweis
12. verbleibende Risiken
13. nächster kleiner Produktionsreife-Schritt

Beginne jetzt ausschließlich mit der Analyse. Noch keine Änderungen, bevor du alle tatsächlichen Modell- und Slot-Routingpfade sowie den geplanten Änderungsumfang genannt hast.
