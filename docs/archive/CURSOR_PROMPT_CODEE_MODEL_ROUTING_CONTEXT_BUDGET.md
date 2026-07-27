# CURSOR MASTERPROMPT
# Division By Zeros (DBZS) Codee
# Phase 2B – Model Routing, Context Budget und ehrlicher Run-Status

Repository:

`C:\Users\ralle\source\repos\dbzs-codee-project`

Ausgangspunkt:

aktueller `main`

Erwarteter Head zu Beginn:

`51eb7e1` oder neuer

Arbeitsbranch:

`fix/stringlab-model-routing-context-budget`

## Ziel

Behebe ausschließlich die nächste nachgewiesene Bruchstelle aus dem StringLab-Live-Test.

Der bereits funktionierende Teil darf nicht beschädigt werden:

```text
offene Aufgabe
→ Rückfrage
→ Antwort übernehmen
→ zweite Rückfrage
→ Antwort übernehmen
→ Arbeitslauf starten
```

Der aktuelle Fehler beginnt danach:

```text
Modell-Routing
→ Qwen2.5-VL-3B-Instruct wird ohne Bild gewählt
→ 81 Kontextsignale werden geladen
→ Runtime-Kontextaufbau dauert ca. 51 Sekunden
→ Kontextfenster wird überschritten
→ Lauf wird trotzdem als erfolgreich markiert
```

Keine neuen Features. Keine UI-Neugestaltung. Keine neue Agentenarchitektur. Keine FunctionGemma-Vollintegration in diesem PR.

## Reproduktionsfall

Workspace:

`C:\Users\ralle\source\repos\dbzssl`

Erste Eingabe:

```text
Wir bauen heute eine kleine neue Funktion für StringLab
```

Antwort auf Rückfrage 1:

```text
Eine Smart Practice Session für Gitarre und Bass mit Übungsziel, Dauer, BPM, Start, Pause, Fortsetzen und lokaler Speicherung.
```

Antwort auf Rückfrage 2:

```text
Die Funktion ist korrekt, wenn eine Session für Gitarre oder Bass angelegt, gestartet, pausiert, fortgesetzt und beendet werden kann. Dauer, BPM, Übungsziel und Status müssen korrekt angezeigt und lokal gespeichert werden. Nach einem Neustart muss eine unterbrochene Session wiederhergestellt werden. Bestehende StringLab-Funktionen dürfen nicht beeinträchtigt werden.
```

Aktuelles Fehlverhalten:

- Visionmodell ohne Bild gewählt
- `Qwen2.5-VL-3B-Instruct.Q4_K_M`
- 81 Signale geladen
- sichtbare Quellen nur ca. 541 Tokens
- trotzdem Kontextfenster überschritten
- Laufstatus zeigt erfolgreich
- Repository-Analyse wird nicht erreicht

## Harte Anforderungen

### 1. Visionmodell nur bei echtem Bildinput

Führe eine eindeutige Capability-Prüfung ein:

```ts
interface RuntimeRequestCapabilities {
  hasImageInput: boolean;
  hasAudioInput: boolean;
  requiresVision: boolean;
}
```

Regel:

```text
Visionmodell darf nur gewählt werden, wenn:
hasImageInput === true
ODER requiresVision === true
```

Für reine Textanfragen:

```text
hasImageInput = false
requiresVision = false
```

Dann dürfen Modelle mit primärer Rolle `vision_chat`, `image_text_to_text`, `multimodal` oder vergleichbar nicht bevorzugt werden.

Fallback-Reihenfolge für diesen Fall:

```text
Planner
→ Coder
→ kleines Textchatmodell
```

Nicht:

```text
Visionmodell
```

Bestehende explizite manuelle Modellwahl respektieren, aber mit klarer Warnung, falls ein Visionmodell ohne Bild verwendet wird.

### 2. Zielagent korrekt bestimmen

Nach abgeschlossenem Interview muss die Aufgabe als Planungs-/Coding-Aufgabe laufen.

Für den Reproduktionsfall:

```text
taskType = small_code_change
workflow = planning oder coding
targetAgent = planner oder coder
```

Der Broker darf nicht auf `casual_chat` oder generischen Default zurückfallen.

Erwartete Zielrolle:

```text
planner
```

bevor konkrete Dateien geändert werden.

### 3. Context-Stufen einführen

Kein pauschaler Vollkontext.

#### Stufe 0 – Router/Interview

Nur:

- letzte Benutzeranfrage
- bereits beantwortete Rückfragen
- Workspace-Name
- Workflowstatus

Keine Dateien. Kein RAG. Kein großer Modellstart.

#### Stufe 1 – Planungsbasis

Nur:

- `AGENTS.md`
- `README.md`
- `package.json`
- `STATUS_MATRIX.md`
- optional `STUB_TODO.md`
- bestätigte Interviewantworten

Maximal 5 Dateien.

#### Stufe 2 – gezielte Analyse

Erst nach erster Planungsentscheidung:

- relevante Komponenten
- betroffene Tests
- abhängige Domain-/Persistenzdateien

Keine pauschalen 80+ Signale.

#### Stufe 3 – Coding

Nur konkret betroffene Dateien plus direkte Abhängigkeiten und Tests.

### 4. Tatsächliches Tokenbudget berechnen

Nicht nur sichtbare RAG-Tokens zählen.

Vor dem Runtime-Aufruf muss der vollständig serialisierte Request kalkuliert werden:

```text
Systemprompt
Tooldefinitionen
Interviewverlauf
Chatverlauf
Projektmemory
Runtime-Kontext
Dateikontext
RAG
Outputreserve
```

Neue Diagnose:

```ts
interface FinalRequestTokenBudget {
  runtimeContextLimit: number;
  systemTokens: number;
  toolTokens: number;
  chatTokens: number;
  interviewTokens: number;
  memoryTokens: number;
  fileContextTokens: number;
  ragTokens: number;
  outputReserveTokens: number;
  totalInputTokens: number;
  totalRequiredTokens: number;
  overflowTokens: number;
}
```

Definition:

```text
totalRequiredTokens = totalInputTokens + outputReserveTokens
```

Der Request darf nur gesendet werden, wenn:

```text
totalRequiredTokens <= runtimeContextLimit
```

### 5. Outputreserve verbindlich berücksichtigen

Konservative Defaults:

```text
Planung: 1024 Tokens
Coding: 1536 Tokens
Review: 1024 Tokens
Chat: 512 Tokens
```

### 6. Kontext vor Runtime-Aufruf reduzieren

Bei Überlauf:

1. doppelte Inhalte entfernen
2. alte Chatnachrichten zusammenfassen
3. RAG-Treffer reduzieren
4. unwichtige Dateien entfernen
5. Runtime-Kontext kürzen
6. Tools nur passend zum Workflow senden
7. nochmals Tokenbudget berechnen

Nicht zulässig:

```text
Request trotz bekanntem Overflow senden
```

### 7. Automatischer Minimal-Kontext-Fallback

Falls der normale Planungsrequest nicht passt:

```text
Minimal Planning Context
```

Inhalt:

- bestätigte Aufgabe
- Erfolgskriterien
- `AGENTS.md`
- `README.md`
- `package.json`
- `STATUS_MATRIX.md`
- maximal zwei gezielte Dateien

Nur ein automatischer Retry. Kein Retry-Loop.

Diagnoseeintrag:

```text
context_fallback_applied
dropped_sources
tokens_before
tokens_after
```

### 8. Run-Status ehrlich behandeln

Ein Context-Overflow ist kein Erfolg.

Korrigiere Zustände:

```ts
type RuntimeRunOutcome =
  | "success"
  | "needs_user_input"
  | "context_overflow"
  | "runtime_timeout"
  | "runtime_unreachable"
  | "runtime_error"
  | "cancelled";
```

Nur `success`, wenn eine verwertbare Modellantwort, ein gültiger Toolabschluss oder bewusstes `needs_user_input` vorliegt.

Bei Overflow:

```text
status = failed
outcome = context_overflow
```

Keine grüne Erfolgsmeldung.

### 9. Diagnoseanzeige

Erweitere das Diagnoseprotokoll um:

```text
gewähltes Modell
Zielagent
Zielslot
hasImageInput
requiresVision
Context-Stufe
Runtime-Limit
Input-Tokens
Outputreserve
Gesamtbedarf
entfernte Quellen
Fallback verwendet
finaler Run-Outcome
```

### 10. Performance-Ziele

```text
Clarification: < 1 Sekunde
Context-Auswahl: < 5 Sekunden
Tokenbudget: < 500 ms
First Token: Ziel < 15 Sekunden
```

Keine Production-Ready-Behauptung ohne Messung.

## Wahrscheinlich betroffene Bereiche

Suche zuerst, erfinde keine Pfade.

Voraussichtlich:

```text
apps/desktop/src/services/modelSelectionBroker.ts
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/services/runtimeChatContext.ts
apps/desktop/src/runtime/context/*
apps/desktop/src/services/runtimeSlotManager.ts
apps/desktop/src/components/CodeeRunLiveBlock.tsx
apps/desktop/src/components/RuntimeChatTab.tsx
packages/shared/src/*
backend/app/runtime/*
```

Prüfe außerdem:

```text
ContextSpooler
Context Orchestrator
Workspace Sampling
RAG Client
Runtime Chat Stream
Run Event Store
```

## Tests

### Modellrouting

1. reine Textanfrage ohne Bild wählt kein Visionmodell
2. Bildanhang erlaubt Visionmodell
3. explizite Visionanalyse wählt Visionmodell
4. Text-Featureaufgabe wählt Planner/Coder
5. manuell festgelegtes Visionmodell erzeugt Warnung, aber keine stille Umleitung

### Context-Stufen

6. Interview lädt keine Dateien
7. erste Planungsstufe lädt maximal 5 Basisdateien
8. `.codee/**` bleibt ausgeschlossen
9. keine pauschalen 81 Signale
10. Coding lädt nur relevante Dateien und Tests

### Tokenbudget

11. finaler serialisierter Request wird vollständig gezählt
12. Outputreserve wird berücksichtigt
13. Overflow wird vor Runtime-Aufruf erkannt
14. Minimal-Kontext-Fallback reduziert unter Limit
15. nur ein Retry
16. nicht reduzierbarer Overflow endet sauber als Fehler

### Run-Status

17. Context-Overflow ist nicht `success`
18. gültige Antwort ist `success`
19. Rückfrage ist `needs_user_input`
20. Runtime-Timeout ist eigener Fehlerzustand
21. Diagnose enthält finalen Outcome

### Reproduktionsfall

22. StringLab-Interview wie oben ausführen
23. nach zweiter Antwort wird kein Visionmodell gewählt
24. Kontext bleibt unter Slotlimit
25. Repository-Analyse wird erreicht
26. ein Plan wird erzeugt
27. keine Datei wird ohne Planfreigabe verändert

## Definition of Done

- Visionmodell ohne Bild ausgeschlossen
- Planner/Coder korrekt gewählt
- gestufter Kontext aktiv
- echtes Gesamt-Tokenbudget sichtbar
- Outputreserve verbindlich
- automatische einmalige Kontextreduktion
- Overflow vor Runtime-Aufruf erkannt
- Overflow als Fehler markiert
- Reproduktionsfall erreicht eine verwertbare Planung
- keine Regression im Rückfragesystem
- Workspace-Isolation bleibt grün
- Typecheck grün
- Desktop-Tests grün
- Backend-Tests grün
- Produktions-Build grün
- keine GitHub-Schreibaktion ohne Freigabe

## Arbeitsweise

1. Baseline erfassen
2. tatsächliche betroffene Dateien benennen
3. Implementierungsplan kurz ausgeben
4. dann Änderungen in kleinen Schritten
5. nach jedem Schritt passende Tests
6. vollständigen Reproduktionsfall simulieren
7. Abschlussbericht liefern
8. nicht committen
9. nicht pushen
10. keinen PR erstellen
11. nicht mergen

## Abschlussbericht

Liefere:

1. Ausgangs-Head
2. geänderte Dateien
3. Ursache der falschen Modellwahl
4. Ursache des Context-Overflows
5. tatsächliche Tokenbudget-Berechnung
6. Fallback-Verhalten
7. Run-Status-Korrektur
8. Testergebnisse
9. Reproduktionsnachweis
10. verbleibende Risiken
11. Vorschlag für den nächsten kleinen PR

Beginne jetzt mit der Analyse des aktuellen Codes. Noch keine Änderungen, bevor du die tatsächlichen Zuständigkeiten und den geplanten Änderungsumfang genannt hast.
