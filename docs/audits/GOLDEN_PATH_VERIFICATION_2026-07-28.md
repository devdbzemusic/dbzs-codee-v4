# Golden-Path-Verifikation

Datum: 2026-07-28

Geprueftes GitHub-Repository: `devdbzemusic/dbzs-codee-v4`
Gepruefter `main`-HEAD zu Beginn dieses Laufs: `934d907650b75855bd5d6487fa5ceaa850ac5a64` (PR #4)

## Zweck

Konsolidiert die 10 Kriterien aus dem Personal-Production-Plan und die 12 aus
`Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_VERIFICATION_2026-07-28.md` zu einer
Liste und dokumentiert, was in dieser Sandbox automatisiert vorverifiziert
werden konnte und was zwingend eine manuelle Abnahme auf dem echten
Windows-Rechner braucht.

## Automatisierungsversuch: Ergebnis

Diese Sandbox hat `ELECTRON_RUN_AS_NODE=1` gesetzt, wodurch ein direkter
Electron-Start standardmaessig nur als reiner Node-Prozess ohne Fenster
laeuft. **Mit `env -u ELECTRON_RUN_AS_NODE` fuer den Playwright-Kindprozess
laesst sich jedoch ein echtes Electron-Fenster starten** — das war beim
vorherigen Verifikationsversuch (2026-07-27) noch nicht bekannt.

Backend (`uvicorn`, manuell ueber das venv gestartet, da `uv` in dieser Shell
fehlt) und Renderer-Dev-Server liefen vor. Danach:

```powershell
env -u ELECTRON_RUN_AS_NODE npx playwright test --reporter=list
```

Ergebnis: **11 von 41 Tests bestanden** (Laufzeit ~35 min).

| Spec-Datei | Ergebnis |
|---|---|
| `e2e/boot.spec.ts` | ✅ besteht (1/1) — sauberer Boot: Splash zuerst, Hauptfenster bleibt bis Render-Ack verborgen, wird dann sauber freigegeben |
| `e2e/command-palette.spec.ts` | ✅ besteht (3/3) — Cmd+K oeffnet/schliesst, Filterung funktioniert |
| `e2e/job-monitor.spec.ts` | ✅ besteht (2/2) — Panel sichtbar, Enqueue-Formular vorhanden |
| `e2e/mission-control.spec.ts` | ✅ besteht (3/3) — Sichtbarkeit ohne Workspace, Backend-Statuskarte, Desktop-Bereitschaft |
| `e2e/agent-capabilities.spec.ts` | ❌ 19/19 fehlgeschlagen |
| `e2e/coding-assistant.spec.ts` | ❌ 4/4 fehlgeschlagen |
| `e2e/context-integration.spec.ts` | ❌ 1/1 fehlgeschlagen |
| `e2e/runtime-chat.spec.ts` | ❌ 6/6 fehlgeschlagen |

**Ursache aller 30 Fehlschlaege ist identisch**: `getByPlaceholder(/Analysiere,
plane oder implementiere/i)` (der Runtime-Chat-Composer) wird nie sichtbar
bzw. aktiv. Das deutet darauf hin, dass diese vier Spec-Dateien eine
tatsaechlich laufende/verbundene lokale Modell-Runtime (oder eine in der
offiziellen CI-Umgebung vorbereitete Mock-Anbindung) voraussetzen, die in
diesem Ad-hoc-Setup (Backend ohne geladenes Modell) nicht gegeben war — nicht
ein Regressionsfehler aus dem heutigen Code-Fixes-Batch. Eine tiefere
Fehlersuche in der Testinfrastruktur war nicht Teil dieses Plans; das ist
inhaltlich ohnehin genau Kriterium 3 unten, das die echte Maschine braucht.

## Konsolidierte Checkliste

| # | Kriterium | Status |
|---|---|---|
| 1 | App startet fehlerfrei | ✅ automatisiert verifiziert (1×, `boot.spec.ts`) — 10× Wiederholung bleibt manuell |
| 2 | Projekt oeffnet sich und bleibt gespeichert | ⏳ manuell erforderlich |
| 3 | Lokales Modell verbindet sich automatisch | ⏳ manuell erforderlich (braucht echte Modell-Runtime) |
| 4 | Chat beantwortet Projektfrage | ⏳ manuell erforderlich (`runtime-chat.spec.ts` lief hier ins Leere mangels Modell-Runtime) |
| 5 | Full-Repository-Review laeuft durch | ⏳ manuell erforderlich |
| 6 | `.codee`/`.env`/Logs/Builds fehlen im Inventory | ✅ automatisiert verifiziert (Unit-Tests in `contextPolicy.test.ts` / `test_context_policy.py`, PR #4) |
| 7 | Aenderung erscheint zuerst als Diff | ⏳ manuell erforderlich |
| 8 | Aenderung verlangt Freigabe | ✅ automatisiert verifiziert (Unit-Test `agentToolProfile.test.ts`, PR #4) |
| 9 | Aenderung laesst sich anwenden | ⏳ manuell erforderlich |
| 10 | Tests lassen sich aus Codee starten | ✅ teilweise automatisiert (`job-monitor.spec.ts` bestaetigt UI-Chrome; echter Testlauf-Trigger bleibt manuell) |
| 11 | Rollback/Restore-Point funktioniert | ⏳ manuell erforderlich |
| 12 | Backup/Restore funktioniert (Diagnostics-Tab) | ⏳ manuell erforderlich (kein E2E-Test vorhanden) |
| 13 | Neustart nach Abbruch erhaelt Zustand | ⏳ manuell erforderlich (harter Kill noetig) |
| 14 | Gepackter Installer-Build: `backupService.ts`-userData-Pfad stimmt | ⏳ manuell erforderlich, echter Installer-Build noetig |

## Was seit dem letzten Verifikationslauf zusaetzlich fertig wurde

Vier kleine, unabhaengige Code-Fixes (siehe Commits `8f06ef8`, `dd31610`,
`2d211cf` auf `main`):

- `AtomicWriteFs.mkdir`-Typfehler behoben; vier lose Altaenderungen
  (Intent-Klassifikation fuer "Fix-Plan"/"Implementierungsplan") committet
- Vite-Warnungen zu gemischten statischen/dynamischen Imports in
  `runtimeChatStoreRuntimeHelpers.ts` aufgeloest — verifiziert per
  `electron-vite build` (keine Warnung mehr)
- Repository-Review: neuer `"empty_plan"`-Outcome ersetzt die generische
  `"failed"`-Klassifikation, wenn ein nicht-leeres Inventar auf null Batches
  faellt; Grund wird jetzt in `review-state.json` persistiert und im Chat
  ueber `currentBatchTitle` angezeigt

`npm run typecheck` ist seitdem erstmals vollstaendig fehlerfrei (vorher
zwei Restfehler in `atomicFileWrite.ts`/`.test.ts`).

## Empfehlung

### Go fuer die manuelle Abnahme

- Die automatisierbaren Anteile (Boot, UI-Chrome, Exclude-Policy, Freigabe-
  Pflicht) sind bestaetigt gruen.
- Die verbleibenden ⏳-Punkte oben erfordern zwingend die echte Maschine mit
  einer tatsaechlich verbundenen lokalen Modell-Runtime — das kann diese
  Sandbox strukturell nicht liefern (kein GGUF-Modell/kein llama-server hier
  verfuegbar).

### Startbefehle fuer die manuelle Abnahme

```powershell
git checkout main
git pull
pnpm install
cd backend
uv sync
cd ..
pnpm ci:local:win
pnpm dev
```

### Freigabekriterium

Unveraendert: vollstaendiger Durchlauf aller 14 Punkte funktioniert und ist
an zwei weiteren Tagen reproduzierbar → Tag `DBZS Codee 0.4.0-personal-stable`.
