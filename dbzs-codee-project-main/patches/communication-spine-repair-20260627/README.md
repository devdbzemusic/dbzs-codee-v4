# Communication Spine Repair - Patch Series

**Date**: 2026-06-27  
**Commits**: 12  
**Purpose**: Fix all 18 merge blockers for PR #19

## Installation

`ash
git checkout your-target-branch
git am communication-spine-repair-20260627/*.patch
`

## Commits

These patches include:
1. Backend discovery service and strict mode enforcement
2. Broker decision integration in store
3. Legacy router removal
4. Request schema fixes (fallback_policy)
5. Slot validator and chat_ready integration
6. AbortSignal propagation
7. UI diagnostics rendering
8. Test claim corrections
9. Final broker fixes

## Applying Selectively

If you only need certain patches:

`ash
git am communication-spine-repair-20260627/0001*.patch  # First patch only
git am communication-spine-repair-20260627/000{1,2}*.patch  # First two
`

## Rollback

If something goes wrong:

`ash
git am --abort
`

---

All patches are created from main branch after successful merge.
