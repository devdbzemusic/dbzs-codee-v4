# DBZS Testing

## RC-Gates 0.4.0-rc.1

### Pflicht-Gates (für RC-Qualität)

- `pnpm typecheck`: Shared und Desktop Contracts.
- `pnpm test`: vollständige Shared-, Desktop- und Backend-Suite.
- `pnpm build`: Build der Desktop-Assets und Shared-Pakete.
- `pnpm smoke:packaging`: Backend-Bundle über `uv run python build.py` muss erfolgreich erzeugt werden.
- `pnpm check:version`: Versionsnummern müssen konsistent sein. Die Synchronisierung umfasst Root, Desktop, Shared, Backend und Electron Builder.
- `pnpm smoke-test`: lokale Release-Smoke- und Health-Prüfung.

### Optionale / Live-Gates

- `pnpm e2e`: deterministische Browser-/Electron-Bridge-Flows, falls die lokale Umgebung vollständig verfügbar ist.
- `pnpm audit --prod --audit-level moderate`: bindender Produktionsaudit, sofern das Projekt-Tooling die Audit-Ausführung zulässt.
- PyInstaller-`onedir`: Clean-Build über `backend/dbzs-backend.spec`; Health muss exakt `0.4.0-rc.1` melden.
- Live-Runtime- und Windows-Installer-Prüfungen bleiben eigene Hardware-/Release-Gates.

Freitext und unvollständige Streams dürfen keine ausführbare Chat-Aktion erzeugen. E2E prüft deshalb ausdrücklich das Fehlen eines Legacy-`Umsetzen`-Buttons; Approval-Flows verwenden die normalisierte Action Registry.

## RAG und sichere Execution Trace

```powershell
pnpm test:rag-index
pnpm test:rag-retrieval
pnpm test:rag-spooler
pnpm test:reasoning-trace
pnpm test:rag-chat-e2e
```

Die Backend-Tests verwenden isolierte temporäre SQLite-Dateien. Sie prüfen inkrementelle Hash-Updates, Löschungen, Ignore-/Secret-Regeln, Symbol-/FTS-Retrieval, Tokenbudget, Embedding-Cache und sichere Trace-Zusammenfassungen.

Die Desktop-Tests prüfen Spooler-Reserven, die eigene `retrieved_context`-Lane, Quellenmetadaten, Hidden/Summary/Expanded und das vollständige Verwerfen privater Reasoning-Tags.

Abschluss-Gates:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke-test
```

Lokale Pytest-Cache-Warnungen auf Windows betreffen nur `.pytest_cache`; sie ändern kein Testergebnis.

# Context-Intelligence-Gates

Für Änderungen an Kontext, Planner, Workspace oder Runtime sind mindestens
`pnpm typecheck`, `pnpm test`, `pnpm build` und `pnpm e2e` auszuführen. Das
Backend-Gate ist immer die vollständige Suite `uv run pytest -q`; gezielte
Security-Tests sind nur zusätzliche Nachweise. Packaging wird mit
`pnpm smoke:packaging` geprüft.
# Repository Review V2

Gezielte lokale Prüfung:

```powershell
pnpm --filter @dbzs/desktop exec vitest run src/components/chat/CodeeRunLiveBlock.test.tsx src/services/repositoryReview/repositoryReview.test.ts src/services/repositoryReview/reviewQuality.test.ts src/services/reviewRemediation.test.ts src/services/executionIntent.test.ts electron/reviewArtifactService.test.ts
```

Die redigierten Regression-Fixtures für den falschen 20-Sekunden-Alarm und das
fehlerhafte `implementation + debugger`-Routing liegen unter
`apps/desktop/src/services/repositoryReview/__fixtures__/`. Lokale Diagnoseexporte
unter `.codee` sind keine Test-Fixtures und dürfen nicht versehentlich committed
werden.
