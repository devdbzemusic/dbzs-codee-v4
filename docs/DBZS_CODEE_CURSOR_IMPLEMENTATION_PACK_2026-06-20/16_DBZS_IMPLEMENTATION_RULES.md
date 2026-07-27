# DBZS Implementationsregeln

## Branding

Immer:

`Division By Zeros (DBZS)`

Nicht als Dragon Ball Z interpretieren.

## Quellcodedokumentation

Für jede neue nichttriviale Klasse, Funktion, Methode oder Prozedur:

- Was macht sie?
- Warum existiert sie?
- Input
- Output
- Fehlerfälle
- Seiteneffekte
- Eltern-/Kindbeziehungen, wenn relevant

Kommentare und Docstrings bevorzugt auf Deutsch.

Keine Kommentare, die nur den Code wiederholen.

## Architektur

- bestehende Services erweitern statt duplizieren
- Source of Truth klar benennen
- keine Geschäftslogik in React-Komponenten
- Renderer nicht als persistenter Workflow-Controller
- Backend- und Host-Verantwortung trennen
- Shared Contracts zentral halten
- keine stillen Fallbacks, die Erfolg vortäuschen

## Observability

Jede wichtige Aktion erzeugt:

- strukturierten Event
- Run-ID
- Step-ID
- verständliche Message
- optional technische Metadaten

Fehler müssen sichtbar sein in:

- Eventstream
- Runstatus
- Logs
- UI

## Sicherheit

- Workspace-Grenzen
- sichere Pfadauflösung
- Restore Point
- Before-Hash
- Command-Allowlist
- keine Secrets
- keine destruktiven Git-Kommandos
- keine direkte Patch-Anwendung ohne Review im supervised mode

## Qualität

- kleine Commits
- keine unnötigen Dependencies
- Typecheck
- Tests
- Build
- ehrliche Statusdokumentation
