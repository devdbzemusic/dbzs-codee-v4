# Role Models Hotfix 3 GB / Grounding — Status

Branch: `fix/role-models-hotfix-3gb-grounding`  
Base: `main` @ `0c8fafc` (PR #32–#34)

## Umgesetzt

1. Workflow-Continuation ohne Chat-Sticky; Ambiguity → ask_user
2. Echtes answer_relevance Retry (max. 1×) + `answer_relevance_failed`
3. `VerifiedWorkspaceEvidence` für Grounding-Pfade
4. Workspace `detach` / `restore` statt Clear beider Roots
5. `settingsRevision` / `decisionSettingsRevision` vor Runtime-Start
6. Mini-Inference-Warm-up (`Antworte nur mit OK.`) vor First-Token
7. VL Text-only über `supportsTextOnly` (kein stiller Rollen-Fallback)

## Offen

- UI-Live-Repro StringLab mit ~3,1‑GB-Rollenmodellen
- Produktions-Build
- Settings-UI „Status: bindend“
- Backend-Test an No-Silent-Fallback anpassen

## Tests (lokal)

- Desktop typecheck: grün
- Desktop services/store: grün
- Backend runtime_service: 1 erwarteter Fail (silent architecture fallback)
