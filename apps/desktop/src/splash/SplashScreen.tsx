import { useEffect, useState } from "react";
import type { BootState } from "@dbzs/shared";
import { BootProgress } from "./BootProgress";
import { BootPhaseRow } from "./BootPhaseRow";
import { BootLogPanel } from "./BootLogPanel";
import { BootErrorPanel } from "./BootErrorPanel";
import { BootControls } from "./BootControls";

export function SplashScreen() {
  const [state, setState] = useState<BootState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    window.dbzs.getBootState?.().then((initial) => {
      if (!cancelled) setState(initial);
    });
    const unsubscribe = window.dbzs.onBootState?.((next) => setState(next));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  if (!state) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-dbzs-bg text-dbzs-muted">
        Initialisiere…
      </div>
    );
  }

  const hasFailure = state.status === "failed";

  return (
    <div className="flex h-screen w-screen flex-col gap-3 overflow-hidden bg-dbzs-bg p-4 text-dbzs-text">
      <BootProgress state={state} now={now} />
      <div className="flex-1 space-y-0.5 overflow-y-auto">
        {state.phases.map((phase) => (
          <BootPhaseRow key={phase.id} phase={phase} now={now} />
        ))}
      </div>
      {hasFailure ? <BootErrorPanel state={state} /> : null}
      <BootLogPanel state={state} />
      {hasFailure ? <BootControls state={state} /> : null}
    </div>
  );
}
