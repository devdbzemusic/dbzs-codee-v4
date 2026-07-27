# Performance Hotspots

## Aktiv messen

- Context-Building
- Routing-Entscheidung
- Time-to-first-token
- Workspace-Scan
- Runtime warm-up
- Slot-Fallback-Entscheidung

## Messprinzip

- Keine Annahmen ohne Messwert.
- Diagnoseansicht zeigt Kernzeiten statt nur Erfolg/Fehlschlag.
- Hot Paths werden dokumentiert, wenn sie reproduzierbar messbar sind.

## Aktuelle Zielbereiche

- `apps/desktop/src/stores/runtimeChatStore.ts`
- `apps/desktop/src/runtime/context/*`
- `backend/app/runtime/service.py`
- `apps/desktop/electron/boot/*`
