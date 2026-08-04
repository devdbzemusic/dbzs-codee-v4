import { useState } from "react";
import type { ModelDownloadTask } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

type Step = "input" | "progress" | "done";

export function ModelDownloadWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("input");
  const [repoId, setRepoId] = useState("");
  const [filename, setFilename] = useState("");
  const [destDir, setDestDir] = useState("");
  const [task, setTask] = useState<ModelDownloadTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const handleStart = async () => {
    if (!repoId.trim() || !filename.trim() || !destDir.trim()) return;
    setError(null);
    try {
      const result = await backendClient.startModelDownload({
        repo_id: repoId.trim(),
        filename: filename.trim(),
        dest_dir: destDir.trim(),
      });
      setTask(result);
      setStep("progress");
      pollStatus(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start fehlgeschlagen.");
    }
  };

  const pollStatus = (taskId: string) => {
    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const t = await backendClient.getModelDownloadStatus(taskId);
        setTask(t);
        if (t.state === "completed" || t.state === "failed") {
          clearInterval(interval);
          setPolling(false);
          if (t.state === "completed") setStep("done");
          else setError(t.error ?? "Unbekannter Fehler.");
        }
      } catch {
        clearInterval(interval);
        setPolling(false);
      }
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md border border-dbzs-border bg-dbzs-panel p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-dbzs-text">Modell herunterladen</h2>
          <button className="text-xs text-dbzs-muted hover:text-dbzs-text" onClick={onClose} type="button">✕</button>
        </div>

        {step === "input" && (
          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-xs text-dbzs-muted">HuggingFace Repo-ID</label>
              <input
                className="mt-1 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
                onChange={(e) => setRepoId(e.target.value)}
                placeholder="z.B. TheBloke/Mistral-7B-Instruct-v0.2-GGUF"
                value={repoId}
              />
            </div>
            <div>
              <label className="block text-xs text-dbzs-muted">Dateiname (GGUF)</label>
              <input
                className="mt-1 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
                onChange={(e) => setFilename(e.target.value)}
                placeholder="z.B. mistral-7b-instruct-v0.2.Q4_K_M.gguf"
                value={filename}
              />
            </div>
            <div>
              <label className="block text-xs text-dbzs-muted">Zielordner</label>
              <input
                className="mt-1 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
                onChange={(e) => setDestDir(e.target.value)}
                placeholder="z.B. C:\models"
                value={destDir}
              />
            </div>
            {error && <p className="text-xs text-dbzs-red">{error}</p>}
            <button
              className="w-full border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-2 text-xs font-medium text-dbzs-cyan disabled:opacity-40"
              disabled={!repoId.trim() || !filename.trim() || !destDir.trim()}
              onClick={() => void handleStart()}
              type="button"
            >
              Download starten
            </button>
          </div>
        )}

        {step === "progress" && task && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-dbzs-muted">
              {task.repo_id} / {task.filename}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-dbzs-border">
              <div
                className="dbzs-transition-progress h-full bg-dbzs-cyan"
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <p className="text-xs text-dbzs-muted">
              Status: <span className="text-dbzs-text">{task.state}</span>
              {polling && " · Aktualisierung…"}
            </p>
            {error && <p className="text-xs text-dbzs-red">{error}</p>}
          </div>
        )}

        {step === "done" && task && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-dbzs-green">Download abgeschlossen!</p>
            <p className="break-all text-xs text-dbzs-muted">{task.local_path}</p>
            <button
              className="w-full border border-dbzs-border bg-dbzs-panelSoft px-3 py-2 text-xs text-dbzs-text"
              onClick={onClose}
              type="button"
            >
              Schließen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
