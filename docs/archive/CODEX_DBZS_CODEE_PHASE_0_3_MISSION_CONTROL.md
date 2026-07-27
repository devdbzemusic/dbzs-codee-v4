# Codex Auftrag — DBZS Codee Phase 0.3: Mission Control / First-Run Cockpit

## Ziel

Baue ein kleines, aber extrem nützliches **Mission Control Cockpit** direkt in den DBZS Code Assistant.

Nach dem Start soll Codee nicht nur “irgendwie offen” sein, sondern dem User sofort beantworten:

- Läuft das Backend?
- Startet das Backend gerade?
- Ist das Backend fehlgeschlagen?
- Ist die Electron-Bridge aktiv?
- Ist ein Workspace geöffnet?
- Wurden Projektdateien gescannt?
- Ist der Modellindex geladen?
- Sind startbare Modelle vorhanden?
- Ist Runtime gerade aktiv?
- Sind Jobs im Job-Spooler?
- Welche nächste Aktion ist sinnvoll?

Keine große Feature-Orgie. Nur ein Start-Cockpit, das Orientierung schafft.

## Warum

Phase 0 hat Stabilität gebracht. Jetzt braucht die App eine klare “Wo stehe ich?”-Oberfläche.
Das verhindert schwarze Bildschirme, Ratlosigkeit und Debugging im Blindflug.

## Grundidee

Wenn kein Workspace geöffnet ist oder Backend noch nicht bereit ist, soll im Hauptbereich ein gut sichtbares Cockpit erscheinen:

Titel:
`DBZS Codee Mission Control`

Untertitel:
`Lokaler AI Coding Assistant · Systemstatus und nächste Schritte`

Cards:

1. **Backend**
   - Status: starting / ready / failed / stopped / idle
   - Port anzeigen
   - Fehlermeldung anzeigen, falls vorhanden
   - Button: Backend neu laden

2. **Workspace**
   - Kein Workspace: Button “Projekt öffnen”
   - Workspace aktiv: Name, Pfad, Anzahl Dateien
   - Button: Dateien scannen

3. **Modelle**
   - Modellindex Status
   - Gesamtzahl Modelle
   - Ready llama.cpp / Ollama
   - Button: Modellindex neu laden

4. **Runtime**
   - stopped/running/error
   - aktives Modell falls vorhanden
   - Button: Runtime stoppen falls running

5. **Jobs**
   - offene/running/failed Jobs falls Store schon vorhanden
   - Button/Link: Job Monitor öffnen oder Panel-Hinweis

6. **Nächste sinnvolle Aktion**
   - Wenn Backend failed: “Backend-Fehler beheben”
   - Wenn kein Workspace: “Projekt öffnen”
   - Wenn Workspace aber keine Dateien: “Dateien scannen”
   - Wenn keine Modelle: “Modellpfade prüfen”
   - Wenn alles bereit: “Aufgabe formulieren oder Datei öffnen”

## Technische Anforderungen

### Renderer

Wahrscheinliche Dateien:

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/MissionControlPanel.tsx`
- `apps/desktop/src/stores/settingsStore.ts`
- `apps/desktop/src/stores/modelIndexStore.ts`
- `apps/desktop/src/stores/runtimeStore.ts`
- `apps/desktop/src/stores/workspaceStore.ts`
- optional `apps/desktop/src/stores/jobSpoolerStore.ts`

### Neue Komponente

Erstelle:

`apps/desktop/src/components/MissionControlPanel.tsx`

Props möglichst explizit halten, z. B.:

```ts
type MissionControlPanelProps = {
  backendStartupStatus: BackendStartupStatus | null;
  backendOnline: boolean;
  backendError: string | null;
  workspaceName: string | null;
  workspacePath: string | null;
  workspaceFileCount: number;
  modelTotal: number | null;
  readyModelCount: number;
  runtimeState: string | null;
  runtimeModelName?: string | null;
  onReloadBackend: () => void;
  onOpenWorkspace: () => void;
  onScanWorkspace: () => void;
  onReloadModels: () => void;
  onStopRuntime: () => void;
};
```

### Anzeige-Logik

Mission Control soll sichtbar sein, wenn mindestens eine dieser Bedingungen gilt:

- kein aktiver Tab
- kein Workspace geöffnet
- Backend nicht ready
- `backendStartupStatus.state === "failed"`
- `modelIndex` noch nicht geladen

Wenn ein Editor-Tab aktiv ist und alles bereit ist, soll die normale Editor-Ansicht Vorrang behalten.

### Browser-Fallback

Zusätzlich eine kleine Schutzkomponente einbauen:

Wenn `window.dbzs` fehlt, rendere statt Crash:

```text
DBZS Code Assistant läuft gerade im Browser-Modus.
Bitte über Electron starten: pnpm dev
Die Browser-Vorschau auf localhost:5173 enthält keine Electron-Bridge.
```

Wichtig:
In diesem Browser-Fallback dürfen keine backendClient-Aufrufe passieren.

### Design

- Bestehendes DBZS Neon/Dark UI verwenden
- Kein neues Designsystem
- Cards mit vorhandenen Klassen (`bg-dbzs-panel`, `border-dbzs-border`, `text-dbzs-muted`, `text-dbzs-cyan`)
- Kompakt, klar, nicht verspielt

## Tests

Falls Tests vorhanden/sinnvoll:

- MissionControlPanel rendert Backend-Fehler
- MissionControlPanel rendert “Projekt öffnen”, wenn kein Workspace
- BrowserFallback rendert ohne `window.dbzs`
- Typecheck muss grün sein

## Definition of Done

Folgende Commands müssen grün sein:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Zusätzlich manuell:

```powershell
pnpm --filter @dbzs/desktop dev
```

Akzeptanz manuell:

- Electron-Fenster öffnet sofort.
- Bei Backend-starting sieht man Status, nicht schwarze Fläche.
- Bei Backend-failed sieht man Fehlermeldung.
- Bei fehlendem Workspace sieht man “Projekt öffnen”.
- Bei geladenem Workspace sieht man Projektname und Datei-Anzahl.
- Browser auf localhost:5173 zeigt klare Electron-Hinweismeldung statt schwarzer Seite.

## Grenzen

- Keine neuen Backend-Features.
- Keine Agent-Runner-Implementierung in diesem Auftrag.
- Keine Runtime-Autostarts.
- Keine Dateischreiboperationen.
- Keine neue Dependency ohne zwingenden Grund.

## Abschlussbericht von Codex

Bitte liefern:

1. Geänderte Dateien
2. Was wurde gelöst?
3. Wie wurde Browser-Fallback umgesetzt?
4. Welche Commands wurden ausgeführt?
5. Was bleibt offen?
