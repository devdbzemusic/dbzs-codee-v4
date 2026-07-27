import { formatModelSizeBadge, type IndexedModel, type RuntimeStatus } from "@dbzs/shared";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { isRunnableModel } from "@/utils/modelUtils";

export function modelRowActionState(
  model: IndexedModel,
  status: RuntimeStatus | null,
  runtimeBusy: boolean
): { canStart: boolean; canStop: boolean; isActive: boolean } {
  const runnable = isRunnableModel(model);
  const isRunning = status?.state === "running";
  const isActive =
    isRunning &&
    (status?.model_id === model.id ||
      (status?.model_name != null && status.model_name === model.name));

  return {
    isActive,
    canStart: runnable && !runtimeBusy && !isRunning,
    canStop: isActive && !runtimeBusy
  };
}

export function canStopRuntime(status: RuntimeStatus | null, runtimeBusy: boolean): boolean {
  return status?.state === "running" && !runtimeBusy;
}

export function RuntimeModelsTab() {
  const { index, isLoading: indexLoading, loadModelIndex } = useModelIndexStore();
  const { status, isLoading: runtimeBusy, error: runtimeError, startModel, stopModel } = useRuntimeStore();
  const backendHealth = useSettingsStore((state) => state.backendHealth);
  const backendOnline = backendHealth?.status === "ok";
  const models = index?.models ?? [];
  const isRunning = status?.state === "running";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-dbzs-border bg-dbzs-panel px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-dbzs-text">Lokale Modelle</h2>
            <p className="mt-0.5 text-[11px] text-dbzs-muted">
              Backend: {backendOnline ? "aktiv" : "offline"}
              {status?.endpoint ? ` · ${status.endpoint}` : ""}
              {isRunning && status?.model_name ? ` · läuft: ${status.model_name}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isRunning ? (
              <button
                className="border border-red-400/50 bg-red-400/10 px-3 py-1 text-xs font-medium text-red-300 disabled:opacity-40"
                disabled={!canStopRuntime(status, runtimeBusy)}
                onClick={() => void stopModel()}
                type="button"
              >
                {runtimeBusy ? "Stoppt …" : "Runtime stoppen"}
              </button>
            ) : null}
            <button
              className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40"
              disabled={indexLoading}
              onClick={() => void loadModelIndex()}
              type="button"
            >
              Index aktualisieren
            </button>
          </div>
        </div>
        {index ? (
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-dbzs-muted">
            <span>Gesamt {index.summary.total}</span>
            <span>GGUF {index.summary.gguf_total}</span>
            <span>llama-server {index.summary.llama_server_ready}</span>
            <span>Ollama {index.summary.ollama_ready}</span>
          </div>
        ) : null}
        {runtimeError ? <p className="mt-2 text-xs text-dbzs-red">{runtimeError}</p> : null}
        {status?.message && status.state !== "running" ? (
          <p className="mt-2 text-xs text-dbzs-muted">{status.message}</p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!index ? (
          <p className="text-xs text-dbzs-muted">
            {indexLoading ? "Indexiere lokale Modelle …" : "Noch kein Modellindex geladen."}
          </p>
        ) : models.length === 0 ? (
          <p className="text-xs text-dbzs-muted">Keine Modelle im Index gefunden.</p>
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
            <thead className="sticky top-0 bg-[#091017]">
              <tr className="border-b border-dbzs-border text-dbzs-muted">
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Modell</th>
                <th className="px-2 py-2 font-medium">Rolle</th>
                <th className="px-2 py-2 font-medium">Launcher</th>
                <th className="px-2 py-2 font-medium">Compat</th>
                <th className="px-2 py-2 font-medium">Groesse</th>
                <th className="px-2 py-2 text-right font-medium">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => {
                const { canStart, canStop, isActive } = modelRowActionState(model, status, runtimeBusy);
                return (
                  <tr
                    className={`border-b border-dbzs-border/50 ${isActive ? "bg-dbzs-cyan/5" : ""}`}
                    key={model.id}
                  >
                    <td className="px-2 py-2">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-dbzs-cyan">
                          <span className="h-1.5 w-1.5 rounded-full bg-dbzs-cyan" />
                          läuft
                        </span>
                      ) : (
                        <span className="text-dbzs-muted">—</span>
                      )}
                    </td>
                    <td className="max-w-[220px] truncate px-2 py-2 font-medium text-dbzs-text" title={model.name}>
                      {model.name}
                    </td>
                    <td className="px-2 py-2 text-dbzs-muted">{model.recommended_use}</td>
                    <td className="px-2 py-2 text-dbzs-muted">{model.runtime_launcher}</td>
                    <td className="px-2 py-2 text-dbzs-muted">{model.compatibility}</td>
                    <td className="px-2 py-2 text-dbzs-muted">
                      {model.size_bytes > 0 ? formatModelSizeBadge(model.size_bytes) : "—"}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[10px] text-dbzs-cyan disabled:opacity-40"
                          disabled={!canStart}
                          onClick={() => void startModel(model.id)}
                          title={isRunnableModel(model) ? "Modell laden" : "Modell nicht startbar"}
                          type="button"
                        >
                          Laden
                        </button>
                        <button
                          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-muted disabled:opacity-40"
                          disabled={!canStop}
                          onClick={() => void stopModel()}
                          title="Modell stoppen"
                          type="button"
                        >
                          Stoppen
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
