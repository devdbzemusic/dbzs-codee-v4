# RAG- und Execution-Trace-Audit

Stand: 2026-07-12

## Ist-Zustand vor der Umsetzung

- `codeIndexService.ts` indexiert TypeScript/JavaScript im Renderer und persistiert eine vollständige JSON-Datei im Workspace. Hash-basierte Updates, Löschungen, Ignore-Regeln und Chunk-Inhalte fehlen.
- `contextRetrievalService.ts` kombiniert Pfad-, Import-, Export-, Symbol- und Project-Memory-Heuristiken. BM25, persistente Retrieval Runs und Source References fehlen.
- `embeddingService.ts` besitzt Clients für Embedding und Reranking, aber keinen persistenten Hash-/Modellcache.
- Der Context Spooler schützt Output-, Tool- und Safety-Reserven, hatte aber keine eigene Retrieved-Context-Lane.
- Context Cache, Runtime Activities, ATIF-light Trajectories, Review Gates und Tool-/Patch-/Web-Events sind vorhanden, jedoch nicht in einem gemeinsamen sicheren Chat-Trace-Vertrag normalisiert.
- Die Chat-UI besitzt Hidden/Summary/Expanded, bezieht die Erklärung aber aus modellgenerierten Reasoning-Blöcken und kann `<think>`-Inhalte darstellen.
- Persistenz ist im Backend bereits überwiegend SQLite-basiert; der neue RAG-/Trace-Datenbestand wird deshalb in `rag.sqlite3` isoliert.

## Ziel und Sicherheitsgrenze

Das FastAPI-Backend ist Eigentümer von Workspace-Index, Retrieval, Manifesten, Source References und Trace-Persistenz. Der Desktop bleibt Trigger, Spooler-Integrator und UI. Modell-Rohgedanken, Systemprompts, Secrets und interne Policies werden weder indexiert noch als Trace gespeichert oder angezeigt.
