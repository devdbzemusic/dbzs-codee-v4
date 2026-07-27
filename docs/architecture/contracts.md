# Contracts

## Ziel

Shared- und Backend-Vertraege muessen als bewusst gepflegte Schnittstellen behandelt werden, nicht als Nebenprodukt einzelner Features.

## Besitzer

- Boot-/Readiness-Vertraege: `packages/shared/src/boot*` und `backend/app/api/health_contracts.py`
- Runtime-/Warm-up-/Routing-Vertraege: `packages/shared/src/runtime*` und `backend/app/runtime/schemas.py`
- Review-/Patch-/Approval-Vertraege: `packages/shared/src/index.ts` Uebergangsbereich, spaeter eigene Review-Barrels

## Quelle der Wahrheit

- Wire-Shape ist der Vertrag.
- Shared-Zod und Backend-Pydantic muessen dieselben Feldnamen und Pflichtfelder transportieren.
- Freitext-Nachrichten sind nie die einzige Vertragsquelle fuer Diagnose.

## Breaking-Regeln

- Feldumbenennung ist breaking.
- Pflichtfeld zu optional machen ist kompatibler als optional zu Pflicht.
- Neue optionale Felder sind erlaubt, wenn bestehende Consumer nicht brechen.
- Fehlercodes duerfen nur erweitert, nicht still uminterpretiert werden.

## Aktive Kernvertraege

- Boot startup/ready
- Resident model identity
- Runtime warm-up diagnostics
- Runtime route diagnostics
- Structured runtime errors
