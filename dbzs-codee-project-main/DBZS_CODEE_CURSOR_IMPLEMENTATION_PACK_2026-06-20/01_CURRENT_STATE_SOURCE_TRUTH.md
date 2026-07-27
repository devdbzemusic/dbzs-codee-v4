# Aktueller Sourcecode-Stand — ehrliche Bewertung

## Reale, brauchbare Komponenten

### Workspace und Editor

Vorhanden:

- Workspace-Dateibaum
- Ordner- und Dateinavigation
- Filter, Pinned Files, Recent Files
- Git-Statusmarkierungen
- Monaco Editor
- mehrere Tabs
- Dirty State
- Diff-Vorschau
- Anwenden, Verwerfen und Wiederherstellen

### Terminal und sichere Commands

Vorhanden:

- One-shot Command Execution
- interaktive Shell-Session
- stdout/stderr
- Prozessabbruch
- Safe-Command-Allowlist
- Status- und Log-Polling

### Job Monitor und Agent Runner

Vorhanden:

- Job erstellen und claimen
- Rollen und Aufgabentypen
- Waypoints
- Artefakte
- SSE-/Polling-Aktualisierung
- `run-once`
- Context-Pack-Erzeugung
- lokales LLM oder Cloud-Fallback
- Patch-Proposals als JSON-Artefakt
- manuelles Anwenden mit Restore Point

### Runtime, Provider und Modelle

Vorhanden:

- llama.cpp über Backend-Proxy
- Ollama
- OpenAI
- Anthropic
- Runtime Doctor
- Warmup und Logs
- Modellindex
- lokaler Runtime-Start

## Harte Grenzen des aktuellen Agent Runner

`backend/app/agent_runner/service.py` arbeitet pro Aufruf nur einen Job einmalig ab.

Er verwendet als Agent-Tools nur:

- `filesystem.list_dir`
- `filesystem.read_text`

Der Context Pack wird aktuell auf einen kleinen Ausschnitt begrenzt:

- maximal 40 ausgewählte Dateien im Agent Runner
- maximal 8.000 Bytes je Datei beim Pack
- maximal 12.000 Zeichen im Coder-Prompt
- maximal 2.048 Antwort-Tokens
- maximal 5 Patch-Proposals
- maximal 64 KB Inhalt pro Patch

Das ist für kleine, gezielte Aufgaben brauchbar. Für breite Refactorings oder neue Multi-Modul-Projekte ist es zu dünn.

## Planner-Grenzen

Der vorhandene Planner ist überwiegend heuristisch:

- Schlüsselworterkennung
- feste Bereichsprofile
- drei bis fünf Standardtasks
- begrenzte Auswahl betroffener Dateien

Er ist hilfreich für Orientierung, aber kein belastbarer, dynamisch aktualisierter Ausführungsplan.

## Autonomous Session — kritischer Befund

`apps/desktop/src/components/AutonomousSessionPanel.tsx` ist derzeit eine Foundation, keine produktionsreife autonome Engine.

Probleme:

1. Queue-Zustand liegt in einer flüchtigen Renderer-`Map`.
2. Nach Neustart ist dieser Ablauf nicht zuverlässig fortsetzbar.
3. Sampled Files werden dem Planner teilweise ohne Inhalt übergeben.
4. Coder-Prompt kennt häufig nur Taskbeschreibung und Pfade.
5. Patch-Anwendung erfolgt im autonomen Pfad direkt über den Host.
6. Der Testschritt prüft teilweise nur den vorherigen Teststatus.
7. Der Debugschritt erzeugt aktuell IDs, aber keine echte Analyse.
8. Fehler beim Parsen oder Anwenden werden teilweise nur geloggt.
9. Backend-AgentRunner, Renderer-Autonomy und Review Gates bilden keine gemeinsame Transaktion.

## Review Gates

Backendseitig existieren Review Gates und Proposed Changes.

Die aktuelle UI ist aber nur:

- Zähler offener Freigaben
- Hinweis
- Button zum Runtime Chat

Es fehlt ein vollständiger Review-Arbeitsplatz mit:

- Datei-Diff
- Risiko
- zugehörigem Schritt
- Teststatus
- einzelnem Approve/Reject
- Apply-Ergebnis
- Rollback

## Hauptursache

Codee ist nicht zu schwach, weil UI-Elemente fehlen. Codee ist zu schwach, weil es drei teilweise parallele Agentenwege gibt:

1. `AgentRunnerService`
2. `AutonomousSessionPanel`
3. ältere Planner-/Review-/Debug-Agent-Panels

Diese müssen auf einen gemeinsamen `AgentRun`-Kern geführt werden.

## Schlussfolgerung

Der nächste sinnvolle Entwicklungsschritt ist keine neue Oberfläche und keine weitere Agentenrolle.

Zuerst benötigt Codee:

- persistente Runs
- persistente Schritte
- einheitliche Events
- echten Worker Loop
- Host-Action-Bridge
- geschlossenen Patch-/Review-/Test-Zyklus
