# StringLab First Live Run – Phase 2 / Clarify Before Context

Stand: 2026-07-22
Branch: `fix/stringlab-clarify-before-context`
Basis: `origin/main` / Merge-Commit `61e5d140d07d1fe56b7f917b54f8f0084caa5e4d`

## Ergebnis

Der erste Phase-2-Folge-PR implementiert `Clarify Before Context`. Offene Coding-,
Review- und Planungsaufträge können eine strukturierte Rückfrage auslösen, bevor
teure oder potenziell falsche Kontextarbeit beginnt.

Für den StringLab-Zieltext

```text
Wir bauen heute eine kleine neue Funktion für StringLab
```

gilt jetzt deterministisch:

1. Intent: `small_code_change` statt `casual_chat`.
2. Fehlende konkrete Funktionsbeschreibung wird erkannt.
3. Codee zeigt `Welche konkrete Funktion soll StringLab bekommen?` als strukturierte
   Freitextfrage.
4. Der Aufruf endet an diesem Preflight-Gate.
5. Runtime-Status, Slot-Autostart/-Validierung, Workspace-Context,
   Context-Orchestrator und RAG werden vorher nicht aufgerufen.

## Architektur

- `AssistantQuestion` und `AssistantAnswer` bilden den gemeinsamen Vertrag.
- `clarificationPolicy` entscheidet anhand von Intent, fehlenden Pflichtangaben,
  Risiko und Fragebudget.
- `missingInformationPolicy` definiert workflow-spezifische Pflichtangaben.
- `questionCoordinator` pausiert und setzt echte `ask_user`-Tool-Aufrufe fort.
- `AssistantQuestionCard` rendert Single-/Multi-Choice, Boolean, Freitext,
  Datei-/Ordnerauswahl und Risikobestätigung.
- Offene Tool-Rückfragen werden workspace-intern unter
  `.codee/pending-question.json` persistiert und nach einem Neustart rehydriert.
- Projektentscheidungen können Folgefragen desselben Workflows vermeiden.

Der autoritative `modelSelectionBroker` bleibt die einzige Instanz für das finale
Modell-/Slot-Routing. Die Clarification-Policy ergänzt ihn, ersetzt ihn aber nicht.

## Workspace-Sicherheit

Alle `answer_question`-Actions tragen `workspaceRoot` und `workspaceId`.

- Runtime Chat rendert nur Rückfragen des aktiven Workspace.
- Eine Antwort mit abweichender Workspace-ID wird abgelehnt.
- Eine persistierte Rückfrage wird nur geladen, wenn ihr eingebetteter Workspace
  dem angefragten Workspace normalisiert exakt entspricht.
- Der Phase-1-Ausschluss von `.codee/**` aus KI-Kontext und RAG bleibt unverändert;
  die interne Persistenz wird nicht als Modellkontext verwendet.

## Integrierte bestehende Arbeit

Die vorhandene, zuvor nicht in `main` enthaltene Interview-Implementierung wurde
über ihre vier thematischen Commits integriert:

- `2510bf1` – Interaction Contracts
- `67cd754` – `ask_user` im Runtime-Tool-Kernel
- `8778e37` – Intent-/Missing-Information-/Clarification-Policy
- `39a4375` – Pause/Resume und UI-Integration

Beim Übernehmen wurden Konflikte mit dem Phase-1-Workspace-Scoping fachlich
zusammengeführt. Es entstand kein paralleles Rückfragesystem.

## Tests und Checks

- Zieltests für Broker, Missing-Information-Policy, Clarification-Policy,
  Question Coordinator, Persistence, Question Card und Runtime Chat: 75/75 grün
- Shared vollständig: 9/9 grün
- Desktop vollständig: 618 bestanden, 36 übersprungen
- Backend vollständig: 333/333 grün
- `pnpm typecheck`: grün
- `pnpm build`: grün

Bekannte unveränderte Hinweise:

- Vitest meldet die Node-`localStorage`-Experimentalwarnung.
- Pytest kann lokal `.pytest_cache` nicht beschreiben.
- FastAPI meldet die bestehende `TestClient`-/`httpx`-Deprecation.

## Noch offen in Phase 2

- FunctionGemma als echten Decision Path vor dem Broker anbinden
- Visionmodell ausschließlich bei echtem Bildinput zulassen
- CPU-/GPU-Slotzuordnung und Runtime-Header korrigieren
- Warnung und Stop auf den betroffenen Zielslot begrenzen
- Context-Stufen für kleine 4.096-Token-Slots einführen
- First-Token-SLO und die vollständige Electron-Live-Klickstrecke nachziehen
- WinError 10054 im längeren Runtime-Lauf beobachten

Diese Punkte bleiben separate, kleine Folge-PRs. Dieser Arbeitsstand verändert weder
Visionrouting noch Runtime-Stop- oder Context-Budget-Logik.
