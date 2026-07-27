# Golden Paths

## Desktop Pflichtpfade

- Boot success
- Boot degraded
- Retry sichtbar und nachvollziehbar
- Safe Mode
- Runtime Chat direct-intent ohne LLM
- Review-Remediation mit expliziter Review-ID
- Patch-Approval-Flow

## Backend Pflichtpfade

- Runtime start/stop
- Warm-up success
- `warmup_empty_response` mit Diagnosekontext
- Resident-Fallback
- Runtime route consistency
- structured runtime errors

## Shared / Contracts

- Schema snapshots
- Barrel exports
- Contract parity checks

## CI-Reihenfolge

1. Repo health
2. Contract parity
3. Desktop typecheck
4. Desktop Kern-Tests
5. Backend Kern-Tests
6. E2E / Live-Smoke
