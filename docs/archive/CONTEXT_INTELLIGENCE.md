# Context Intelligence

Status: **PARTIAL — Release Candidate Hardening**

DBZS baut Kontext über den Backend-Endpunkt `POST /context/build`. Der Desktop sendet
eine typisierte `ContextRequest`; der Backend-Orchestrator validiert den festen
Runtime-Slot, erstellt eine Repository Map, bewertet Evidenz, entfernt Duplikate und
hält das Tokenbudget ein. Jede Antwort enthält begründete Elemente, ausgelassene
Elemente und einen Retrieval Trace.

Der inkrementelle Index wird über `POST /context/index` erzeugt und unter
`.codee/repo-map.json` gespeichert. Datei-Hashes verhindern unnötige Neuanalyse.
TypeScript/TSX/JavaScript werden zusätzlich durch den vorhandenen Desktop-AST-Index
abgedeckt; Python-Symbole werden im Backend mit `ast` erfasst.

## Runtime-Zuordnung

- `quality_cpu:8081`: allgemeiner Chat auf CPU
- `fast_gpu:8082`: Coding, Review, Debugging, Planung, Architektur, Testanalyse und Refactoring auf GPU
- `utility:8083`: Embeddings, Reranking und Indexierung auf CPU/Hybrid

Ein falscher Slot erzeugt einen sichtbaren Fehler. Es gibt kein implizites Fallback.

## Persistenz und Wiederaufnahme

Die Agent Workbench behält SQLite als transaktionale Primärquelle und materialisiert
portable Manifeste in `.codee/tasks/<task-id>/`. Beim Resume werden Datei-Hashes mit
dem gespeicherten Workspace-Zustand verglichen. Änderungen führen zu
`workspace_changed`, statt einen veralteten Plan blind fortzusetzen.

## Bekannte Grenzen

- Semantisches Reranking benötigt weiterhin einen verfügbaren Utility-Runtime-Prozess.
- Der Relevanzgraph bildet derzeit Imports und Testnähe ab, keinen vollständigen Call Graph.
- Weitere Tree-sitter-Sprachen und automatische Impact Analysis bleiben P2.
