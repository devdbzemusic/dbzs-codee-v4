# Agent Workbench Live Acceptance Test Project

Dieses Paket dient als isolierter Test-Workspace für live GGUF-Modelle im Codee-Szenario.

## Aufgabe für den Core Agent

1. Analysiere das Projekt über deine Tools (`filesystem.list`, `filesystem.read`, etc.).
2. Finde die fehlerhafte Implementierung in `calc.py` (derzeit `return a - b` statt einer korrekten Addition).
3. Korrigiere die Datei zu einer echten Addition (`return a + b`).
4. Verwende `propose_file_change`, um den Patch vorzuschlagen.
5. Nach Bewilligung führe die Tests mittels `pytest` via Host Command aus.
