import type { BootPhaseDefinition } from "./bootPhaseDefinitions.js";
import type { PhaseRunner } from "./bootOrchestrator.js";

export interface BootGraphValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates the boot graph (phase definitions + registered runners) before
 * the orchestrator ever starts pumping phases. A cyclic or otherwise
 * malformed graph must fail loudly and immediately here — the alternative
 * (discovered only at runtime, as a phase that silently never becomes
 * runnable) is a boot that just hangs forever with no diagnostic.
 */
export function validateBootGraph(
  phaseDefinitions: BootPhaseDefinition[],
  runners: Record<string, PhaseRunner>
): BootGraphValidationResult {
  const errors: string[] = [];
  const definedIds = new Set(phaseDefinitions.map((def) => def.id));

  // 1. Every phase id is unique.
  const idCounts = new Map<string, number>();
  for (const def of phaseDefinitions) {
    idCounts.set(def.id, (idCounts.get(def.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) errors.push(`Duplicate phase id "${id}" (defined ${count} times)`);
  }

  // 2. Every dependency references an existing phase.
  for (const def of phaseDefinitions) {
    for (const dep of def.dependencies) {
      if (!definedIds.has(dep)) {
        errors.push(`Phase "${def.id}" depends on unknown phase "${dep}"`);
      }
    }
  }

  // 3. For every phase exactly one runner exists. 4. No runner exists without a phase.
  const runnerIds = new Set(Object.keys(runners));
  for (const def of phaseDefinitions) {
    if (!runnerIds.has(def.id)) {
      errors.push(`Phase "${def.id}" has no registered runner`);
    }
  }
  for (const runnerId of runnerIds) {
    if (!definedIds.has(runnerId)) {
      errors.push(`Runner "${runnerId}" has no matching phase definition`);
    }
  }

  // 5. The graph contains no cycle.
  const cyclePath: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  // Held in an object (rather than a bare `let`) so TS doesn't over-narrow
  // this closure-mutated flag to `never` after the loop below.
  const cycleState: { detected: string[] | null } = { detected: null };

  const visit = (id: string): void => {
    if (cycleState.detected || visited.has(id)) return;
    const def = phaseDefinitions.find((d) => d.id === id);
    if (!def) return; // unknown dependency already reported by check 2
    if (visiting.has(id)) {
      const startIdx = cyclePath.indexOf(id);
      cycleState.detected = [...cyclePath.slice(startIdx), id];
      return;
    }
    visiting.add(id);
    cyclePath.push(id);
    for (const dep of def.dependencies) {
      visit(dep);
      if (cycleState.detected) break;
    }
    cyclePath.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of definedIds) {
    visit(id);
    if (cycleState.detected) break;
  }
  if (cycleState.detected) {
    errors.push(`Boot graph cycle detected:\n${cycleState.detected.join(" -> ")}`);
  }

  // 6. Every phase is reachable from the start node(s) — phases whose
  // dependency chain eventually bottoms out at phases with zero dependencies.
  // Implemented independently of the cycle check above (fixed-point forward
  // propagation) so a configuration mistake gets its own clear diagnostic.
  const reachable = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const def of phaseDefinitions) {
      if (reachable.has(def.id)) continue;
      if (def.dependencies.every((dep) => reachable.has(dep))) {
        reachable.add(def.id);
        progressed = true;
      }
    }
  }
  for (const def of phaseDefinitions) {
    if (!reachable.has(def.id)) {
      errors.push(`Phase "${def.id}" is not reachable from the start (its dependency chain never fully resolves)`);
    }
  }

  // 7-10. Timeout/retry policy sanity checks.
  for (const def of phaseDefinitions) {
    const t = def.timeouts;
    const finiteNonNegative: Array<[string, number]> = [
      ["softTimeoutMs", t.softTimeoutMs],
      ["hardTimeoutMs", t.hardTimeoutMs],
      ["pollIntervalMs", t.pollIntervalMs],
      ["retryDelayMs", t.retryDelayMs],
      ["maxDeadlineExtensionMs", t.maxDeadlineExtensionMs]
    ];
    for (const [field, value] of finiteNonNegative) {
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`Phase "${def.id}": timeouts.${field} must be a finite number >= 0 (got ${value})`);
      }
    }
    // 8. hardTimeoutMs is greater than softTimeoutMs.
    if (Number.isFinite(t.hardTimeoutMs) && Number.isFinite(t.softTimeoutMs) && t.hardTimeoutMs <= t.softTimeoutMs) {
      errors.push(`Phase "${def.id}": timeouts.hardTimeoutMs (${t.hardTimeoutMs}) must be greater than softTimeoutMs (${t.softTimeoutMs})`);
    }
    // 9. pollIntervalMs is greater than 0.
    if (!(t.pollIntervalMs > 0)) {
      errors.push(`Phase "${def.id}": timeouts.pollIntervalMs must be greater than 0 (got ${t.pollIntervalMs})`);
    }
    // 10. maxRetries is an integer >= 0.
    if (!Number.isInteger(t.maxRetries) || t.maxRetries < 0) {
      errors.push(`Phase "${def.id}": timeouts.maxRetries must be an integer >= 0 (got ${t.maxRetries})`);
    }
    // 11. blocksWindowRelease is explicitly set.
    if (typeof def.blocksWindowRelease !== "boolean") {
      errors.push(`Phase "${def.id}": blocksWindowRelease must be explicitly set to true or false`);
    }
  }

  // 12. Exactly one release phase exists (a non-optional phase no other
  // phase depends on). Optional dangling leaves (e.g. resident-model, which
  // nothing downstream depends on by design) are legitimate and excluded
  // from this count — they are not release-phase candidates.
  // 13. The release phase is not optional.
  const dependedUpon = new Set<string>();
  for (const def of phaseDefinitions) {
    for (const dep of def.dependencies) {
      dependedUpon.add(dep);
    }
  }
  const danglingLeaves = phaseDefinitions.filter((def) => !dependedUpon.has(def.id));
  const releasePhases = danglingLeaves.filter((def) => !def.optional);
  if (releasePhases.length !== 1) {
    errors.push(
      `Expected exactly one non-optional release phase (a phase no other phase depends on), found ${releasePhases.length}: ` +
        `${releasePhases.map((p) => p.id).join(", ") || "none"}`
    );
  } else if (releasePhases[0].optional) {
    errors.push(`Release phase "${releasePhases[0].id}" must not be optional`);
  }

  return { valid: errors.length === 0, errors };
}
