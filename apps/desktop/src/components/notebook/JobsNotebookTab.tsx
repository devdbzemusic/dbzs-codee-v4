import { useMemo, useState } from "react";
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
  const [taskSearch, setTaskSearch] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState<"all" | TaskStatus>("all");
  const [taskSort, setTaskSort] = useState<"updated" | "status" | "title">("status");

  const taskCounts = useMemo(
    () =>
      tasks.reduce<Record<string, number>>((acc, task) => {
        acc[task.status] = (acc[task.status] ?? 0) + 1;
        return acc;
      }, {}),
    [tasks]
  );

  const visibleTasks = useMemo(() => {
    const query = taskSearch.trim().toLowerCase();
    return [...tasks]
      .filter((task) => (taskStatusFilter === "all" ? true : task.status === taskStatusFilter))
      .filter((task) => {
        if (!query) {
          return true;
        }
        return [task.title, task.description, ...(task.job_ids ?? [])]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => {
        if (taskSort === "title") {
          return left.title.localeCompare(right.title);
        }
        if (taskSort === "updated") {
          return (right.updated_at ?? "").localeCompare(left.updated_at ?? "");
        }
        return left.status.localeCompare(right.status) || left.title.localeCompare(right.title);
      });
  }, [taskSearch, taskSort, taskStatusFilter, tasks]);

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="rounded border border-dbzs-border bg-dbzs-bg p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-dbzs-muted">Workflow Board</div>
            <h3 className="mt-1 text-sm font-medium text-dbzs-text">Task Board</h3>
            <p className="mt-1 text-[11px] text-dbzs-muted">
              Aufgaben-Verknüpfung für Workflows. Separat vom Job-Lebenszyklus darunter.
            </p>
          </div>
          <button
            className="border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40"
            disabled={isLoading || isMutating}
            onClick={() => void onRefresh()}
            type="button"
          >
            Refresh
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <div className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1.5">
            <div className="uppercase tracking-[0.12em] text-dbzs-muted">Alle</div>
            <div className="mt-1 text-dbzs-text">{tasks.length}</div>
          </div>
          <div className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1.5">
            <div className="uppercase tracking-[0.12em] text-dbzs-muted">Todo</div>
            <div className="mt-1 text-dbzs-text">{taskCounts.todo ?? 0}</div>
          </div>
          <div className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1.5">
            <div className="uppercase tracking-[0.12em] text-dbzs-muted">Doing</div>
            <div className="mt-1 text-dbzs-cyan">{taskCounts.in_progress ?? 0}</div>
          </div>
          <div className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1.5">
            <div className="uppercase tracking-[0.12em] text-dbzs-muted">Done</div>
            <div className="mt-1 text-dbzs-text">{taskCounts.done ?? 0}</div>
          </div>
        </div>
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
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <input
          aria-label="Tasks suchen"
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
          onChange={(event) => setTaskSearch(event.currentTarget.value)}
          placeholder="Suche: Titel, Beschreibung, Job-ID"
          value={taskSearch}
        />
        <select
          aria-label="Task-Status filtern"
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
          onChange={(event) => setTaskStatusFilter(event.currentTarget.value as typeof taskStatusFilter)}
          value={taskStatusFilter}
        >
          <option value="all">Alle Stati</option>
          <option value="todo">todo</option>
          <option value="in_progress">in_progress</option>
          <option value="done">done</option>
        </select>
        <select
          aria-label="Tasks sortieren"
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
          onChange={(event) => setTaskSort(event.currentTarget.value as typeof taskSort)}
          value={taskSort}
        >
          <option value="status">Sortierung: Status</option>
          <option value="updated">Sortierung: Update</option>
          <option value="title">Sortierung: Titel</option>
        </select>
      </div>
      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
        {visibleTasks.map((task) => (
          <div className="border border-dbzs-border bg-dbzs-bg p-2" key={task.id}>
            <div className="truncate text-xs font-medium text-dbzs-text">{task.title}</div>
            {task.description ? <div className="mt-1 line-clamp-2 text-[11px] text-dbzs-muted">{task.description}</div> : null}
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
        {visibleTasks.length === 0 ? <p className="text-xs text-dbzs-muted">Keine Tasks im aktuellen Filter.</p> : null}
      </div>
    </section>
  );
}

export function JobsNotebookTab(props: JobsNotebookTabProps) {
  return (
    <div className="h-full min-h-0 space-y-4 overflow-y-auto p-4">
      <section className="border border-dbzs-border bg-dbzs-panel p-4">
        <div className="text-[10px] uppercase tracking-[0.16em] text-dbzs-muted">Phase 11 · Agent Workbench & Jobs</div>
        <h2 className="mt-1 text-lg font-medium text-dbzs-text">Jobs & Workflow Operations</h2>
        <p className="mt-2 text-sm text-dbzs-muted">
          Job-Queue, Laufstatus und Artefakte bleiben getrennt vom Workflow-Task-Board.
        </p>
      </section>
      <JobMonitorPanel />
      <TaskBoardSection {...props} />
    </div>
  );
}
