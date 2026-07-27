import { useState } from "react";
import type { RuntimeModelTestReport } from "@dbzs/shared";
import { runModelTest } from "@/services/runtimeModelTestService";

export function RuntimeModelTestPanel({ runtimeReady }: { runtimeReady: boolean }) {
  const [report, setReport] = useState<RuntimeModelTestReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = () => {
    setIsRunning(true);
    setError(null);
    void runModelTest()
      .then((result) => {
        setReport(result);
      })
      .catch((cause) => {
        setReport(null);
        setError(cause instanceof Error ? cause.message : "Modelltest fehlgeschlagen.");
      })
      .finally(() => {
        setIsRunning(false);
      });
  };

  return (
    <section className="border-b border-dbzs-border bg-dbzs-panelSoft px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-medium text-dbzs-text">Modell-Diagnose</h4>
          <p className="mt-0.5 text-[10px] text-dbzs-muted">
            Prueft Runtime, Chat und Streaming gegen das aktive Modell.
          </p>
        </div>
        <button
          className="rounded border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-3 py-1.5 text-[11px] font-medium text-dbzs-cyan disabled:opacity-40"
          disabled={!runtimeReady || isRunning}
          onClick={runTest}
          type="button"
        >
          {isRunning ? "Teste …" : "Modell testen"}
        </button>
      </div>

      {error ? <p className="mt-2 text-[11px] text-dbzs-red">{error}</p> : null}

      {report ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className={`rounded border px-2 py-0.5 uppercase tracking-[0.1em] ${
                report.overall === "pass"
                  ? "border-green-400/40 bg-green-400/10 text-green-400"
                  : "border-red-400/40 bg-red-400/10 text-red-400"
              }`}
            >
              {report.overall === "pass" ? "OK" : "Fehler"}
            </span>
            <span className="text-dbzs-muted">
              {report.model_name ?? report.model_id ?? "Modell"} ({report.provider ?? "runtime"})
            </span>
          </div>

          {report.steps.map((step) => (
            <div className="rounded border border-dbzs-border bg-dbzs-bg px-2 py-1.5" key={step.id}>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className={step.status === "pass" ? "text-green-400" : "text-dbzs-red"}>
                  {step.status === "pass" ? "✓" : "✗"} {step.label}
                </span>
                {step.duration_ms != null ? (
                  <span className="text-[10px] text-dbzs-muted">{step.duration_ms} ms</span>
                ) : null}
              </div>
              <p className="mt-1 text-[10px] leading-5 text-dbzs-muted">{step.detail}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
