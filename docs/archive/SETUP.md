# Setup

## Abhaengigkeiten installieren

```powershell
pnpm install
cd backend
uv sync
cd ..
```

Voraussetzungen: Node.js 24+, pnpm 11+, Python 3.13+, [uv](https://docs.astral.sh/uv/).

## App starten

```powershell
pnpm dev
```

Electron startet das Backend auf **`127.0.0.1:8876`**.

## Backend manuell pruefen

```powershell
pnpm dev:backend
Invoke-RestMethod http://127.0.0.1:8876/health
Invoke-RestMethod http://127.0.0.1:8876/job-spooler
```

## Validierung

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:backend
pnpm doctor:backend
pnpm doctor
```

Lokale Abnahme: [`LOCAL_ACCEPTANCE.md`](LOCAL_ACCEPTANCE.md)

## Manuelle Abnahme (Phase 0)

Nach `pnpm dev` kurz pruefen:

1. Settings → **Backend neu laden** (kein Fehler in der Konsole)
2. **JobMonitor** laedt Jobs (leere Liste ist ok)
3. Modellindex erscheint im AI/Agents-Panel (wenn `DBZS_MODELS_DIR` erreichbar)

Siehe auch [`HANDOVER.md`](../HANDOVER.md).
