import { useState } from "react";
import type { TaskBoardItem, TaskStatus } from "@dbzs/shared";
import { JobMonitorPanel } from "@/components/JobMonitorPanel";

export type JobsNotebookTabProps = {
  error: string | null;
  isLoading: boolean;
  isMutating: boolean;
  onCreate: (title: string, description: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onLinkJob: (taskId: string, jobId: string) => Promise<void>;
  onMove: (taskId: string, status: TaskStatus) => Promise<void>;
  onRefresh: () => Promise<void>;
  onUnlinkJob: (taskId: string, jobId: string) => Promise<void>;
  tasks: TaskBoardItem[];
};

function TaskBoardSection({
  error,
  isLoading,
  isMutating,
  onCreate,
  onDelete,
  onLinkJob,
  onMove,
  onRefresh,
  onUnlinkJob,
  tasks
}: JobsNotebookTabProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [linkInputs, setLinkInputs] = useState<Record<string, string>>({});

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Task Board</h3>
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40"
          disabled={isLoading || isMutating}
          onClick={() => void onRefresh()}
          type="button"
        >
          Refresh
        </button>
      </div>
      <input
        aria-label="Task title"
        className="mt-3 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
        onChange={(event) => setTitle(event.currentTarget.value)}
        placeholder="Task title"
        value={title}
      />
      <textarea
        aria-label="Task description"
        className="mt-2 h-16 w-full resize-none border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
        onChange={(event) => setDescription(event.currentTarget.value)}
        placeholder="Task description"
        value={description}
      />
      <button
        className="mt-2 w-full border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
        disabled={isMutating || title.trim().length < 2}
        onClick={() => void onCreate(title.trim(), description.trim())}
        type="button"
      >
        Task erstellen
      </button>
      {error ? <p className="mt-2 text-xs text-dbzs-red">{error}</p> : null}
      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
        {tasks.map((task) => (
          <div className="border border-dbzs-border bg-dbzs-bg p-2" key={task.id}>
            <div className="truncate text-xs font-medium text-dbzs-text">{task.title}</div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-dbzs-muted">
              <span>{task.status}</span>
              <button className="text-dbzs-cyan" onClick={() => void onMove(task.id, "todo")} type="button">
                todo
              </button>
              <button className="text-dbzs-cyan" onClick={() => void onMove(task.id, "in_progress")} type="button">
                doing
              </button>
              <button className="text-dbzs-cyan" onClick={() => void onMove(task.id, "done")} type="button">
                done
              </button>
              <button className="text-dbzs-red" onClick={() => void onDelete(task.id)} type="button">
                delete
              </button>
            </div>
            {(task.job_ids ?? []).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {(task.job_ids ?? []).map((jobId) => (
                  <span
                    className="flex items-center gap-1 rounded-sm bg-dbzs-cyan/10 px-1 py-0.5 text-[10px] text-dbzs-cyan"
                    key={jobId}
                  >
                    Job {jobId.slice(0, 8)}
                    <button
                      className="opacity-60 hover:opacity-100"
                      onClick={() => void onUnlinkJob(task.id, jobId)}
                      title="Verknüpfung aufheben"
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-1 flex gap-1">
              <input
                aria-label="Job-ID verknüpfen"
                className="flex-1 border border-dbzs-border bg-dbzs-bg px-1 py-0.5 text-[10px] text-dbzs-text"
                onChange={(e) => setLinkInputs((prev) => ({ ...prev, [task.id]: e.target.value }))}
                placeholder="Job-ID verknüpfen…"
                value={linkInputs[task.id] ?? ""}
              />
              <button
                className="border border-dbzs-border bg-dbzs-bg px-1 py-0.5 text-[10px] text-dbzs-cyan disabled:opacity-40"
                disabled={isMutating || !(linkInputs[task.id] ?? "").trim()}
                onClick={() => {
                  const jobId = (linkInputs[task.id] ?? "").trim();
                  if (jobId) {
                    void onLinkJob(task.id, jobId).then(() =>
                      setLinkInputs((prev) => ({ ...prev, [task.id]: "" }))
                    );
                  }
                }}
                type="button"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function JobsNotebookTab(props: JobsNotebookTabProps) {
  return (
    <div className="h-full min-h-0 space-y-4 overflow-y-auto p-4">
      <JobMonitorPanel />
      <TaskBoardSection {...props} />
    </div>
  );
}
