# DBZS Codee V4 – Nachprüfung nach Boot-Repair

## Ergebnis

Der Boot-Repair ist **noch nicht vollständig abgeschlossen**.

Die beiden Diagnose-Runs zeigen weiterhin zwei aktive Kernprobleme:

1. Das ausgewählte Modell erreicht zwar den Runtime-Endpunkt, liefert beim Warm-up aber keinen Token.
2. Die eindeutige Anfrage „Zähle alle gguf Modelle im Workspace“ wird weiterhin als Chat/Clarification geroutet, statt direkt als Workspace-Tool ausgeführt zu werden.

Zusätzlich zeigt die Oberfläche gleichzeitig:

```text
Backend: online
FastAPI backend did not become ready in time.
```

Damit existieren weiterhin widersprüchliche Statusquellen.

---

## 1. Runtime-Endpunkt erreichbar, Modell aber nicht inferenzbereit

Beide Runs enden mit:

```text
runtime_endpoint_ready
readinessStage: endpoint_reachable
warmup_empty_response
warmup_failed
```

Das ist technisch korrekt erkannt:

```text
HTTP erreichbar != Modell inferenzbereit
```

Betroffen:

```text
Model-ID: 128016cf911def77
Modell: Qwen3.5-4B.Q4-K-M
```

Das Modell wurde einmal in `quality_cpu` und einmal in `fast_gpu` gestartet. Beide Starts liefern beim Warm-up keine verwertbare Ausgabe.

### Wahrscheinliche Ursachen

- falsches oder inkompatibles Chat-Template
- falscher API-Modus: Chat statt Completion oder umgekehrt
- Antwort liegt in `reasoning_content`, `delta.content`, `text` oder `tool_calls`
- Streaming-Parser erkennt gültige Events nicht
- Stop-Sequenz oder `n_predict/max_tokens` verhindert sichtbare Ausgabe
- Modell ist beim ersten HTTP-Erfolg intern noch nicht fertig geladen
- Slot-/Profilparameter unterscheiden sich zwischen Routing und tatsächlichem Start

### Zwingende Reparatur

Beim Warm-up protokollieren:

```text
Request-URL
HTTP-Status
Content-Type
Request-Body ohne Secrets
erste 8 KB Rohantwort
Streaming-Events
choices[0].message.content
choices[0].message.reasoning_content
choices[0].delta.content
choices[0].text
tool_calls
finish_reason
prompt_tokens
completion_tokens
llama-server stderr tail
```

`warmup_empty_response` ist als alleinige Diagnose zu grob.

---

## 2. Intent-Routing weiterhin falsch

Die Anfrage:

```text
Zähle alle gguf modelle im Workspace
```

wird klassifiziert als:

```text
task_type: casual_chat
workflow_kind: chat
workflow_phase: clarification
targetAgentLabel: runtime_chat
model_role: chat
```

Das ist fachlich falsch.

Korrekte Klassifikation:

```json
{
  "intent": "workspace_query",
  "operation": "count_files",
  "pattern": "*.gguf",
  "scope": "workspace",
  "requiresPlanning": false,
  "requiresClarification": false,
  "requiresModel": false,
  "requiresToolExecution": true
}
```

### Verbindliche Ausführung

```text
Nutzereingabe
→ Direct Intent Classifier
→ Workspace File Tool
→ rekursiver Scan
→ exakte Anzahl
→ direkte Antwort
```

Nicht:

```text
Nutzereingabe
→ Chat-Router
→ Modellstart
→ Warm-up
→ Generation
```

Für eine Dateizählung darf überhaupt kein LLM erforderlich sein.

---

## 3. Slot-Routing ist inkonsistent

Dasselbe Modell wird unterschiedlich gestartet:

```text
Run A: slotId = quality_cpu
Run B: slotId = fast_gpu
```

Im zweiten Run steht in den Routinggründen gleichzeitig:

```text
slot: quality_cpu
```

während tatsächlich `fast_gpu` verwendet wird.

Das ist ein interner Widerspruch.

### Zwingende Struktur

```ts
interface ResolvedRuntimeRoute {
  modelId: string;
  modelName: string;
  slotId: string;
  profile: string;
  provider: string;
  reasons: string[];
  source: "role_setting" | "automatic" | "fallback";
}
```

Nach dem Routing dürfen alle Komponenten ausschließlich dieses eine Objekt verwenden.

---

## 4. Backend-Status ist weiterhin unehrlich

Die UI zeigt:

```text
Backend: online
```

obwohl der Boot-/Readiness-Status gleichzeitig meldet:

```text
FastAPI backend did not become ready in time.
```

Die Headeranzeige darf nicht aus einem alten Health-Store gespeist werden.

### Verbindliches Statusmodell

```ts
type BackendUiStatus =
  | "offline"
  | "starting"
  | "live"
  | "ready"
  | "degraded"
  | "failed";
```

Anzeige:

```text
online     nur bei ready
startet    bei live/starting
beeinträchtigt bei degraded
Fehler     bei failed
```

---

## 5. Bewertung der genannten Verbesserungsvorschläge

### Modellindex-Cache

Richtig und notwendig.

Empfohlener Cache-Key:

```text
absolutePath
size
mtimeNs
optional first-64KB hash
GGUF metadata version
```

Cache-Datei:

```text
<userData>/cache/model-index-v1.json
```

### Reale Dateisystem-/Runtime-Prüfung

Richtig.

Diese Platzhalter sind wirkungslos:

```ts
modelRoots: []
runtimeExecutableCandidates: []
```

Die echten konfigurierten Pfade müssen eingebunden werden.

### Safe-Mode-Reset

Richtig.

`filesystem-check` muss entweder erneut ausgeführt oder durch eine reduzierte Safe-Mode-Prüfung ersetzt werden.

### 15 RuntimeService-Testfehler

Müssen behoben werden. Ein dauerhaft roter Pytest-Lauf verhindert eine belastbare Produktionsfreigabe.

### Zod nur auf Desktop-Seite

Richtig erkannt.

TypeScript/Zod und Python/Pydantic benötigen denselben versionierten Vertrag.

### Fehlender Electron-E2E-Test

Richtig.

Der vollständige 17-Phasen-Boot muss als echter Electron-Integrationstest laufen.

---

## 6. Zusätzliche P0-Reparaturen

### P0.1 Direct-Tool-Fast-Path

Vor jedem Agent- oder Modellrouting:

```text
zähle
suche
liste
lies
zeige Dateien
prüfe Git-Status
finde Endung
größte Dateien
```

als deterministische Tool-Aufgaben erkennen.

### P0.2 Qwen3.5-Kompatibilitätsprofil

```ts
interface ModelRuntimeCompatibility {
  apiMode: "chat" | "completion";
  chatTemplate: string | null;
  supportsStreaming: boolean;
  supportsTools: boolean;
  reasoningMode: "none" | "separate_field" | "inline";
  warmupPrompt: string;
  warmupExpectedChannel: string;
}
```

### P0.3 Residentes Modell als Fallback

Im ersten Run war bereits ein residentes Modell verfügbar:

```text
deepseek-coder-6.7b-instruct.Q4-K-M
```

Trotzdem wurde ein anderes Rollenmodell gestartet und der gesamte Run abgebrochen.

Verbindlich:

```text
Rollenmodell scheitert
→ kompatibles residentes Modell prüfen
→ Run degraded fortsetzen
→ Warnung anzeigen
```

Nur ohne kompatiblen Fallback darf der Run blockieren.

---

## 7. Exakte nächste Reihenfolge

### Schritt 1 – Intent-Routing

1. Eingaben normalisieren.
2. Direct Intent Classifier vor den Agent-Router setzen.
3. Workspace-Abfragen direkt ausführen.
4. „WS“ als Workspace erkennen.
5. Für Zähl-/Suchoperationen kein Modell starten.
6. Tests ergänzen.

### Schritt 2 – Runtime-Route vereinheitlichen

1. Ein `ResolvedRuntimeRoute` erzeugen.
2. Modell, Slot und Profil nur daraus lesen.
3. Widersprüche als Fehler protokollieren.
4. `quality_cpu`/`fast_gpu`-Tests ergänzen.

### Schritt 3 – Warm-up instrumentieren

1. Rohantwort sichern.
2. Streaming und Non-Streaming testen.
3. Chat- und Completion-Endpunkt testen.
4. Reasoning-/Tool-Felder auswerten.
5. Finish-Reason und Tokenzahlen prüfen.
6. stderr des Modellprozesses anhängen.

### Schritt 4 – Qwen3.5 reparieren

1. GGUF-Metadaten lesen.
2. Chat-Template feststellen.
3. API-Modus wählen.
4. minimalen Warm-up-Prompt definieren.
5. Parser anpassen.
6. mindestens einen verwertbaren Token oder strukturierten Tool-Call bestätigen.

### Schritt 5 – Fallback

1. residente Modelle prüfen.
2. Rollenkompatibilität bewerten.
3. bei Warm-up-Fehler automatisch fallbacken.
4. Run als `degraded` markieren.
5. keine A/B/C-Frage stellen, wenn ein sicherer Fallback existiert.

### Schritt 6 – UI-Status

1. alte Statusquelle entfernen.
2. Header nur aus Boot-/Runtime-State speisen.
3. `online` ausschließlich bei echter Readiness anzeigen.

### Schritt 7 – Danach

1. Modellindex-Cache
2. reale Pfadprüfung
3. RuntimeService-Testreparatur
4. gemeinsames Zod-/Pydantic-Schema
5. Electron-E2E

---

## Definition of Done

```text
[ ] „Zähle alle gguf Modelle im Workspace“ startet kein LLM.
[ ] Die Anfrage wird als workspace_query erkannt.
[ ] Das Workspace-Tool wird direkt ausgeführt.
[ ] Die exakte GGUF-Anzahl wird ausgegeben.
[ ] Keine Clarification-Phase wird erzeugt.
[ ] Kein Warm-up wird für Dateizählung ausgeführt.
[ ] Slot- und Routingdaten widersprechen sich nicht.
[ ] Qwen3.5 liefert im isolierten Runtime-Test eine verwertbare Antwort.
[ ] Warm-up-Fehler enthalten Rohantwort und Parserdiagnose.
[ ] Ein kompatibles residentes Modell wird als Fallback verwendet.
[ ] Der Header zeigt keinen falschen Online-Status.
[ ] Der vollständige Testlauf ist grün.
```

## Schlussfolgerung

Der Boot-Unterbau ist deutlich verbessert. Die aktuellen Fehler sitzen jetzt hauptsächlich in:

```text
Intent Routing
→ Runtime Route Resolution
→ Model Warm-up / Response Parsing
```

Die nächste Reparatur darf kein weiterer Timeout-Patch sein.

Die verbindliche Lösung lautet:

```text
Deterministische Aufgaben ohne LLM ausführen
und Modell-Inferenz anhand der tatsächlichen Antwortstruktur verifizieren.
```
