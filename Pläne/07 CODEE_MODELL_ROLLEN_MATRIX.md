# Codee – optimale Modell- und Rollenbelegung

**Basis:** aktueller Stand von `devdbzemusic/dbzs-codee-project`  
**Hardwareziel:** Ryzen 5 5600G, 32 GB RAM, GTX 1650 SUPER mit 4 GB VRAM

## Kernaussage

Für Codee ist keine „ein Modell für alles“-Belegung sinnvoll. Optimal ist:

- **FunctionGemma 270M** für Routing und Function Calling
- **Qwen2.5-Coder-3B Q8_0** als verbindlicher Arbeits-Agent
- **Qwen2.5-3B-Instruct Q4_K_M** für normalen Chat
- **Qwen2.5-VL-3B Q4_K_M + MMProj** ausschließlich für Vision/UI
- **Qwen3-Embedding-0.6B** für semantische Suche
- **Qwen3-Reranker-0.6B** für Kontext-Ranking
- **Yi-Coder-9B Q2_K** höchstens als beratender Zweitgutachter

## 1. Aktuelle Codee-Rollen

```text
default
planner
coder
tester
reviewer
debugger
docs
```

Aktuelle Runtime-Slots:

```text
quality_cpu      Port 8081 – Chat
fast_gpu         Port 8082 – Planung, Coding, Debugging, Review, Tests, Refactoring
utility          Port 8083 – Embedding, Reranking, Indexierung
orchestrator_cpu Port 8084 – Intent, Workflow, Function Calling, Rückfragen
```

Ein eigener Vision-Slot fehlt.

## 2. Empfohlene Belegung

| Codee-Rolle | Primärmodell | Slot | Bewertung |
|---|---|---|---|
| Intent Routing | `functiongemma-270m-it.Q8_0.gguf` | `orchestrator_cpu` | optimal |
| Workflow Routing | `functiongemma-270m-it.Q8_0.gguf` | `orchestrator_cpu` | optimal |
| Function Calling | `functiongemma-270m-it.Q8_0.gguf` | `orchestrator_cpu` | optimal |
| Clarification Detection | FunctionGemma + Policy | `orchestrator_cpu` | gut |
| Normaler Chat | `Qwen2.5-3B-Instruct.Q4_K_M` | `quality_cpu` | empfohlen |
| Planung | `qwen2.5-coder-3b-instruct-q8_0` | `fast_gpu` | sehr gut |
| Architektur | `qwen2.5-coder-3b-instruct-q8_0` | `fast_gpu` | gut |
| Coding | `qwen2.5-coder-3b-instruct-q8_0` | `fast_gpu` | zuverlässig |
| Debugging | `qwen2.5-coder-3b-instruct-q8_0` | `fast_gpu` | sehr gut |
| Review | `qwen2.5-coder-3b-instruct-q8_0` | `fast_gpu` | gut |
| Testanalyse | `qwen2.5-coder-3b-instruct-q8_0` | `fast_gpu` | gut |
| Dokumentation | Qwen2.5-Coder-3B oder Qwen2.5-3B-Instruct | CPU/GPU | gut |
| Screenshot/UI-Analyse | `Qwen2.5-VL-3B-Instruct.Q4_K_M` + MMProj | `vision_gpu` | sehr gut |
| Embedding | `Qwen3-Embedding-0.6B` | `utility` | optimal |
| Reranking | `Qwen3-Reranker-0.6B` | `utility` | optimal |
| Zweitreview | `Yi-Coder-9B-Chat.Q2_K` | CPU/exklusiv | optional |

## 3. Modellbewertung

### FunctionGemma 270M

**Geeignet für:**

- Tool-Auswahl
- Intent-Klassifikation
- Workflow-Auswahl
- Function Calling
- A/B/C-Entscheidungen
- Agenten-Handoff

**Nicht einsetzen für:**

- Code schreiben
- Architektur
- Repository Review
- komplexe Planung
- freie Endantworten

FunctionGemma sollte ausschließlich strukturierte Steuerdaten erzeugen.

### Qwen2.5-Coder-3B-Instruct Q8_0

Das sollte Codees verbindliches Kernmodell für agentische Arbeit sein.

**Optimale Rollen:**

```text
planner
coder
debugger
reviewer
tester
docs
```

Ein Modellprozess im `fast_gpu`-Slot reicht. Rollenwechsel erfolgen über Systemprompt, Workflow-Phase und Tool-Policy. Keine parallelen Kopien desselben Modells laden.

### Qwen2.5-VL-3B-Instruct Q4_K_M + MMProj

Das Modell gehört nicht als allgemeines Chatmodell in `quality_cpu`.

**Optimal für:**

- Screenshots
- UI-Fehler
- Mock-ups
- Diagramme
- sichtbare Fehlermeldungen
- Layout- und Zustandsanalyse
- visuelle Regressionen

**Verbindliche Regel:**

```text
hasImageInput == true
→ Base-GGUF + kompatibles MMProj starten

hasImageInput == false
→ VL-Modell nicht wählen
```

Das MMProj ist ein Support-Artefakt und niemals eigenständig startbar.

### Yi-Coder-9B-Chat Q2_K

**Sinnvoll für:**

- zweite Meinung
- Architektur-Brainstorming
- große Codebereiche lesen
- alternative Lösungsansätze

**Riskant für:**

- präzise Patches
- JSON
- Tool Calling
- Auto-Apply
- Dateipfade

Empfehlung:

```text
Yi-Coder-9B Q2_K = Advisor
Qwen2.5-Coder-3B Q8 = Executor
```

### Qwen2.5-3B-Instruct Q4_K_M

Bessere Wahl für den normalen Chat-Slot:

- Erklärungen
- kurze Zusammenfassungen
- Nutzerführung
- allgemeine Fragen
- Abschlussberichte

### Qwen3-Embedding-0.6B

Aufgabe:

- Code-Index
- semantische Dateisuche
- ähnliche Codebereiche
- Memory Retrieval
- Kandidaten für den Context Spooler

### Qwen3-Reranker-0.6B

Aufgabe:

- Suchtreffer neu bewerten
- irrelevante Chunks entfernen
- Kontextbudget schützen
- relevante Dateien priorisieren

Empfohlene Pipeline:

```text
Query
→ Embedding Top 30–50
→ Reranker
→ Top 5–12
→ Context Spooler
→ Arbeitsmodell
```

## 4. Optimale Workflows

### Feature planen

```text
FunctionGemma
→ Workflow planning
→ Embedding + Reranker
→ Qwen2.5-Coder-3B als Planner
→ Plan + Akzeptanzkriterien
```

### Feature implementieren

```text
FunctionGemma
→ Workflow implementation
→ Qwen2.5-Coder-3B als Coder
→ Dateien lesen
→ Patch erstellen
→ Tests
→ Qwen2.5-Coder-3B als Tester/Debugger
```

### Repository Review

```text
FunctionGemma
→ repository_review
→ Embedding/Reranker
→ Qwen2.5-Coder-3B als Reviewer
→ heuristische Checks
→ optional Yi-Coder-9B als Second Opinion
→ Findings deduplizieren
```

### Screenshot/UI-Fehler

```text
Bildinput erkannt
→ Qwen2.5-VL + MMProj
→ visuelle Evidence erzeugen
→ Qwen2.5-Coder-3B erhält Evidence + Sourcecode
→ Patch
→ Prüfung
```

Das Visionmodell extrahiert visuelle Fakten. Das Coder-Modell ändert den Sourcecode.

## 5. Notwendiger Slot-Umbau

```typescript
export type RuntimeSlotId =
  | "quality_cpu"
  | "fast_gpu"
  | "utility"
  | "orchestrator_cpu"
  | "vision_gpu";
```

Neue Tasktypen:

```typescript
| "image_analysis"
| "ui_analysis"
| "visual_debugging"
| "document_vision"
```

Neue Definition:

```typescript
vision_gpu: {
  id: "vision_gpu",
  purpose: "vision",
  hardwareClass: "hybrid",
  port: 8085,
  supportedTasks: [
    "image_analysis",
    "ui_analysis",
    "visual_debugging",
    "document_vision"
  ],
  allowImplicitFallback: false
}
```

Auf der 4-GB-GPU dürfen `vision_gpu` und `fast_gpu` nicht gleichzeitig resident sein.

```text
fast_gpu entladen
→ Vision-Paar starten
→ Bild analysieren
→ Vision entladen
→ fast_gpu bei Bedarf wieder starten
```

## 6. Produktionsregeln

1. Capability vor Modellname prüfen.
2. Vision nur bei echtem Bildinput starten.
3. Base-GGUF und MMProj als geprüftes Paar speichern.
4. Q2-Modelle niemals Auto-Apply erlauben.
5. Nur ein großes GPU-Arbeitsmodell gleichzeitig.
6. Rollen-Eignung über feste Codee-Szenarien zertifizieren.
7. JSON-, Tool-Call- und Patch-Stabilität getrennt bewerten.
8. Kein stiller Rollen-Fallback.
9. Kleine Modelle steuern, Arbeitsmodelle arbeiten.
10. Vision Evidence und Sourcecode-Patch trennen.

## 7. Zielprofil

```yaml
orchestrator:
  model: functiongemma-270m-it.Q8_0.gguf
  slot: orchestrator_cpu
  resident: true

chat:
  model: Qwen2.5-3B-Instruct.Q4_K_M.gguf
  slot: quality_cpu
  resident: false

work:
  model: qwen2.5-coder-3b-instruct-q8_0.gguf
  slot: fast_gpu
  resident: lazy
  roles: [planner, coder, tester, reviewer, debugger, docs]

vision:
  model: Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf
  projector: compatible-mmproj.gguf
  slot: vision_gpu
  resident: false
  start_condition: image_input_present
  exclusive_with: [fast_gpu]

embedding:
  model: Qwen3-Embedding-0.6B
  slot: utility

reranking:
  model: Qwen3-Reranker-0.6B
  slot: utility

advisor:
  model: Yi-Coder-9B-Chat.Q2_K.gguf
  resident: false
  permissions:
    patches: false
    auto_apply: false
```

## Schlussfolgerung

```text
Qwen2.5-VL aus dem Standard-Chat entfernen
→ Qwen2.5-3B-Instruct als Chatmodell

Qwen2.5-Coder-3B Q8 als verbindlichen Work-Agent behalten

Yi-Coder-9B Q2 nur als optionalen Advisor verwenden

Vision als eigenen, exklusiv geladenen Slot einführen
```

Das ist für Codees strukturierte Runs, Tool Calls und Patches auf deiner Hardware die stabilste Rollenverteilung.
