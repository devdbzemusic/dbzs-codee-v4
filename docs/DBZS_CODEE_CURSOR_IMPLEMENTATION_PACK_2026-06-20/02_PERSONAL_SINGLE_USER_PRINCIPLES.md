# Architekturprinzipien für eine persönliche lokale Entwicklungsumgebung

## Grundsatz

Codee wird für einen Benutzer und einen lokalen Rechner gebaut.

Das erlaubt eine wesentlich schlankere Architektur als bei einem kommerziellen Teamprodukt.

## Bewusste Vereinfachungen

### Ein Benutzer

Nicht implementieren:

- Authentifizierung
- Benutzerprofile
- Rollen- und Rechteverwaltung
- Organisationen
- Mandantenfähigkeit
- Freigaben zwischen mehreren Personen

`reviewed_by` kann intern immer `"ralle"` oder `"local-user"` sein.

### Ein Desktop-Host

Es reicht zunächst:

- genau ein Electron-Host
- genau ein Host Executor
- genau ein primärer Workspace
- höchstens ein aktiv schreibender AgentRun

Mehrere analysierende Read-only-Runs können später ergänzt werden.

### Lokale Persistenz

SQLite ist ausreichend für:

- Runs
- Steps
- Events
- Tool Calls
- Follow-ups
- Host Actions
- Review-Verknüpfungen

Keine externe Datenbank.

### Lokale Kommunikation

- FastAPI nur auf `127.0.0.1`
- SSE für Live-Events
- HTTP für Commands
- Electron IPC für privilegierte Hostfunktionen

Kein Kafka, RabbitMQ, Redis oder WebSocket-Cluster.

### Kontrollierte Autonomie

Standardmodus:

`supervised`

Bedeutung:

- Lesen und Analysieren darf automatisch erfolgen.
- Commands dürfen nur aus Allowlist gestartet werden.
- Dateiänderungen benötigen Review.
- Git Commit benötigt explizite Freigabe.
- Auto-Apply bleibt standardmäßig aus.

## Was trotz Eigengebrauch nicht vereinfacht werden darf

- Workspace Boundary Checks
- Restore Points
- atomare Dateischreibvorgänge
- persistenter Run-Zustand
- nachvollziehbare Events
- Stop/Pause/Resume
- echte Tests statt Statussimulation
- Secrets niemals in Logs
- keine unkontrollierten Shell-Kommandos
- keine direkten Renderer-Schreibpfade außerhalb der Patch Pipeline

## Leistungsrahmen

Die Architektur muss zu Ralfs Rechner passen:

- CPU-first / Hybridbetrieb
- kleine bis mittlere lokale Modelle
- begrenzte GPU-Auslagerung
- Kontext selektiv nachladen
- nicht das gesamte Repository in einen Prompt pressen
- Tool-basierte Dateisuche und iteratives Lesen bevorzugen
