# Cursor Auftrag — Phase 3D: Project Adapter und Host Action Bridge

## Voraussetzung

3A–3C sind grün.

## Ziel

Codee erkennt Projektarten, bietet sichere Commands an und kann privilegierte Desktop-Aktionen persistent anfordern.

Noch keine automatische Patch-Schleife.

## Backend

Neue Struktur:

```text
backend/app/project_adapters/
  base.py
  registry.py
  node.py
  python.py
  rust.py
  gradle.py
  cmake.py
```

Priorität:

1. Node/pnpm
2. Python/uv
3. Rust/Cargo
4. Gradle
5. CMake

## Host Actions

Neue Tabelle und API:

- `host_actions`
- next
- claim
- complete
- fail

Action Types:

- apply_patch
- run_command
- cancel_command
- git_create_branch
- git_commit
- refresh_workspace

## Desktop

Neue Service-Datei:

```text
apps/desktop/src/services/agentHostExecutor.ts
```

Sie verwendet ausschließlich vorhandene sichere `window.dbzs`-Bridges.

Keine beliebigen Commands.

## Idempotenz

- Action-ID eindeutig
- bereits abgeschlossene Action nicht erneut ausführen
- Claim Lease
- bei Renderer-Neustart offene Action wieder abrufbar
- Resultat persistieren

## Tests

- Adapter Detection
- Command IDs
- Gradle Windows Pfade
- Cargo/CMake Detection
- Host Action Claim
- doppelte Completion
- Executor Dispatch
- Fail/Retry
