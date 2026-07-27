# PR Review Quick Pass (5 Minuten)

## Ziel
Schneller Risiko-Scan fuer funktionale, sicherheitsrelevante und Integrationsprobleme.

## 1. API-Vertraege (1 Min)
- Sind die neuen Endpunkte erreichbar und konsistent benannt?
  - `GET/POST/PUT/DELETE /agents`
  - `GET/PUT/DELETE /project-memory`
  - `GET/POST/PUT/DELETE /task-board`
  - `GET /docs/analyze`, `POST /docs/generate`
- Stimmen Statuscodes mit Erwartung ueberein (`200`, `400`, `404`)?

## 2. Sicherheits-Guardrails (1 Min)
- Agent-Command-Allowlist aktiv und plausibel?
- Argument-Validierung vorhanden (Laenge, Metazeichen, Steuerzeichen)?
- Wird CWD validiert?

## 3. Renderer/IPC-Integritaet (1 Min)
- Sind nur gewuenschte Methoden im Preload exposed?
- Gibt es fuer neue IPC-Aufrufe passende Main-Handler?
- Werden Fehler vom Backend sichtbar im UI angezeigt?

## 4. Persistenz und Datenfluss (1 Min)
- Werden Agent/Task/Memory Daten sauber gespeichert und wieder geladen?
- Sind Default-/Leerzustaende im UI sinnvoll (keine Crashes bei leeren Listen)?

## 5. Regression-Signale (1 Min)
- Typecheck gruen?
- Backend-Tests gruen?
- Keine offensichtlichen Runtime-404 fuer neue Endpunkte?

## Ergebnis
- `PASS`: Keine Blocker, nur kosmetische Nacharbeiten.
- `SOFT BLOCK`: Einzelne nicht-kritische Korrekturen erforderlich.
- `HARD BLOCK`: Sicherheits-/Datenverlust-/API-Contract-Probleme vorhanden.
