# Binding Model Roles + Workflow Grounding — Status

Branch: `fix/binding-model-roles-workflow-grounding` (merged via PR #34)  
Follow-up: `fix/role-models-hotfix-3gb-grounding`

## Umgesetzt (PR #34)

1. Broker = einzige Autorität; Rollen-Settings bindend
2. On-Demand startet nur `resolvedModelId`
3. `modelRouterService` bevorzugt kein laufendes Fremdmodell
4. ActiveTaskContract + Follow-up-Erkennung
5. Grounding streicht unverifizierte Pfade
6. Backend: `start_model` ohne stille Modell-Substitution; `decision_id` erzwingt strict chat target
7. Service-Level Live-Repro StringLab grün (`stringLabBindingRepro.test.ts`)
8. Live-Backend `/runtime/slots`: alle Work-Slots `stopped` (Lazy Loading OK)

## Hotfix-Nachzug (3 GB)

Siehe `docs/audits/ROLE_MODELS_HOTFIX_3GB_STATUS.md`:

- Relevanz-Retry regeneriert einmal neu
- Contract-Gate ohne Chat-Sticky
- Verified-Path-Sammlung real
- Workspace detach/restore
- Settings-Revision + Inference-Warm-up

## Offen

- Settings-UI „Status: bindend“ / Ressourcenprofil
- End-to-end UI-Chat gegen laufendes Desktop (manuell)
