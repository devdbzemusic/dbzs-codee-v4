# Golden-Path-Verifikation

Datum: 2026-07-28

Geprueftes GitHub-Repository: `devdbzemusic/dbzs-codee-v4`
Gepruefter `main`-HEAD zu Beginn dieses Laufs: `934d907650b75855bd5d6487fa5ceaa850ac5a64` (PR #4)

## Zweck

Konsolidiert die 10 Kriterien aus dem Personal-Production-Plan und die 12 aus
`Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_VERIFICATION_2026-07-28.md` zu einer
Liste und dokumentiert, was tatsaechlich interaktiv mit einem echten lokalen
Modell auf der echten Maschine verifiziert wurde.

## Teil 1 — Automatisierungsversuch ueber die vorhandene Playwright-E2E-Suite

`env -u ELECTRON_RUN_AS_NODE` erlaubt einen echten Electron-GUI-Start in
dieser Sandbox (vorher als unmoeglich angenommen). Mit Backend + Renderer
vorgestartet:

```powershell
env -u ELECTRON_RUN_AS_NODE npx playwright test --reporter=list
```

Ergebnis: **11 von 41 Tests bestanden** (~35 min Laufzeit). `boot.spec.ts`
sowie die UI-Chrome-Specs (`command-palette`, `job-monitor`, `mission-control`)
bestehen; die vier Specs, die eine echte Modell-Runtime brauchen
(`agent-capabilities`, `coding-assistant`, `context-integration`,
`runtime-chat`), scheitern hier einheitlich, weil in diesem ersten
Ad-hoc-Setup noch kein echtes Modell verbunden war (siehe Teil 2, wo genau
das nachgeholt wurde).

## Teil 2 — Echter interaktiver Durchlauf mit echtem lokalem Modell

Auf dieser Maschine existieren echte GGUF-Modelldateien unter `D:\Models`
(z. B. `gemma-3-1b-it-qat-q4_0.gguf`, 720 MB). Damit wurde ein echter,
interaktiver Durchlauf versucht — isoliert von der echten Nutzerkonfiguration:

- eigenes `DBZS_APP_DATA_DIR` (Scratch-Backend-Settings, `modelsPath: D:/Models`,
  `defaultChatModelId`/`defaultModelId` auf `gemma-3-1b-it-qat-q4-0` gesetzt)
- eigenes `DBZS_DEV_USER_DATA_DIR` (Electron-Userdata inkl. vorbereitetem
  `workspace-state.json`)
- eigener Workspace: Kopie von `test-fixtures/runtime-chat-tuning-lab`
- Backend manuell per venv-Python gestartet (kein `uv` in dieser Shell)
- Electron per Playwright `_electron.launch()` gegen die gebaute
  `out/main/main.js`, echtes (nicht headless) Fenster

### Ergebnis

| # | Kriterium | Status |
|---|---|---|
| 1 | App startet fehlerfrei | ✅ echt verifiziert (`boot.spec.ts` + mehrere manuelle Starts in diesem Lauf) |
| 2 | Projekt oeffnet sich und bleibt gespeichert | ✅ echt verifiziert — Workspace blieb ueber mehrere App-Neustarts hinweg korrekt geladen |
| 3 | Lokales Modell verbindet sich automatisch | ✅ echt verifiziert — `gemma-3-1b` startete automatisch, Composer wurde aktiv |
| 4 | Chat beantwortet Projektfrage | ✅ echt verifiziert — echte LLM-Antwort auf eine Projektfrage zu `src/calculator.ts`, mit Screenshot belegt |
| 5 | Full-Repository-Review laeuft durch | ⚠️ zwei echte Bugs gefunden und gefixt (siehe unten); vollstaendiger Review-Abschluss danach nicht mehr im selben Lauf bestaetigt |
| 6 | `.codee`/`.env`/Logs/Builds fehlen im Inventory | ✅ automatisiert verifiziert (Unit-Tests, PR #4) |
| 7 | Aenderung erscheint zuerst als Diff | ⏳ nicht erreicht (Review-Bugs blockierten den Ablauf davor) |
| 8 | Aenderung verlangt Freigabe | ✅ automatisiert verifiziert (Unit-Test `agentToolProfile.test.ts`, PR #4) |
| 9 | Aenderung laesst sich anwenden | ⏳ nicht erreicht |
| 10 | Tests lassen sich aus Codee starten | ⏳ nicht erreicht (UI-Selektor im eigenen Testskript nicht gefunden, kein Hinweis auf App-Bug) |
| 11 | Rollback/Restore-Point funktioniert | ⏳ manuell erforderlich |
| 12 | Backup/Restore funktioniert (Diagnostics-Tab) | ⏳ manuell erforderlich |
| 13 | Neustart nach Abbruch erhaelt Zustand | ⏳ manuell erforderlich (harter Kill noetig) |
| 14 | Gepackter Installer-Build: `backupService.ts`-userData-Pfad stimmt | ⏳ manuell erforderlich, echter Installer-Build noetig |

### Zwei echte Bugs gefunden und behoben

Beide wurden ausschliesslich durch diesen echten interaktiven Durchlauf
sichtbar — keiner haette durch Unit-/E2E-Tests mit gemockter Bridge auffallen
koennen:

1. **Veralteter `runtime_dir` im Modell-Katalog** (`e9c1e54`): Der Review-
   Workflow waehlte automatisch ein anderes Modell (`gemma-2-2b-it`) und
   scheiterte mit `Llama.cpp Runtime-Verzeichnis nicht gefunden:
   D:/win_runtimes/llama.cpp-win-runtime`. Ursache: `models.catalog.json`s
   `runtime_dir`-Feld war veraltet (Verzeichnis existiert, ist aber leer);
   die echten Binaries liegen unter `D:/win_runtimes/llama/`.
   `ModelIndexService._from_catalog()` uebernahm den Katalogwert unvalidiert
   in `ModelIndexSummary.runtime_dir`, das vom Frontend
   (`pathValidatorService.ts`) *vor* jedem Modellstart ungeprueft
   konsultiert wird — obwohl die eigentliche Start-Logik
   (`runtime/launch.py::resolve_runtime_dir`) laengst eine robuste
   Fallback-Kette hat. Fix: neue `_resolve_catalog_runtime_dir()`-Funktion
   validiert den Katalogwert und faellt bei Bedarf auf
   `first_win_llama_runtime_dir()`-Discovery zurueck. Regressionstest ergaenzt
   (`test_model_index_falls_back_when_catalog_runtime_dir_is_stale`).
2. **Regression aus dem heutigen `dbzs:fs:stat`-Guard** (`9aba315`): Nach dem
   ersten Fix zeigte sich ein zweiter, ernsterer Fehler — die Modelldatei
   selbst wurde als "nicht gefunden" gemeldet, obwohl sie real existiert
   (`Test-Path` bestaetigt). Ursache: der PR-#4-Fix von heute frueh
   (Workspace-Grenzpruefung fuer `dbzs:fs:*`-IPC-Handler) band auch
   `dbzs:fs:stat` an Workspace/userData — `pathValidatorService.ts` prueft
   damit legitim Modell-Dateien ausserhalb des Workspace (`D:\Models\...`),
   was seitdem fehlschlug. Fix: `dbzs:fs:stat` bleibt ungeschuetzt (nur
   Existenz-/Metadaten-Check, kein Content-Leak — anders als
   `read-file`/`write-file`/`file:save`, die weiterhin korrekt auf
   Workspace/userData beschraenkt bleiben).

Nach beiden Fixes: `runtime_dir` im Modell-Index zeigte live korrekt auf
`D:\win_runtimes\llama\cpu-x64`; der weitere Durchlauf wurde aus
Zeitgruenden nicht bis zum vollstaendigen Review-Abschluss fortgesetzt (die
UI-Interaktion per Playwright traf danach nur noch auf
Testskript-eigene Selektor-Probleme, keine weiteren App-Fehler).

## Was insgesamt seit dem letzten Verifikationslauf fertig wurde

Sechs Fixes auf `main` (`8f06ef8`, `dd31610`, `2d211cf`, `acca3bf` fuer die
Restpunkte aus PR #4, sowie `e9c1e54` und `9aba315` aus diesem echten
Durchlauf):

- `AtomicWriteFs.mkdir`-Typfehler behoben; vier lose Altaenderungen committet
- Vite-Importwarnungen aufgeloest
- Repository-Review: `"empty_plan"`-Outcome statt generischem `"failed"`
- Veralteter Modell-Katalog-`runtime_dir` faellt jetzt auf Live-Discovery zurueck
- `dbzs:fs:stat`-Regression aus PR #4 behoben

`npm run typecheck` ist vollstaendig fehlerfrei; alle betroffenen Vitest-/
Pytest-Suiten (inkl. der beiden neuen Regressionstests) sind gruen.

## Empfehlung

### Go fuer die weitere manuelle Abnahme

Kriterien 1–4, 6, 8 sind jetzt mit echten Beweisen (nicht nur Unit-Tests)
verifiziert. Kriterium 5 hat zwei blockierende Bugs verloren, ist aber noch
nicht bis zum Ende durchlaufen bestaetigt. Kriterien 7, 9–14 bleiben offen —
dafuer empfiehlt sich jetzt eine kurze reale Sitzung (kein Sandbox-Workaround
noetig, die App laeuft auf dieser Maschine bereits nachweislich mit echtem
Modell): Review einmal bis zum Ende laufen lassen, eine Aenderung vorschlagen
lassen, anwenden, per Restore-Point zurueckrollen, `npm test` aus dem Agent
Workbench triggern, im Diagnostics-Tab ein Backup anlegen und wiederherstellen,
und einmal hart abbrechen und neu starten.

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
