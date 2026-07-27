# ERGÄNZUNG ZUM CURSOR-MASTERPROMPT
# DBZS Codee – Lazy Runtime Loading

Diese Anforderungen sind verbindlicher Bestandteil des nächsten Reparaturlaufs.

## Ziel

Beim Start von Codee und beim Öffnen des Runtime Chats darf kein Chat-, Planner-, Coder-, Review- oder Visionmodell automatisch geladen werden.

Optional resident bleiben darf ausschließlich:

```text
FunctionGemma 270M
Slot: orchestrator_cpu
Zweck: Intent, ask_user, Workflow- und Modellrollen-Routing
```

Auch FunctionGemma muss über eine eigene Einstellung deaktivierbar bleiben.

## Verbotene implizite Startauslöser

Folgende Aktionen dürfen kein Arbeitsmodell starten:

- Codee starten
- Backend starten
- Workspace öffnen
- Workspace scannen
- Runtime-Chat-Tab öffnen
- alten Chat wiederherstellen
- Chat leeren
- Modell-Dropdown anzeigen
- Runtime-Status abfragen
- Context bereit melden
- eine Rückfrage anzeigen
- auf eine noch unbeantwortete Rückfrage warten

Eine Statusabfrage darf ausschließlich lesen und niemals als Nebeneffekt einen Slot starten.

## Erlaubter Startzeitpunkt

Ein Arbeitsmodell darf erst gestartet werden, wenn alle Bedingungen erfüllt sind:

1. Der Benutzer hat eine Nachricht abgesendet.
2. Die Preflight-Prüfung ist abgeschlossen.
3. Es ist keine weitere `ask_user`-Rückfrage erforderlich.
4. Workflow und Zielmodellrolle stehen fest.
5. Der Broker hat ein konkretes Modell und einen konkreten Slot gewählt.
6. Das finale Context-Budget wurde berechnet.
7. Der Request passt in das Context-Fenster.
8. Der Run wurde nicht abgebrochen und der Workspace ist unverändert.

Reihenfolge:

```text
Benutzernachricht
→ Preflight
→ optional ask_user
→ bestätigter Task Contract
→ Workflow-Routing
→ Model-/Slot-Auswahl
→ Context Budget
→ Runtime on demand starten
→ Request senden
```

## Runtime-Bootstrap entfernen oder entschärfen

Prüfe insbesondere:

```text
apps/desktop/src/services/runtimeBootstrap.ts
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/App.tsx
backend/app/main.py
Settings für autoStartChatRuntime / autoStartCodingRuntime
```

Der aktuelle `RuntimeBootstrapService` darf standardmäßig nicht mehr Chat und Coding parallel starten.

Erwarteter Default:

```ts
autoStartOnBoot: false
```

Besser:

- `bootstrapRuntimeLayer()` initialisiert ausschließlich Tool Kernel, MCP und lokale Verträge.
- Ein separater expliziter `preloadSelectedRuntime()`-Befehl ist nur für manuelles Vorladen zuständig.
- `startAll()` darf nicht aus App-, Workspace- oder Chat-Initialisierung aufgerufen werden.
- Tote oder historische Autostart-Pfade entfernen oder deutlich als manuell kennzeichnen.

## Einstellungen

Neue beziehungsweise bereinigte Defaults:

```text
autoStartChatRuntime = false
autoStartCodingRuntime = false
autoStartVisionRuntime = false
autoStartReviewRuntime = false
autoStartOrchestratorRuntime = true
```

Optionale Nutzerfunktion:

```text
Arbeitsmodell manuell vorladen
```

Diese Funktion muss bewusst angeklickt werden und darf nicht Default sein.

## Slot-Verhalten

Vor einer echten Aufgabe:

```text
orchestrator_cpu: running oder stopped – je nach Einstellung
quality_cpu: stopped
fast_gpu: stopped
vision_gpu: stopped
utility: nur bei tatsächlichem Index-/Reranking-Auftrag
```

Nach einer Routingentscheidung wird nur der benötigte Slot gestartet.

Beispiele:

```text
ask_user:
kein Arbeitsmodell starten

reiner Textchat:
kleines Chatmodell starten

Planung:
Planner-Modell starten

Coding:
Coder-Modell starten

Bildanalyse:
Visionmodell starten

Embedding/Reranking:
Utility-Modell starten
```

## Bereits laufende Modelle

Codee muss unterscheiden zwischen:

- von Codee gestarteten Slotprozessen
- extern gestarteten llama-server-Prozessen
- verwaisten Prozessen aus einer früheren Codee-Sitzung

Regeln:

- externe Prozesse nicht ungefragt beenden
- verwaiste, eindeutig Codee-eigene Prozesse diagnostizieren
- keine laufende Runtime automatisch als Modell für den neuen Run übernehmen
- jedes Modell muss durch den Broker für den konkreten Run ausgewählt werden

## UI

Vor dem ersten Modellstart anzeigen:

```text
Router: FunctionGemma bereit
Arbeitsmodell: nicht geladen
Hinweis: Wird nach Klärung der Aufgabe automatisch gestartet.
```

Nicht anzeigen:

```text
Runtime Chat · Qwen...
```

wenn Qwen nur früher einmal lief oder global resident ist.

Während des Starts:

```text
Planner wird bei Bedarf geladen …
```

Nach Start:

```text
Run-Modell: <lesbarer Modellname>
Slot: <slot>
Gerät: CPU/GPU
Auswahlgrund: <reason code>
```

Keine Hash-ID als alleinige Modellanzeige.

## Abbruch und Race Conditions

Wenn während eines Runtime-Starts:

- Workspace gewechselt wird
- Run abgebrochen wird
- neue Routingentscheidung entsteht
- eine weitere Rückfrage notwendig wird

muss der Start abgebrochen oder das Ergebnis verworfen werden.

Ein verspätet gestartetes Modell darf nicht automatisch den neuen Workspace oder Run übernehmen.

## Idle Policy

Nach Abschluss:

- Chat-/Planner-/Coder-/Visionmodelle dürfen nach konfigurierbarer Inaktivität entladen werden.
- Standardvorschlag: 5 bis 10 Minuten.
- FunctionGemma darf resident bleiben.
- Aktiver Run, Tool Call oder Patch Review verhindert Eviction.

## Tests

1. App-Start lädt kein Chatmodell.
2. Backend-Start lädt kein Chat- oder Codingmodell.
3. Workspace öffnen lädt kein Arbeitsmodell.
4. Runtime Chat öffnen lädt kein Arbeitsmodell.
5. Chat leeren lädt kein Arbeitsmodell.
6. `ask_user` lädt kein Arbeitsmodell.
7. Erst nach beantworteter Rückfrage wird genau ein Zielslot gestartet.
8. Planungsaufgabe startet Planner, nicht Vision.
9. Bildanalyse startet Vision.
10. Statusabfrage startet keinen Slot.
11. manuelles Vorladen funktioniert nur nach Klick.
12. Workspacewechsel während Start verwirft den alten Start.
13. Abbruch während Start erzeugt keinen weiterlaufenden Run.
14. extern laufende Runtime wird nicht ungefragt gestoppt.
15. UI zeigt vor Start `Arbeitsmodell: nicht geladen`.
16. Diagnose nennt tatsächlichen Startauslöser.
17. Autostart-Defaults für Chat/Coding/Vision sind `false`.
18. FunctionGemma-Autostart bleibt separat konfigurierbar.

## Definition of Done

- Kein zwangsweise geladenes Arbeitsmodell vor Chatbeginn.
- Kein Start durch reine Statusabfrage.
- Kein Start während `ask_user`.
- On-Demand-Start erst nach vollständigem Routing.
- Nur ein benötigter Slot wird gestartet.
- Modellname, Slot und Auswahlgrund sind transparent.
- Abbruch und Workspacewechsel sind race-sicher.
- Tests, Typecheck und Build sind grün.
