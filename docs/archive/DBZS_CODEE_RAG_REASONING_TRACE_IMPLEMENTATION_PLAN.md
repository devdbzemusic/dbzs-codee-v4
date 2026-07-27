# DBZS CODEE — RAG and Reasoning Trace Visualization Implementation Plan

Repository:

`devdbzemusic/dbzs-codee-project`

## Ziel

CODEE soll zwei neue, zusammenhängende Fähigkeiten erhalten:

```text
1. Repository-aware RAG
2. Optionale Reasoning-/Execution-Trace-Anzeige im Chat
```

Wichtig:

```text
Keine rohe private Chain-of-Thought anzeigen oder speichern.
```

Stattdessen visualisiert CODEE eine sichere, nachvollziehbare Ablaufspur aus:

```text
Retrieval Events
Context-Spooler-Entscheidungen
Agentenplan
Tool Calls
Patch-Vorschläge
Terminalbefehle
Websuche
Approvals
Tests
Fehler
Retries
Resultate
```

Die sichtbare Erklärung basiert auf realen Systemereignissen, nicht auf verborgenem Modell-Denken.

---

# 1. Zielarchitektur

```text
Workspace
→ Indexer
→ Search / Retrieval
→ Reranker
→ Context Spooler
→ Model Request
→ Agent Actions
→ Approval Coordinator
→ Tools / Patch / Terminal / Web
→ Result Events
→ Reasoning Trace Builder
→ Chat Visualization
```

RAG liefert Kandidaten.

Der Context Spooler entscheidet:

```text
welche Treffer
in welcher Reihenfolge
mit welchem Tokenbudget
in den Modellkontext gelangen
```

Der Reasoning Trace Builder erklärt anschließend:

```text
welche Quellen verwendet wurden
welche Schritte ausgeführt wurden
welche Entscheidungen getroffen wurden
welche Freigaben erforderlich waren
welches Ergebnis erzielt wurde
```

---

# 2. Abgrenzung

## RAG

RAG ist verantwortlich für:

```text
Information finden
Information bewerten
Information referenzieren
Information für den Prompt vorbereiten
```

## Context Spooler

Der Spooler ist verantwortlich für:

```text
Tokenbudget
Priorisierung
Deduplizierung
Trunkierung
Prompt-Zusammenstellung
Antwortreserve
```

## Reasoning Trace

Die Trace ist verantwortlich für:

```text
sichtbare Ablaufdarstellung
Nachvollziehbarkeit
Debugging
Status
Quellen
Aktionen
Ergebnisse
```

## Nicht zulässig

```text
private Modell-CoT
Roh-Reasoning-Tokens
Systemprompt-Inhalte
geheime Tool-Policies
Secrets
interne Sicherheitsentscheidungen
```

---

# 3. Phase 0 — Audit

Prüfe mindestens:

```text
backend/app/models/
backend/app/runtime/
backend/app/agent_workbench/
backend/app/trajectories/
backend/app/review_gates/

apps/desktop/src/services/embeddingService.ts
apps/desktop/src/services/runtimeChatAgentRunner.ts
apps/desktop/src/services/agentRunService.ts
apps/desktop/src/services/modelSelectionBroker.ts
apps/desktop/src/services/runtimeKernelService.ts
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/src/components/RuntimeChatTab.tsx
apps/desktop/src/components/RuntimeChatActivityPanel.tsx
apps/desktop/src/components/chat/
packages/shared/src/index.ts
```

Dokumentiere:

1. bestehende Embedding-Funktionen
2. bestehenden Modellindex
3. vorhandene Symbol-/Dateisuche
4. vorhandene Trajectory-/Agent-Events
5. bestehende Context-Erstellung
6. vorhandene Token- oder Zeichenlimits
7. bestehende Chat-Reasoning-Anzeige
8. vorhandene Approval-/Tool-/Patch-Events
9. bestehende Persistenz
10. vorhandene Diagnose-UI

---

# 4. RAG Phase 1 — Repository Index

Implementiere einen inkrementellen Workspace Index.

## Zu indexierende Einheiten

```text
Dateien
Klassen
Funktionen
Methoden
Interfaces
Types
Konstanten
Imports
Exports
Tests
Dokumentationsabschnitte
Konfigurationsdateien
```

## Shared Contract

```ts
export interface WorkspaceIndexEntry {
  id: string;
  workspaceId: string;

  sourceType:
    | "source_code"
    | "test"
    | "documentation"
    | "configuration"
    | "project_memory";

  filePath: string;
  language?: string;

  symbolName?: string;
  symbolKind?: string;

  startLine: number;
  endLine: number;

  content: string;
  contentHash: string;
  tokenCount: number;

  imports?: string[];
  exports?: string[];
  relatedSymbols?: string[];

  indexedAt: string;
}
```

---

# 5. Inkrementelle Indexierung

Nicht bei jedem Start das gesamte Repository neu indexieren.

Ablauf:

```text
Datei erkennen
→ Content Hash berechnen
→ Hash mit Index vergleichen
→ nur neue oder geänderte Einträge aktualisieren
→ gelöschte Einträge entfernen
```

Trigger:

```text
Workspace geöffnet
Datei gespeichert
Git Branch gewechselt
Datei erstellt
Datei gelöscht
manueller Reindex
```

Nicht bei jedem Tastendruck indexieren.

---

# 6. Chunking-Strategie

Für Sourcecode:

```text
symbolbasiert
nicht primär feste Zeichenblöcke
```

Priorität:

```text
Funktion
Methode
Klasse
Interface
Testfall
Dokumentationsabschnitt
```

Wenn ein Symbol zu groß ist:

```text
semantisch teilen
Signatur und Header erhalten
Importkontext referenzieren
```

Jeder Chunk erhält:

```text
Dateipfad
Zeilenbereich
Symbolname
Sprache
Hash
Tokenanzahl
```

---

# 7. Retrieval-Arten

Implementiere mehrere Retrieval-Kanäle.

```text
Exact File Search
Exact Symbol Search
Text/BM25 Search
Import/Dependency Search
Test-to-Source Search
Embedding Search
Recent Git Changes
Open Editor Context
```

Nicht nur Vektorsuche verwenden.

Empfohlene Reihenfolge für Coding:

```text
1. exakte Datei-/Symboltreffer
2. aktive Datei
3. direkte Imports und Exports
4. zugehörige Tests
5. BM25/Text
6. Embedding Similarity
7. Reranking
```

---

# 8. Retrieval Contract

```ts
export interface RetrievalQuery {
  id: string;
  workspaceId: string;
  query: string;
  intent:
    | "chat"
    | "coding"
    | "review"
    | "planning"
    | "debugging"
    | "documentation";

  activeFilePath?: string;
  mentionedPaths?: string[];
  mentionedSymbols?: string[];

  maxCandidates: number;
  maxFinalItems: number;
  tokenBudget: number;

  createdAt: string;
}
```

```ts
export interface RetrievedContextItem {
  id: string;
  sourceType:
    | "source_code"
    | "test"
    | "documentation"
    | "configuration"
    | "project_memory"
    | "chat_history"
    | "tool_output"
    | "web";

  sourcePath?: string;
  title?: string;
  symbol?: string;

  startLine?: number;
  endLine?: number;

  content: string;
  contentHash: string;
  tokenCount: number;

  retrievalMethod:
    | "exact"
    | "symbol"
    | "dependency"
    | "bm25"
    | "embedding"
    | "recent_change"
    | "active_editor";

  rawScore: number;
  rerankScore?: number;
  finalScore: number;

  retrievedAt: string;
}
```

---

# 9. Embedding Cache

```ts
export interface EmbeddingCacheEntry {
  sourceId: string;
  contentHash: string;
  embeddingModelId: string;
  dimensions: number;
  vectorRef: string;
  tokenCount: number;
  createdAt: string;
}
```

Regeln:

```text
unveränderter Hash
→ Embedding wiederverwenden

geänderter Chunk
→ nur diesen Chunk neu embedden

Modellwechsel
→ neue Embeddings getrennt speichern
```

---

# 10. Reranking

Reranking optional, aber vorbereitet.

Pipeline:

```text
Retriever liefert 20–40 Kandidaten
→ deduplizieren
→ Reranker bewertet
→ Top 3–5 an Spooler
```

Reranker-Fallback:

```text
wenn Reranker nicht verfügbar
→ kombinierter heuristischer Score
```

Score-Komponenten:

```text
Exact Match
Symbol Match
Active File Boost
Dependency Distance
BM25
Embedding Similarity
Recency
Test Relevance
```

---

# 11. Context Spooler Integration

RAG darf den Prompt nicht direkt befüllen.

```text
RAG
→ Retrieved Context Lane
→ Context Spooler
```

Der Spooler entscheidet anhand:

```text
Tokenbudget
Priorität
Relevanz
Quellendiversität
Deduplizierung
Antwortreserve
```

Lanes:

```text
Mandatory
Active Task
Relevant Code
Retrieved Context
Recent Conversation
Project Memory
Overflow
```

---

# 12. Tokenbudget

```ts
export interface RagTokenBudget {
  totalContextTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
  safetyReserveTokens: number;

  maxRetrievedContextTokens: number;
  maxCodeTokens: number;
  maxHistoryTokens: number;
  maxMemoryTokens: number;
}
```

Regel:

```text
Input
+ Output Reserve
+ Tool Reserve
+ Safety Reserve
<= Context Window
```

---

# 13. Retrieval Manifest

Jeder Agentenrequest erhält ein Manifest.

```ts
export interface RetrievalManifest {
  requestId: string;
  queryId: string;
  workspaceId: string;

  candidateCount: number;
  rerankedCount: number;
  selectedCount: number;

  selectedItems: Array<{
    itemId: string;
    sourcePath?: string;
    symbol?: string;
    startLine?: number;
    endLine?: number;
    retrievalMethod: string;
    score: number;
    tokenCount: number;
  }>;

  droppedItems: Array<{
    itemId: string;
    reason:
      | "token_budget"
      | "duplicate"
      | "low_score"
      | "stale"
      | "policy";
  }>;

  cacheHits: number;
  cacheMisses: number;
  totalTokens: number;
  createdAt: string;
}
```

---

# 14. Quellenreferenzen

RAG-Treffer müssen im Chat und Trace referenzierbar sein.

```ts
export interface SourceReference {
  id: string;
  sourceType: string;
  title: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  url?: string;
  symbol?: string;
}
```

Chatdarstellung:

```text
Verwendete Quellen

- runtimeSlotManager.ts · Zeilen 158–174
- launch.py · build_runtime_command()
- test_runtime_service.py · test_slot_start
```

Klick öffnet Datei und Zeilenbereich.

---

# 15. Reasoning-/Execution-Trace Contract

Keine private CoT.

```ts
export type TraceEventKind =
  | "intent_detected"
  | "model_selected"
  | "context_cache_hit"
  | "context_cache_miss"
  | "retrieval_started"
  | "retrieval_completed"
  | "sources_selected"
  | "plan_created"
  | "approval_requested"
  | "approval_granted"
  | "approval_rejected"
  | "tool_started"
  | "tool_completed"
  | "patch_proposed"
  | "patch_applied"
  | "command_started"
  | "command_completed"
  | "web_search_started"
  | "web_search_completed"
  | "validation_started"
  | "validation_completed"
  | "retry_started"
  | "run_completed"
  | "run_failed";
```

```ts
export interface ReasoningTraceEvent {
  id: string;
  runId: string;
  messageId?: string;

  kind: TraceEventKind;
  title: string;
  summary: string;

  status:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";

  sourceRefs?: string[];
  metadata?: Record<string, string | number | boolean | null>;

  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}
```

---

# 16. Sichere Reasoning Summary

Aus Trace Events wird eine kurze Zusammenfassung gebaut.

```ts
export interface SafeReasoningSummary {
  id: string;
  runId: string;
  title: string;
  summary: string;

  completedSteps: string[];
  currentStep?: string;
  assumptions?: string[];
  risks?: string[];
  nextAction?: string;

  sourceRefs?: string[];
  createdAt: string;
}
```

Keine Modell-Rohgedanken übernehmen.

---

# 17. Trace Builder

Implementiere:

```text
ReasoningTraceBuilder
```

Input:

```text
Agent Run Events
Retrieval Manifest
Context Manifest
Tool Events
Approval Events
Patch Events
Command Events
Web Events
Validation Events
```

Output:

```text
ReasoningTraceEvent[]
SafeReasoningSummary
```

Der Builder muss deterministisch sein.

---

# 18. Chat UI

Optionale Anzeige direkt an der Assistant-Nachricht.

## Modus Hidden

```text
keine Trace sichtbar
```

## Modus Summary

```text
Vorgehensweise

3 Quellen geprüft
1 Dateiänderung vorbereitet
Tests noch nicht ausgeführt
```

## Modus Expanded

```text
Ablauf

✓ Aufgabe als Coding-Auftrag erkannt
✓ 18 Kandidaten gefunden
✓ 4 Quellen ausgewählt
✓ Plan erstellt
⏳ Nutzerfreigabe erforderlich
```

---

# 19. UI-Einstellung

```ts
export type ReasoningTraceDisplayMode =
  | "hidden"
  | "summary"
  | "expanded";
```

Einstellung:

```text
Settings
→ Chat & Agent
→ Ablaufanzeige
```

Optionen:

```text
Aus
Kurz
Ausführlich
```

Default:

```text
Kurz
```

---

# 20. Retrieval UI im Chat

Einklappbare Karte:

```text
Kontext & Quellen

4 von 18 Treffern verwendet
1.842 Tokens
Context Cache: 3 Hits / 1 Miss

[Quellen anzeigen]
```

Expanded:

```text
runtimeSlotManager.ts
Symbol: configuredModelForSlot
Score: 0.94
Tokens: 286

launch.py
Symbol: build_runtime_command
Score: 0.91
Tokens: 412
```

---

# 21. Combined Trace Card

```text
CODEE Ablauf

1. Auftrag erkannt
2. Modell gewählt
3. Projektkontext geladen
4. RAG-Suche ausgeführt
5. 4 Quellen ausgewählt
6. Plan erstellt
7. Freigabe erforderlich

[Details] [Quellen] [Diagnose]
```

Wenn Approval erforderlich:

```text
[Plan übernehmen] [Ablehnen]
```

Approval Buttons bleiben getrennte Action Controls.

---

# 22. Keine CoT-Tag-Ausgabe mehr

Nicht verwenden:

```text
<reasoning-summary>
<chain-of-thought>
<analysis>
```

Reasoning kommt aus Trace Events.

Die normale Modellantwort bleibt normaler Chattext.

---

# 23. Telemetrie

Messe:

```text
Indexgröße
Indexierungsdauer
Embedding Cache Hits
Retrievaldauer
Rerankingdauer
Spoolerdauer
ausgewählte Tokens
verworfene Tokens
Context Cache Hits
Antwortlatenz
Trace-Event-Anzahl
```

---

# 24. Persistenz

Empfohlen:

```text
SQLite
```

Tabellen:

```text
workspace_index
embedding_cache
retrieval_runs
retrieval_items
context_manifests
agent_trace_events
source_references
```

Keine riesigen Vektoren direkt in JSON-Dateien, wenn SQLite/Vektorstore verfügbar ist.

---

# 25. Datenschutz und Sicherheit

Nicht indexieren:

```text
.env
Secrets
API Keys
Credentials
Private Keys
Build-Ausgaben
node_modules
binäre Dateien
.git internals
```

Workspace `.gitignore` respektieren.

Zusätzliche `.codeeignore` unterstützen.

---

# 26. UI: RAG Status

Header/Status:

```text
RAG: bereit
Index: 1.248 Chunks
Embedding Cache: 87 %
Letzter Reindex: vor 2 Minuten
```

Buttons:

```text
[Reindex]
[Index leeren]
[Embedding Cache leeren]
[Diagnose]
```

---

# 27. Phase 1 Acceptance-Test — Index

1. Workspace mit Source, Tests und Docs öffnen.
2. Index erzeugen.
3. Symbole korrekt erkennen.
4. nur geänderte Datei neu indexieren.
5. gelöschte Datei entfernen.
6. `.gitignore` und `.codeeignore` beachten.

---

# 28. Phase 2 Acceptance-Test — Retrieval

Nutzer:

```text
Wo wird der quality_cpu Slot konfiguriert?
```

Erwartung:

```text
Exact/Symbol Retrieval
→ runtimeSlotManager.ts
→ relevante Funktion
→ maximal 3–5 Treffer
→ Quellen sichtbar
```

---

# 29. Phase 3 Acceptance-Test — Coding RAG

Nutzer:

```text
Korrigiere das Rollenrouting für Chat und Coding.
```

Erwartung:

```text
relevante Slot-Dateien
Routing-Dateien
Tests
Konfiguration
```

Kein Laden des gesamten Repositorys.

---

# 30. Phase 4 Acceptance-Test — Trace

Erwartung:

```text
✓ Coding-Intent erkannt
✓ 21 Kandidaten gefunden
✓ 5 Quellen ausgewählt
✓ Plan vorbereitet
⏳ Freigabe erforderlich
```

Keine private CoT.

---

# 31. Phase 5 Acceptance-Test — Approval

Nach Plan:

```text
[Plan übernehmen] [Ablehnen]
```

Nach Patch:

```text
[Diff anzeigen] [Änderungen übernehmen] [Ablehnen]
```

Trace aktualisiert sich nach Klick eventbasiert.

---

# 32. Pflicht-Tests

1. inkrementelle Indexierung
2. Ignore-Regeln
3. Symbol-Chunks
4. Hash-basierte Aktualisierung
5. Embedding Cache Hit
6. Embedding Cache Invalidation
7. Exact Retrieval
8. BM25 Retrieval
9. Embedding Retrieval
10. Hybrid Ranking
11. Reranking
12. Deduplizierung
13. Tokenbudget
14. Antwortreserve
15. Retrieval Manifest
16. Source References
17. Trace Event Builder
18. Safe Reasoning Summary
19. Hidden/Summary/Expanded UI
20. Approval Event Integration
21. keine Roh-CoT
22. keine Secrets im Index
23. Dateiöffnung über Source Reference
24. Context Cache Integration
25. Performance Telemetrie

---

# 33. Testkommandos

```powershell
pnpm test:rag-index
pnpm test:rag-retrieval
pnpm test:rag-spooler
pnpm test:reasoning-trace
pnpm test:rag-chat-e2e
```

Backend:

```powershell
pytest backend/tests/test_workspace_index.py
pytest backend/tests/test_hybrid_retrieval.py
pytest backend/tests/test_context_spooler.py
pytest backend/tests/test_reasoning_trace.py
```

---

# 34. Qualitäts-Gates

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke-test
pnpm test:rag-index
pnpm test:rag-retrieval
pnpm test:rag-spooler
pnpm test:reasoning-trace
pnpm test:rag-chat-e2e
```

Keine Tests deaktivieren.

---

# 35. Implementierungsphasen

## Phase A — Contracts und Audit

```text
Shared Contracts
Datenflussdiagramm
Feature Flags
```

## Phase B — Workspace Index

```text
File/Symbol Index
Incremental Updates
Ignore Rules
```

## Phase C — Hybrid Retrieval

```text
Exact
Symbol
BM25
Dependency
Embedding
```

## Phase D — Reranker und Spooler

```text
Reranking
Deduplizierung
Tokenbudget
Manifest
```

## Phase E — Trace Builder

```text
Agent Events
Retrieval Events
Approval Events
Tool Events
```

## Phase F — Chat UI

```text
Summary
Expanded Trace
Sources
Status
```

## Phase G — E2E und Telemetrie

```text
Performance
Cache Hits
Latency
Visual Tests
```

---

# 36. Feature Flags

```ts
ragEnabled: true;
hybridRetrievalEnabled: true;
reasoningTraceEnabled: true;
rawModelCotEnabled: false;
```

Legacy-Heuristiken hinter Flag deaktivieren.

---

# 37. Definition of Done

Die Implementierung ist abgeschlossen, wenn:

1. Workspace inkrementell indexiert wird
2. Sourcecode symbolbasiert gechunkt wird
3. Exact, Symbol, BM25 und Embedding Retrieval funktionieren
4. Reranking optional funktioniert
5. Context Spooler RAG-Treffer budgetiert
6. Antwortreserve geschützt bleibt
7. Retrieval Manifest vorhanden ist
8. Quellen im Chat sichtbar und klickbar sind
9. Reasoning Trace aus realen Events gebaut wird
10. Hidden/Summary/Expanded funktionieren
11. Approval-Buttons korrekt integriert sind
12. keine rohe private CoT angezeigt oder gespeichert wird
13. RAG und Trace telemetrisch messbar sind
14. E2E-Test Coding-Auftrag → Retrieval → Plan → Approval → Patch beweist

---

# 38. Nicht Teil dieser Phase

```text
GraphRAG
Cloud Vector Database
Browser Automation
private CoT Anzeige
automatische Commits
automatische Pushes
vollständige semantische Codeanalyse für jede Sprache
```

---

# 39. Empfohlene Commits

```text
feat(rag): add workspace index contracts
feat(rag): add incremental symbol index
feat(rag): add hybrid retrieval pipeline
feat(rag): add embedding cache and reranking
feat(context): connect retrieval to context spooler
feat(trace): add execution trace event model
feat(chat): visualize retrieval sources and reasoning trace
test(rag): verify retrieval and trace end to end
docs(architecture): document rag and reasoning trace
```

---

# 40. Abschlussbericht

Liefern:

1. Audit
2. Ist- und Zielarchitektur
3. Indexstruktur
4. Retrieval-Pipeline
5. Spooler-Integration
6. Trace-Modell
7. UI-Nachweis
8. Cache- und Performance-Messwerte
9. Testresultate
10. bekannte Einschränkungen
11. nächste sinnvolle Ausbaustufe
