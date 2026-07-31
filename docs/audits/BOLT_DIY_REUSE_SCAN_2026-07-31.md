# bolt.diy Reuse-Scan fuer DBZS CODEE

Datum: 2026-07-31  
Quelle: `C:\Users\ralle\source\repos\bolt.diy`  
Referenz-Commit der Quelle: `2e254ac feat: add web URL content fetcher for chat context`  
Lizenz: MIT, Copyright StackBlitz, Inc. und bolt.diy contributors

## Kurzfazit

`bolt.diy` ist fuer CODEE nicht als Komplett-Uebernahme geeignet, aber als
Ideen- und Modulquelle sehr wertvoll. Die staerksten Kandidaten liegen in
MCP-Konfiguration, Provider-/Model-Registry, Workspace-Sicherheit,
Fallback-Parsing fuer Modellantworten und Workbench-UX.

Die technische Grundausrichtung unterscheidet sich deutlich:

- `bolt.diy`: Remix, Cloudflare, WebContainer, browsernahe Runtime, viele
  Cloud-Provider.
- DBZS CODEE: Electron Desktop, lokales Backend, llama.cpp, lokale Modelle,
  agentische Runtime, Workspace-Sicherheit.

Deshalb gilt: keine breite Code-Kopie. Stattdessen gezielt Konzepte extrahieren,
an CODEE-Architektur anpassen und jeweils mit Tests absichern.

## Wichtige Beobachtungen

- Der Quellordner enthaelt neben dem eigentlichen Projekt auch unversionierte
  Duplikate beziehungsweise Artefakte: `bolt.diy-main.zip`, `bolt.diy-main/`
  und `bolt/`.
- Fuer die Bewertung wurden `node_modules`, `.git`, Build-/Cache-Artefakte und
  Secret-nahe Dateien bewusst nicht als Uebernahmekandidaten behandelt.
- `.env.*` Dateien wurden nicht inhaltlich ausgewertet, um keine Secrets in
  Analyse, Doku oder spaetere Commits zu ziehen.
- Das kleine Paket `bolt/src/index.ts` enthaelt nur:

```ts
export function bootProject(): string {
  return "DBZS bolt bereit";
}

console.log(bootProject());
```

Das wirkt wie ein lokales Test-/Stub-Paket und ist fuer CODEE nicht relevant.

## Prioritaet A: Direkt wertvolle Konzepte

### 1. MCP-Service und Tool-Registry

Quelle:

- `app/lib/services/mcpService.ts`
- Settings-Bereich unter `app/components/@settings/tabs/mcp`

Warum wertvoll:

- Validierung von MCP-Server-Konfigurationen.
- Trennung von Server-Konfiguration, Client-Erzeugung und Tool-Registrierung.
- Unterstuetzung mehrerer Transportarten wie `stdio`, `sse` und
  `streamable-http`.
- Anzeige-sichere Tool-Definitionen, bei denen ausfuehrbare Details nicht
  ungefiltert in die UI laufen.

DBZS-Nutzen:

- Bessere MCP-Einstellungen in CODEE.
- Sauberere Tool-Registry fuer Agent Workbench und Runtime Chat.
- Stabilere Diagnose, welcher Server welches Tool liefert.

Empfohlene Umsetzung:

- Nicht direkt kopieren, sondern ein CODEE-eigenes Schema fuer MCP-Server
  definieren.
- Bestehende Runtime-/Tool-Abstraktionen in DBZS verwenden.
- Tests fuer ungueltige Transportarten, fehlende Felder, doppelte Toolnamen und
  deaktivierte Server ergaenzen.

### 2. Provider- und Model-Registry

Quelle:

- `app/lib/modules/llm/base-provider.ts`
- `app/lib/modules/llm/manager.ts`
- `app/lib/modules/llm/providers/*`

Warum wertvoll:

- Einheitliches Provider-Interface.
- Dynamische Modelllisten und Cache fuer Provider-Metadaten.
- OpenAI-kompatible Provider werden ueber gemeinsame Logik behandelbar.
- Provider-Metadaten sind gut als UX-Grundlage fuer Model-Selector geeignet.

DBZS-Nutzen:

- Bessere Modellkataloge fuer lokale und entfernte Provider.
- Klare Trennung zwischen Rollenmodell, Slot, Provider und Modellfaehigkeit.
- Grundlage fuer bessere Meldungen wie:
  "Slot X ist grenzwertig, Alternativen: A, B, C".

Empfohlene Umsetzung:

- Providerliste nur als Referenz nutzen, da Modellnamen und API-Details schnell
  veralten.
- DBZS sollte die Registry backendnah halten, weil lokale llama.cpp-Slots,
  VRAM/RAM und Serverstatus dort verlaesslicher bewertet werden koennen.
- UI bekommt eine normalisierte, kleine View-Struktur: Provider, Modell,
  Kontextfenster, Speicherbedarf, Eignung pro Rolle.

### 3. Datei- und Ordner-Locking

Quelle:

- `app/lib/persistence/lockedFiles.ts`
- `app/components/workbench/LockManager.tsx`

Warum wertvoll:

- Chat- beziehungsweise Session-bezogene Sperren fuer Dateien und Ordner.
- Parent-Folder-Lock wird beim Zugriff auf Kindpfade beruecksichtigt.
- Batch-Lock/Unlock und UI-Verwaltung sind bereits als Konzept vorhanden.

DBZS-Nutzen:

- Weniger versehentliche Aenderungen an sensiblen Projektbereichen.
- Besserer Schutz fuer Handover, Plaene, generierte Artefakte und fremde
  Arbeitsstaende.
- Gute Grundlage fuer "geschuetzte Dateien" in Runtime Chat und Agent
  Workbench.

Empfohlene Umsetzung:

- Nicht localStorage-only uebernehmen.
- Persistenz workspace-gebunden und backend-validiert machen.
- Locks muessen in Schreibpfad, Patch-Anwendung und UI sichtbar sein.

### 4. Enhanced Message Parser

Quelle:

- `app/lib/runtime/message-parser.ts`
- `app/lib/runtime/enhanced-message-parser.ts`

Warum wertvoll:

- Erkennt strukturierte Artefakte wie Dateiaktionen und Shell-Aktionen im
  Streaming.
- Hat Fallback-Heuristiken fuer Modellantworten, die Code schreiben, aber keine
  formale Action erzeugen.
- Kann helfen, "Antwort nicht verwertbar" zu reduzieren.

DBZS-Nutzen:

- CODEE kann aus schwach formatierten Modellantworten eher sinnvolle
  Auswahloptionen erzeugen.
- Passt zu den bisherigen Problemen mit `execution_no_action` und
  abgebrochenen/ungenutzten Antworten.
- Kann mit dem bestehenden Diagnose-Protokoll verbunden werden.

Empfohlene Umsetzung:

- Als isolierter Parser mit Tests bauen.
- Heuristiken defensiv halten, damit kein falscher Patch erzeugt wird.
- Ergebnis nicht automatisch ausfuehren, sondern dem Nutzer als Auswahl
  anbieten: Patch anwenden, Datei erzeugen, Shell-Befehl ausfuehren,
  ignorieren.

### 5. Action Runner und Aktions-Lifecycle

Quelle:

- `app/lib/runtime/action-runner.ts`

Warum wertvoll:

- Einheitlicher Status fuer Aktionen: `pending`, `running`, `complete`,
  `failed`, `aborted`.
- Sequenzielle Ausfuehrung mit Abort-Signal.
- Unterschiedliche Aktionstypen wie Datei, Shell, Build, Start.

DBZS-Nutzen:

- Bessere Darstellung laufender Agent-Aktionen.
- Stabilerer Job-Spooler fuer Runtime Chat.
- Klarere Fehlerdiagnose, besonders bei Build-/Start-Aktionen.

Empfohlene Umsetzung:

- Konzept uebernehmen, nicht WebContainer-Code.
- An DBZS-Backend-Jobs und Electron-IPC anbinden.
- Start-/Build-Aktionen mit Logs, Exitcode, Dauer und Retry-Option erfassen.

## Prioritaet B: Gute UI-/UX-Vorlagen

### Workbench

Quellen:

- `app/components/workbench/DiffView.tsx`
- `app/components/workbench/FileTree.tsx`
- `app/components/workbench/Search.tsx`
- `app/components/workbench/Preview.tsx`
- `app/components/workbench/ScreenshotSelector.tsx`
- `app/components/workbench/Workbench.client.tsx`

Moeglicher DBZS-Nutzen:

- Diff-Ansicht mit Grossdatei-/Binary-Schutz.
- Datei-Baum mit Kontextmenue, relativen Pfaden, Unsaved-State und Historie.
- Preview- und Inspector-Konzepte fuer Workbench.
- Screenshot-Auswahl als Vorlage fuer visuelle Agent-Kontexte.

Einschaetzung:

- Sehr gut als UX-Inspiration.
- Viele Komponenten sind gross und stack-spezifisch.
- Fuer DBZS besser in kleinere, modulare Komponenten zerlegen.

### Chat und Tool-Ausgaben

Quellen:

- `app/components/chat/ToolInvocations.tsx`
- `app/components/chat/ModelSelector.tsx`
- `app/components/chat/BaseChat.tsx`
- `app/components/chat/ChatBox.tsx`

Moeglicher DBZS-Nutzen:

- Bessere Darstellung von Tool-Aufrufen.
- Model-Selector-Ideen mit Provider- und Modellmetadaten.
- Chat-Operationen als UI-Referenz.

Einschaetzung:

- Keine 1:1-Uebernahme.
- Guter Ideengeber fuer CODEE Runtime Chat und Agent Workbench.

### Settings und Connector-UX

Quellen:

- `app/components/@settings/tabs/providers`
- `app/components/@settings/tabs/mcp`
- `app/components/@settings/tabs/github`
- `app/components/@settings/tabs/gitlab`
- `app/components/@settings/tabs/netlify`
- `app/components/@settings/tabs/vercel`
- `app/components/@settings/tabs/supabase`

Moeglicher DBZS-Nutzen:

- Struktur fuer modulare Einstellungsseiten.
- Provider- und Connector-spezifische Konfigurationen.
- Grundlage fuer klarere Runtime-/Provider-Verwaltung in CODEE.

Einschaetzung:

- UI-Struktur und Informationsarchitektur sind interessant.
- Auth-/Deployment-Details sind projektfremd und muessen geprueft werden.

## Prioritaet C: Nur bedingt brauchbar

### WebContainer-Runtime

Quellen:

- `app/lib/webcontainer/*`
- Shell-/Terminal-/Preview-Anbindungen rund um WebContainer

Warum nur bedingt:

- DBZS arbeitet nicht primaer mit WebContainer als Runtime-Basis.
- Lokale Prozesse, Python-Backend, llama.cpp und Electron-IPC sind fuer CODEE
  zentraler.

Trotzdem brauchbar:

- UI-Ideen fuer Terminalstatus, Ports, Preview und Prozessdiagnose.
- Konzepte fuer nicht-blockierende Start-Kommandos.

### Deploy- und Cloudflare-/Remix-Routen

Quellen:

- `app/routes/*`
- `functions/*`
- `wrangler.toml`
- Deployment-Komponenten

Warum nur bedingt:

- Stack passt nicht direkt zu DBZS.
- Cloudflare/Remix-spezifische Annahmen wuerden CODEE unnoetig verengen.

Trotzdem brauchbar:

- Connector-UX fuer Deployments.
- Status- und Fehlerdarstellung bei externen Diensten.

### Electron-Boilerplate

Quellen:

- `electron/*`
- `vite-electron.config.ts`
- `electron-builder.yml`

Warum nur bedingt:

- DBZS hat bereits eigene Electron-Struktur.
- Direkte Uebernahme kann Build- und Packaging-Konflikte erzeugen.

Trotzdem brauchbar:

- Einzelne Packaging- oder Update-Ideen koennen spaeter verglichen werden.

## Nicht uebernehmen

- `node_modules`
- `.git`
- Build-/Cache-/Coverage-Artefakte
- `bolt.diy-main.zip`
- unversionierte Duplikate `bolt.diy-main/`
- Secret-nahe Dateien wie `.env.*`
- generierte Timestamp-/Config-Artefakte ohne klaren Zweck
- Assets und Icons ohne konkreten UI-Bedarf

## Risiken

- Modell- und Providerlisten koennen veraltet sein. Vor produktiver Nutzung
  immer gegen aktuelle Anbieter-Dokumentation pruefen.
- Regex-basierte Parser koennen falsch-positive Dateiaktionen erzeugen.
  Deshalb duerfen erkannte Aktionen nicht ungeprueft automatisch ausgefuehrt
  werden.
- LocalStorage-basierte Persistenz reicht fuer DBZS nicht aus, weil
  Workspace-Sicherheit backendseitig und reproduzierbar sein muss.
- Viele bolt.diy-Komponenten sind gross. Eine direkte Uebernahme wuerde CODEE
  eher schwerer wartbar machen.
- MIT-Code darf genutzt werden, aber Lizenzhinweise muessen bei direkter
  Codeuebernahme erhalten bleiben.

## Empfohlener Migrationsplan

### Phase 1: Dokumentiert und sicher

Ziel:

- Keine Code-Uebernahme.
- Nur Konzepte erfassen und DBZS-Zielmodule definieren.

Arbeit:

- Diese Audit-Datei versionieren.
- Kandidaten in TODO/Handover aufnehmen, falls die naechste Planungsrunde das
  verlangt.
- Entscheiden, welcher Kandidat zuerst umgesetzt wird.

### Phase 2: Kleiner erster Implementierungs-Slice

Empfohlener Start:

- CODEE Artifact/Action Fallback Parser.

Warum:

- Direkter Nutzen fuer aktuelle Runtime-Probleme.
- Geringer Eingriff in Architektur.
- Gut testbar.
- Kann Nutzer-Auswahl erzeugen, statt "Antwort nicht verwertbar" anzuzeigen.

Zielverhalten:

- Wenn das Modell Code oder Befehle ohne formale Action liefert, erkennt CODEE
  moegliche Aktionen.
- CODEE bietet Auswahloptionen an:
  - Patch anzeigen
  - Datei erzeugen
  - Shell-Befehl vorschlagen
  - Nur Text uebernehmen
  - Ignorieren
- Keine automatische Ausfuehrung ohne bestaetigte Aktion.

### Phase 3: Workspace-Sicherheit

Naechster Kandidat:

- Datei-/Ordner-Locking.

Zielverhalten:

- Geschuetzte Pfade sind in Runtime Chat, Editor und Patch-Anwendung sichtbar.
- Schreibversuche auf gesperrte Pfade werden blockiert oder muessen bewusst
  bestaetigt werden.
- Locks sind workspace-gebunden persistent.

### Phase 4: Provider-/Slot-Intelligenz

Naechster Kandidat:

- Provider- und Model-Registry.

Zielverhalten:

- Slot, Rolle, Modell, Kontextfenster und Speicherbedarf werden zusammen
  bewertet.
- Bei grenzwertiger Rollenmodell-Konfiguration wird der konkrete Slot genannt.
- CODEE bietet passende Alternativmodelle an.

## Konkrete Empfehlung fuer den naechsten Schritt

Ich wuerde als naechstes nicht die grosse Provider-Registry anfassen, sondern
mit dem Fallback Parser starten. Das ist der kleinste Hebel mit dem groessten
direkten Nutzen fuer die aktuellen CODEE-Probleme:

- weniger "Antwort nicht verwertbar"
- bessere Auswahloptionen fuer den Nutzer
- klarere Diagnoseprotokolle
- geringe Gefahr fuer bestehende Runtime-Flows

Danach ist Datei-/Ordner-Locking der zweitbeste Kandidat, weil es die
Workspace-Sicherheit spuerbar erhoeht.

## Umsetzungsnotiz 2026-07-31

Status nach erster Umsetzung:

- Phase 2 wurde als kleiner CODEE-eigener Fallback umgesetzt:
  `runtimeChatNoActionRecovery` erkennt Diff-, Code-, Command- und
  Dateihinweise in nicht ausgefuehrten Modellantworten.
- Der Fallback erkennt inzwischen auch typische LLM-Ausgaben, bei denen ein
  Dateipfad als Markdown-Ueberschrift direkt vor einem Codeblock steht.
- `execution_no_action` zeigt nun Auswahloptionen statt nur einer harten
  Fehlermeldung: Aktion vorbereiten, mit Tools erneut starten oder nur
  analysieren.
- Ein erster Phase-3-Baustein wurde umgesetzt:
  workspace-lokale Pfadsperren aus `.codee/protected-paths.json`.
- Gesperrte Pfade werden im Agent-Patch-Preview-/Apply-Pfad blockiert, bevor
  eine Datei geschrieben wird.
- Der erste Phase-4-Baustein wurde umgesetzt:
  Resource-Risk-Rueckfragen nennen Slot, Modell und Empfehlung konkreter.
- Wenn "anderes Rollenmodell auswaehlen" gewaehlt wird, erzeugt CODEE nun
  zusaetzlich eine `Modell-Auswahl oeffnen`-Aktion fuer das Runtime-Panel.
- Die `Modell-Auswahl oeffnen`-Aktion setzt nun einen Runtime-Slot-Fokus im
  Notebook. Der Runtime-Tab zeigt dadurch sichtbar an, fuer welchen Slot ein
  alternatives Rollenmodell gewaehlt werden soll.
- Neue CODEE-Projekte bekommen beim Scaffold nun eine
  `.codee/protected-paths.json` mit sicheren Defaults und Beispielen fuer
  Datei-/Ordner-Sperren.

Unterstuetztes Lock-Format:

```json
{
  "protectedPaths": [
    "docs/ARCHITECTURE.md",
    { "path": "Plaene/", "reason": "Planungsdokumente nur nach Freigabe" }
  ]
}
```

Regeln:

- Ein Dateipfad ohne Slash am Ende sperrt exakt diese Datei.
- Ein Pfad mit Slash am Ende oder `/**` sperrt den gesamten Ordnerbaum.
- Absolute Pfade und `..` werden abgelehnt.
- Die Sperre verhindert Patch-Preview und Patch-Apply, fuehrt aber keine
  automatische Nutzerfreigabe ein.
