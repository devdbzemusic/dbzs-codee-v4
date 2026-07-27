# CURSOR MASTERPROMPT
# Division By Zeros (DBZS) Codee
# Hotfix – Bindende Rollenmodelle, Workflow-Grenzen, Grounding und 3-GB-Runtime-Abnahme

Repository:

`C:\Users\ralle\source\repos\dbzs-codee-project`

Ausgangspunkt:

aktueller `main`

Erwarteter Stand:

PR 34 / Merge `718fb889` oder neuer

Arbeitsbranch:

`fix/role-models-hotfix-3gb-grounding`

---

## Mission

Behebe ausschließlich die nach PR 34 noch offenen Fehler.

Keine neue Agentenarchitektur.
Keine UI-Neugestaltung.
Keine neuen Produktfeatures.
Kein Umbau des Context-Budget-Systems.
Lazy Runtime Loading muss erhalten bleiben.
Workspace-Isolation und `ask_user` dürfen nicht regressieren.

Die Rollenmodelle wurden vom Benutzer bewusst auf lokal tragbare Modelle mit maximal etwa 3,1 GB umgestellt.

Aktuelle Rollenbelegung laut Settings:

```text
Chat:
Qwen2.5-VL-3B-Instruct.Q4_K_M
ca. 1,8 GB

Coding:
Yi-Coder-9B-Chat.Q2_K
ca. 3,1 GB

Review:
qwen2.5-coder-3b-instruct-q8_0
ca. 3,1 GB

Plan:
qwen2.5-coder-3b-instruct-q8_0
ca. 3,1 GB

Debug:
qwen2.5-coder-3b-instruct-q8_0
ca. 3,1 GB
```

Diese Zuordnung ist für den Test bindend.

---

# Erwarteter Gesamtfluss

```text
App startet
→ kein Arbeitsmodell geladen
→ Workspace öffnen
→ Runtime Chat öffnen
→ kein Arbeitsmodell geladen
→ Benutzer beschreibt Aufgabe
→ ask_user klärt Ziel und Akzeptanz
→ ActiveTaskContract wird gespeichert
→ Workflow und Rolle werden bestimmt
→ exakt das konfigurierte Rollenmodell wird gewählt
→ Context Budget wird geprüft
→ exakt dieses Modell wird On-Demand gestartet
→ Antwort bleibt im aktiven Task Contract
→ konkrete Dateien werden nur nach Verifikation genannt
```

---

# Reproduktionsfall

Workspace:

`C:\Users\ralle\source\repos\dbzssl`

Start:

```text
Wir bauen heute eine kleine neue Funktion für StringLab
```

Feature:

```text
Eine Smart Practice Session für Gitarre und Bass mit Übungsziel, Dauer, BPM, Start, Pause, Fortsetzen und lokaler Speicherung.
```

Akzeptanz:

```text
Die Funktion ist korrekt, wenn eine Session für Gitarre oder Bass angelegt, gestartet, pausiert, fortgesetzt und beendet werden kann. Dauer, BPM, Übungsziel und Status müssen korrekt angezeigt und lokal gespeichert werden. Nach einem Neustart muss eine unterbrochene Session wiederhergestellt werden. Bestehende StringLab-Funktionen dürfen nicht beeinträchtigt werden.
```

Folgefrage:

```text
Gib die nächsten 3 priorisierten Schritte inklusive kurzer Begründung an.
```

Erwartetes Routing:

```text
workflow = active_task_contract
phase = planning
targetAgent = planner
taskType = planning_follow_up
configuredModel = qwen2.5-coder-3b-instruct-q8_0
resolvedModel = exakt dasselbe IndexedModel
slot = fast_gpu
selectionSource = role_setting
```

Kein Visionmodell.
Kein altes Runtime-Chat-Modell.
Kein beliebiger lokaler Kandidat.
Kein Slot-Default.

---

# P0 – Vier offene Review-Funde beheben

## 1. ActiveTaskContract darf nicht jede spätere Chatnachricht verschlucken

Aktueller Fehler in `workflowContinuation.ts`:

```ts
isWorkflowFollowUpMessage(message) ||
classifiedTaskType === "casual_chat" ||
classifiedTaskType === "normal_chat"
```

Damit bleibt auch eine unabhängige neue Frage im alten Workflow.

Beispiel:

```text
Aktiver Task:
Smart Practice Session

Neue Nachricht:
Erkläre mir Quantencomputer.
```

Diese Nachricht darf nicht automatisch dem StringLab-Workflow zugeordnet werden.

### Korrektur

Ein aktiver Contract wird nur verwendet, wenn mindestens eine Bedingung erfüllt ist:

```text
1. Nachricht entspricht einem bestätigten Follow-up-Muster
2. Nachricht referenziert sichtbar den bestehenden Auftrag
3. Nachricht ist eine direkte Antwort auf eine offene Workflowfrage
4. aktuelle Phase erwartet genau diesen Nachrichtentyp
```

Nicht ausreichend:

```text
classifiedTaskType === casual_chat
classifiedTaskType === normal_chat
```

Bei unklarer Abgrenzung:

```text
Meinst du den laufenden StringLab-Auftrag oder möchtest du eine neue Aufgabe beginnen?

A – Beim StringLab-Auftrag bleiben
B – Neue Aufgabe beginnen
```

Keine stille Zuordnung.

### Tests

1. „Gib die nächsten drei Schritte“ bleibt im Contract.
2. „Mach weiter“ bleibt im Contract.
3. „Welche Dateien sind betroffen?“ bleibt im Contract.
4. „Erkläre mir Quantencomputer“ startet nicht automatisch den alten Contract.
5. Explizit `Neue Aufgabe:` beendet oder pausiert den alten Contract.
6. Unklare Nachricht erzeugt `ask_user`, nicht stille Zuordnung.

---

## 2. Off-topic-Antwort muss wirklich verworfen und einmal neu erzeugt werden

Aktueller Fehler:

`unrelatedTopicDetected` schreibt nur einen Trace und entfernt eventuell Pfade.

Eine Antwort über:

```text
Rig Grid
Tuner
AudioVisualizer
Musiker-Navigator
```

bleibt dadurch sichtbar, obwohl Smart Practice Session gefragt wurde.

### Korrektur

Bei:

```text
grounding.unrelatedTopicDetected === true
```

muss gelten:

```text
erste Antwort nicht anzeigen
→ kompakter ActiveTaskContract
→ genau ein Relevanz-Retry
→ zweite Antwort erneut validieren
```

Retry-Request enthält nur:

```text
- aktiver Task Contract
- aktuelle Benutzerfrage
- maximal notwendige bestätigte Projektbasis
- Anweisung: Keine anderen Projektideen oder Backlog-Themen
```

Maximal ein Retry.

Falls auch Retry off-topic ist:

```text
status = failed
outcome = answer_relevance_failed
```

Benutzermeldung:

```text
Die Antwort blieb trotz Wiederholung außerhalb des bestätigten Auftrags.
Bitte anderes Plan-Modell wählen oder Diagnose exportieren.
```

Keine Endlosschleife.
Kein falsches `success`.

### Tests

7. Rig-Grid-Antwort wird verworfen.
8. Tuner-Antwort wird verworfen.
9. Retry nutzt Smart-Practice-Task-Contract.
10. zweiter Off-topic-Treffer endet als Fehler.
11. gültige zweite Antwort wird genau einmal angezeigt.
12. Trace unterscheidet:
   - `answer_relevance_retry_started`
   - `answer_relevance_retry_succeeded`
   - `answer_relevance_retry_failed`

---

## 3. Verifizierte Pfade tatsächlich aus Tool- und Indexergebnissen sammeln

Aktueller Fehler:

```ts
verifiedPaths: []
```

wird immer leer an die Grounding-Prüfung übergeben.

### Korrektur

Sammle normalisierte Pfade aus:

```text
list_files
read_file
search_code
workspace index
explizit geladene aktive Datei
bestätigte Context-Quellen
```

Neue Hilfsstruktur:

```ts
interface VerifiedWorkspaceEvidence {
  paths: Set<string>;
  source:
    | "list_files"
    | "read_file"
    | "search_code"
    | "code_index"
    | "active_file"
    | "context_source";
}
```

Normalisierung:

```text
- Workspace Root entfernen
- Slash vereinheitlichen
- Groß-/Kleinschreibung Windows-sicher behandeln
- `..` ablehnen
- Cross-Workspace-Pfade ablehnen
- `.codee/**` weiterhin standardmäßig ablehnen
```

`validatePlanningGrounding()` erhält:

```ts
verifiedPaths: Array.from(verifiedEvidence.paths)
```

### Regeln

```text
0 verifizierte Pfade
→ keine konkrete Datei als existent darstellen

verifizierter Pfad
→ darf als bestätigt genannt werden

nicht verifizierter Pfad
→ markieren oder entfernen
```

### Tests

13. `list_files` bestätigt echten Pfad.
14. `read_file` bestätigt echten Pfad.
15. Codeindex bestätigt echten Pfad.
16. Cross-Workspace-Pfad wird verworfen.
17. `.codee/resources/...` wird verworfen.
18. echter bestätigter Pfad bleibt in Antwort erhalten.
19. erfundener Pfad wird entfernt oder markiert.
20. Windows-Pfad und relativer Pfad werden korrekt normalisiert.

---

## 4. Ziel-Workspace-Contract beim Workspacewechsel nicht löschen

Aktueller Fehler in `RuntimeChatTab.tsx`:

```ts
clearActiveTaskContract(previousRoot);
clearActiveTaskContract(workspaceRoot);
```

Damit wird beim Wechsel A → B auch ein bereits gespeicherter Contract von B gelöscht.

### Korrektur

Beim Workspacewechsel:

```text
1. laufenden UI-Run von A abbrechen oder deaktivieren
2. Approval-State auf B umschalten
3. Contract von A nicht global löschen, sondern nur entkoppeln
4. Contract von B aus Persistence laden
5. Contract von B nur löschen, wenn Benutzer bewusst „Task beenden“ wählt
```

Neue Semantik:

```text
detachActiveTaskContract(previousRoot)
restoreActiveTaskContract(workspaceRoot)
```

Nicht:

```text
clear previous
clear destination
```

### Tests

21. Workspace A hat Contract A.
22. Workspace B hat Contract B.
23. Wechsel A → B stellt Contract B wieder her.
24. Rückkehr B → A stellt Contract A wieder her.
25. Kein Contract erscheint im falschen Workspace.
26. explizites „Task beenden“ löscht nur den aktuellen Contract.
27. App-Neustart stellt Contract des geöffneten Workspace wieder her.

---

# P0 – Rollenmodelle müssen nach Settings-Änderung sofort für den nächsten Run gelten

## Problem

Der Benutzer hat neue Rollenmodelle ausgewählt.

Ein alter Chatverlauf oder alter `lastRouting` darf weiterhin historische Modelle anzeigen, aber der nächste neue Run muss die aktuellen Settings verwenden.

### Anforderungen

Bei Änderung eines Rollenmodells:

```text
- Settings persistent speichern
- Broker-Cache invalidieren
- alte noch nicht gestartete BindingDecision verwerfen
- laufenden Run nicht heimlich wechseln
- nächster Run verwendet neue Rollen-ID
```

Neue Diagnose:

```text
settingsRevision
decisionSettingsRevision
roleModelConfiguredAt
```

Vor Runtime-Start prüfen:

```text
decisionSettingsRevision === currentSettingsRevision
```

Falls nicht:

```text
BindingDecision neu erzeugen
```

### Kein automatischer Runtime-Start

Settings-Änderung darf kein Modell laden.

Nur:

```text
Auswahl speichern
→ UI aktualisieren
→ nächster Run nutzt neues Modell
```

### Tests

28. Plan-Modell ändern → nächster Planning-Run nutzt neue ID.
29. Review-Modell ändern → nächster Review-Run nutzt neue ID.
30. Debug-Modell ändern → nächster Debug-Run nutzt neue ID.
31. Settings-Änderung startet keinen Slot.
32. veraltete Decision wird vor Start verworfen.
33. laufender Run bleibt unverändert.
34. neuer Run zeigt neue Modell-ID und neuen Modellnamen.

---

# P0 – 3,1-GB-Modellabnahme und Runtime-Readiness

Die ausgewählten Modelle sind bewusst kleiner beziehungsweise maximal etwa 3,1 GB.

Größe allein garantiert aber keine erfolgreiche Inferenz.

Vor dem eigentlichen Request:

```text
1. Resource Plan erstellen
2. Modell starten
3. Endpoint Health prüfen
4. Mini-Warm-up ausführen
5. erst dann First-Token-Timer des echten Requests starten
```

Warm-up:

```text
Prompt: "Antworte nur mit OK."
max_tokens: 2
temperature: 0
```

Ergebnis:

```text
runtime_process_started
runtime_endpoint_ready
runtime_inference_ready
```

Nicht ausreichend:

```text
Prozess läuft
HTTP-Port offen
```

### Timeout-Trennung

```text
model_load_timeout
warmup_timeout
first_token_timeout
generation_timeout
```

Der 60-Sekunden-First-Token-Timer beginnt erst nach erfolgreichem Warm-up.

### Hardware-Fallback

Strikte Rollenbindung bleibt Standard.

Falls Modell technisch nicht startet:

```text
kein stiller Ersatz
```

Stattdessen:

```text
Das konfigurierte Plan-Modell konnte nicht inferenzbereit gestartet werden.

A – dasselbe Modell mit kleinerem Runtime-Profil erneut versuchen
B – ein anderes Plan-Modell auswählen
C – abbrechen
```

### Tests

35. Prozess bereit, aber Warm-up fehlschlägt → nicht `ready`.
36. Warm-up erfolgreich → echter Request startet.
37. First-Token-Timer beginnt nach Warm-up.
38. kein stiller Modellwechsel.
39. OOM wird als Ressourcenfehler angezeigt.
40. kleineres Profil darf nur nach sichtbarer Entscheidung verwendet werden.

---

# P0 – Chat-Visionmodell klar behandeln

Die Chat-Rolle ist aktuell:

```text
Qwen2.5-VL-3B-Instruct.Q4_K_M
```

Für Text ohne Bild gilt weiterhin das Vision-Gate.

Da dieses Modell bewusst als Chat-Rolle gesetzt wurde, muss das Verhalten transparent sein.

Erlaubte Varianten:

### Variante A – Textmodus unterstützt

Falls das Modell laut Modellindex und Runtime-Test reinen Textchat zuverlässig unterstützt:

```text
Chat-Rollenmodell darf für Text verwendet werden
requiresVision = false
supportsTextOnly = true
```

### Variante B – Bild zwingend erforderlich

Falls MMProj oder Visionpfad zwingend benötigt wird:

```text
Textchat blockieren oder sichtbaren Rollen-Fallback anbieten
```

Nicht erlaubt:

```text
stiller Wechsel auf irgendein anderes Modell
```

Modellmetadaten ergänzen oder verwenden:

```ts
supportsTextOnly: boolean;
requiresVisionProjector: boolean;
supportsVision: boolean;
```

### Tests

41. VL-Modell mit `supportsTextOnly=true` darf Textchat ausführen.
42. VL-Modell mit `supportsTextOnly=false` wird für Textchat blockiert.
43. Bildinput aktiviert Visionpfad.
44. sichtbarer Fallback benötigt Bestätigung.
45. Diagnose zeigt Text-/Vision-Capability.

---

# P1 – Antwortinhalt für den StringLab-Reproduktionsfall

Erwartete Antwort nach erfolgreichem Planning-Run:

```text
1. Vorhandene Practice-, Domain- und Persistenzstrukturen prüfen
   Begründung: Die Smart Practice Session muss in vorhandene Projekt- und Storage-Verträge integriert werden, ohne eine parallele Architektur zu erzeugen.

2. Versioniertes PracticeSession-Datenmodell und Lifecycle definieren
   Begründung: Start, Pause, Fortsetzen, Beenden und Wiederherstellung benötigen eindeutige Zustände und migrationsfähige Persistenz.

3. UI- und Persistenzintegration planen und zur Freigabe vorlegen
   Begründung: Vor Dateiänderungen müssen betroffene Komponenten, Tests, Safe-Mode-Verhalten und Definition of Done bestätigt sein.
```

Wenn konkrete Dateien genannt werden:

```text
nur nach Verifikation
```

Keine Antwort über:

```text
Tuner
AudioVisualizer
Rig Grid
Musiker-Navigator
unabhängigen Practice Coach Agent
```

sofern diese nicht nachweislich zur Smart-Practice-Session gehören.

---

# UI- und Diagnoseanforderungen

Für jeden Run sichtbar:

```text
Workflow
Phase
Agent
Rollenmodell laut Settings
aufgelöste Modell-ID
aufgelöster Modellname
Slot
Gerät
Settings Revision
Selection Source
Fallback Reason
Warm-up Status
tatsächlicher Outcome
```

Beispiel:

```text
Workflow: Smart Practice Session
Phase: planning
Agent: planner
Rollenmodell: qwen2.5-coder-3b-instruct-q8_0
Modell-ID: b071...
Slot: fast_gpu
Quelle: role_setting
Runtime: inference_ready
```

Alte Protokolle dürfen historische Modellnamen zeigen, müssen aber als alte Runs erkennbar sein.

---

# Wahrscheinlich betroffene Dateien

Suche zuerst. Keine Pfade erfinden.

Mindestens prüfen:

```text
apps/desktop/src/services/workflowContinuation.ts
apps/desktop/src/services/activeTaskContract.ts
apps/desktop/src/services/planningGrounding.ts
apps/desktop/src/services/modelSelectionBroker.ts
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/components/RuntimeChatTab.tsx
apps/desktop/src/components/chat/CodeeRunLiveBlock.tsx
apps/desktop/src/stores/settingsStore.ts
apps/desktop/src/services/runtimeSlotManager.ts
backend/app/runtime/service.py
backend/app/runtime/*
```

---

# Vollständige Definition of Done

- Die vier offenen Review-Funde sind behoben.
- Unabhängige Chatfragen bleiben nicht im alten Workflow hängen.
- Off-topic-Antwort wird tatsächlich einmal neu generiert.
- Verifizierte Pfade werden real gesammelt.
- Ziel-Workspace-Contract bleibt erhalten.
- Rollenmodelländerungen gelten ab dem nächsten Run.
- Kein Settings-Wechsel startet ein Modell.
- Keine veraltete BindingDecision wird gestartet.
- Maximal 3,1-GB-Rollenmodelle werden exakt nach Settings gewählt.
- Runtime-Readiness umfasst einen echten Warm-up.
- Kein stiller Modellfallback.
- Chat-Visionmodell verhält sich capability-basiert und transparent.
- Lazy Loading bleibt aktiv.
- Context Budget bleibt aktiv.
- Workspace-Isolation bleibt aktiv.
- `ask_user` bleibt aktiv.
- Typecheck grün.
- Desktop-Tests grün.
- Backend-Tests grün.
- Produktions-Build grün.
- kompletter StringLab-Reproduktionsfall grün.
- kein Commit, Push, PR oder Merge ohne ausdrückliche Freigabe.

---

# Arbeitsweise

1. Ausgangs-Head und Branch ausgeben.
2. Vier Review-Funde im aktuellen Code bestätigen.
3. Settings-Persistenz und Settings-Revision kartieren.
4. Runtime-Readiness-Pfad kartieren.
5. minimalen Änderungsplan ausgeben.
6. erst danach Code ändern.
7. jeden P0 einzeln testen.
8. vollständigen Reproduktionsfall ausführen.
9. tatsächliche Modell-ID und Modellname protokollieren.
10. Abschlussbericht liefern.
11. nicht committen.
12. nicht pushen.
13. keinen PR erstellen.
14. nicht mergen.

---

# Abschlussbericht

Liefere:

1. Ausgangs-Head
2. geänderte Dateien
3. Behebung Review-Fund 1
4. Behebung Review-Fund 2
5. Behebung Review-Fund 3
6. Behebung Review-Fund 4
7. Rollenmodell-Settings-Revision
8. tatsächliche Modellwahl im Reproduktionsfall
9. Warm-up-/Readiness-Ergebnis
10. Grounding-Nachweis
11. Testergebnisse
12. verbleibende Risiken
13. nächster kleiner Schritt zur Produktionsreife

Beginne jetzt nur mit Analyse und Änderungsplan. Noch keine Codeänderung, bevor alle vier Review-Funde, der Settings-Fluss und der Runtime-Readiness-Pfad im tatsächlichen Code bestätigt wurden.
