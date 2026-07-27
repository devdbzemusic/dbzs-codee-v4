# Gap-Matrix — Cursor nur als Funktionsbenchmark

## Keine Kopierabsicht

Diese Matrix beschreibt keinen Nachbau von Cursor. Sie verwendet sichtbare Cursor-Funktionen lediglich als Vergleich, um die fehlenden Codee-Fähigkeiten zu bestimmen.

| Funktionsbereich | Codee heute | Ziel |
|---|---|---|
| Persistente Agent-Session | mehrere getrennte Zustände | zentraler `AgentRun` |
| Plan-Checkliste | PlannerPlan, teilweise heuristisch | persistente Steps mit Status |
| Aktiver Schritt | Waypoints/Status vorhanden | Step als Quelle der Wahrheit |
| Live-Aktivitäten | Job Events und Trajectory vorhanden | einheitlicher typisierter Eventstream |
| Dateioperationen | Patch-Proposals/Apply vorhanden | FileChange-Objekt mit Diff und Statistiken |
| Follow-up | Runtime Chat getrennt | Follow-up an bestehenden Run |
| Stop/Pause/Resume | teilweise vorhanden | backendpersistente Zustandsmaschine |
| Neustart-Recovery | Renderer-Abläufe verlieren Zustand | Run vollständig wiederherstellbar |
| Build/Test | Safe Commands vorhanden | Adapter erkennt Projekt und Commands |
| Debug Loop | Debug-Panel vorhanden, autonome Stubs | Fehlerdiagnose erzeugt echten Debug-Step |
| Review | Backend Gate + kleine Hinweisbox | vollständiger Review-Dock |
| Workspace Refresh | Explorer hat Scan/Auto Refresh | automatisch nach Host Action |
| Output | Terminal und Job-Artefakte | Run-bezogener Output mit Filter |
| Problems | nicht geschlossen integriert | strukturierte Diagnosen |
| Modellbindung | Runtime/Provider vorhanden | Modell pro Run/Step dokumentiert |
| Toolhistorie | unvollständig | persistente Tool Calls mit Ergebnis |

## Wichtigster Unterschied

Cursor zeigt einen zusammenhängenden Arbeitslauf.

Codee muss deshalb nicht dessen Layout übernehmen. Codee muss seine vorhandenen Module unter einer einzigen Laufzeitidentität verbinden.
