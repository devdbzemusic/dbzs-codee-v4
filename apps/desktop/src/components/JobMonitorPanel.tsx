import type { JobRecord } from "@dbzs/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentRegistryStore } from "@/stores/agentRegistryStore";
import { parsePatchProposalsFromArtifacts, useAgentRunnerStore } from "@/stores/agentRunnerStore";
import { type JobStatusFilter, useJobSpoolerStore } from "@/stores/jobSpoolerStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useToastStore } from "@/stores/toastStore";
import { useJobTemplates } from "@/hooks/useJobTemplates";
import { autoPriority } from "@/utils/autoPriority";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { TrajectoryMiniPanel } from "@/components/TrajectoryMiniPanel";
import { openPlatformDiagnosticsWindow } from "@/utils/platformDiagnosticsWindow";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_FILTERS: Array<{ label: string; value: JobStatusFilter }> = [
  { label: "Alle", value: "all" },
  { label: "Queued", value: "queued" },
  { label: "Claimed", value: "claimed" },
  { label: "Running", value: "running" },
  { label: "Verifikation", value: "waiting_verification" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Cancelled", value: "cancelled" },
];

const AGENT_ROLES = ["planner", "coder", "tester", "reviewer", "debugger", "docs"] as const;
const TASK_TYPES = ["generic", "coding", "code_review", "planning", "testing", "docs", "debug"] as const;
const WAYPOINT_OPTIONS = ["started", "progress", "checkpoint", "waiting_verification", "failed", "completed"] as const;
const ARTIFACT_KINDS = ["input", "intermediate", "output", "log", "evidence"] as const;
const VERIFY_VERDICTS = ["passed", "failed"] as const;
const ARTIFACT_FILTERS = ["all", "input", "intermediate", "output", "log", "evidence"] as const;

const ACTIVE_STATUSES = new Set(["claimed", "running", "waiting_verification"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const VERIFYABLE_STATUSES = new Set(["running", "waiting_verification"]);

const POLL_INTERVAL_MS = 5000;
const DETAIL_POLL_INTERVAL_MS = 5000;
const JOB_BUCKETS = [
  { key: "queue", title: "Queue", statuses: ["queued", "claimed"] as const },
  { key: "running", title: "Running", statuses: ["running"] as const },
  { key: "waiting", title: "Waiting", statuses: ["waiting_verification"] as const },
  { key: "completed", title: "Completed", statuses: ["completed"] as const },
  { key: "failed", title: "Failed", statuses: ["failed"] as const },
  { key: "cancelled", title: "Cancelled", statuses: ["cancelled"] as const }
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeClass(status: string): string {
  switch (status) {
    case "queued":               return "text-amber-400 border-amber-400/40 bg-amber-400/10";
    case "claimed":              return "text-blue-400 border-blue-400/40 bg-blue-400/10";
    case "running":              return "text-dbzs-cyan border-dbzs-cyan/40 bg-dbzs-cyan/10";
    case "completed":            return "text-green-400 border-green-400/40 bg-green-400/10";
    case "failed":               return "text-red-400 border-red-400/40 bg-red-400/10";
    case "cancelled":            return "text-gray-500 border-gray-500/40 bg-gray-500/10";
    case "waiting_verification": return "text-orange-400 border-orange-400/40 bg-orange-400/10";
    default:                     return "text-dbzs-muted border-dbzs-border bg-dbzs-bg";
  }
}

function formatTs(value: string | null): string {
  return value ? new Date(value).toLocaleString("de-DE") : "-";
}

function formatJobLabel(job: JobRecord): string {
  return `${job.title} · P${job.priority}`;
}

function maxProgress(events: Array<{ progress?: number | null }>): number {
  return events.reduce((acc, ev) => (typeof ev.progress === "number" ? Math.max(acc, ev.progress) : acc), 0);
}

function hasPassedVerification(verifications: Array<{ verdict: string }>): boolean {
  return verifications.some((v) => v.verdict === "passed");
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function statusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Queue";
    case "claimed":
      return "Claimed";
    case "running":
      return "Running";
    case "waiting_verification":
      return "Waiting";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${statusBadgeClass(status)}`}>
      {status === "waiting_verification" ? "verify" : status}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-dbzs-border">
      <div
        className="dbzs-transition-progress h-full rounded-full bg-dbzs-cyan"
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-dbzs-border bg-dbzs-panelSoft px-2 py-1">
      <div className="text-[10px] uppercase tracking-[0.12em] text-dbzs-muted">{label}</div>
      <div className="mt-0.5 break-words text-xs text-dbzs-text">{value}</div>
    </div>
  );
}

function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-dbzs-border bg-dbzs-bg">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-dbzs-muted hover:text-dbzs-text"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="uppercase tracking-[0.12em]">{title}</span>
        <span className="text-dbzs-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="border-t border-dbzs-border p-3">{children}</div>}
    </div>
  );
}

function ExpandableArtifact({ name, kind, content, jobId }: { name: string; kind: string; content: string; jobId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const isOutput = kind === "output";
  const preview = content.slice(0, 120);
  const truncated = content.length > 120;
  const workspacePath = useWorkspaceStore((s) => s.state.projectPath);
  const toast = useToastStore();

  const handleOpenInEditor = async () => {
    if (!workspacePath) { toast.warning("Workspace fehlt", "Projekt zuerst öffnen."); return; }
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${workspacePath}/.dbzs/artifacts/${jobId ?? "unknown"}/${safeName}`;
    setSaving(true);
    try {
      await window.dbzs?.writeProjectFile?.(filePath, content);
      toast.success("Artefakt geöffnet", filePath.split("/").slice(-3).join("/"));
    } catch (err) {
      toast.error("Artefakt konnte nicht geöffnet werden", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded border border-dbzs-border bg-dbzs-panelSoft p-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-dbzs-text">{name}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded border px-1 py-0.5 text-[10px] uppercase tracking-[0.1em] ${isOutput ? "border-green-400/30 bg-green-400/10 text-green-400" : "border-dbzs-border text-dbzs-muted"}`}>
            {kind}
          </span>
          <button
            className="text-dbzs-muted underline underline-offset-2 hover:text-dbzs-cyan disabled:opacity-40"
            disabled={saving}
            onClick={() => void handleOpenInEditor()}
            title="Artefakt als Datei im Projekt speichern"
            type="button"
          >
            {saving ? "…" : "↗ Editor"}
          </button>
          {truncated && (
            <button
              className="text-dbzs-cyan underline underline-offset-2"
              onClick={() => setExpanded((v) => !v)}
              type="button"
            >
              {expanded ? "Weniger" : "Mehr"}
            </button>
          )}
        </div>
      </div>
      <pre className={`mt-1.5 whitespace-pre-wrap break-words text-dbzs-muted ${expanded ? "max-h-96" : "max-h-16"} overflow-y-auto`}>
        {expanded ? content : (truncated ? `${preview}…` : content)}
      </pre>
    </div>
  );
}

function WaypointTimeline({ events }: { events: Array<{ id?: unknown; waypoint?: unknown; message?: unknown; progress?: number | null; created_at?: unknown }> }) {
  if (events.length === 0) {
    return <p className="rounded border border-dashed border-dbzs-border bg-dbzs-panelSoft p-2 text-[11px] text-dbzs-muted">Keine Waypoints.</p>;
  }
  return (
    <div className="space-y-1">
      {events.map((ev, i) => (
        <div className="flex items-start gap-2 rounded border border-dbzs-border bg-dbzs-panelSoft px-2 py-1.5 text-[11px]" key={String(ev.id ?? i)}>
          <span className="mt-0.5 shrink-0 font-mono text-dbzs-cyan">{String(ev.waypoint ?? "?")}</span>
          <span className="min-w-0 flex-1 text-dbzs-muted">{String(ev.message ?? "")}</span>
          {typeof ev.progress === "number" && <span className="shrink-0 text-dbzs-muted">{ev.progress}%</span>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enqueue form
// ---------------------------------------------------------------------------

type EnqueueSubmitArg = {
  title: string; task_type: string; priority: number;
  assigned_agent_role: string | null; input_payload: Record<string, unknown>;
};

function EnqueueJobForm({ onSubmit, disabled }: { onSubmit: (r: EnqueueSubmitArg) => void; disabled: boolean }) {
  const { templates, saveTemplate, deleteTemplate } = useJobTemplates();
  const workspacePath = useWorkspaceStore((s) => s.state.projectPath);

  const [title, setTitle] = useState("");
  const [taskType, setTaskType] = useState<(typeof TASK_TYPES)[number]>("coding");
  const [priority, setPriority] = useState(5);
  const [role, setRole] = useState<(typeof AGENT_ROLES)[number] | "">("");
  const [prompt, setPrompt] = useState("");
  const [embedFile, setEmbedFile] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [showTemplateSave, setShowTemplateSave] = useState(false);

  // Auto-priority when title or prompt changes
  const updatePriority = (newTitle: string, newPrompt: string) => {
    setPriority(autoPriority(newTitle, newPrompt));
  };

  const handleTitleChange = (v: string) => {
    setTitle(v);
    updatePriority(v, prompt);
  };

  const handlePromptChange = (v: string) => {
    setPrompt(v);
    updatePriority(title, v);
  };

  // Embed active file as context
  const handleEmbedToggle = async (checked: boolean) => {
    setEmbedFile(checked);
    if (!checked) { setActiveFilePath(null); return; }
    if (!workspacePath) return;
    try {
      const result = await window.dbzs.openFileDialog();
      if (result && typeof result === "string") setActiveFilePath(result);
      else if (Array.isArray(result) && result[0]) setActiveFilePath(result[0] as string);
    } catch { setEmbedFile(false); }
  };

  const canSubmit = title.trim().length >= 2;

  const buildPayload = (): Record<string, unknown> => {
    const base: Record<string, unknown> = prompt.trim() ? { prompt: prompt.trim() } : {};
    if (embedFile && activeFilePath) base.file_context_path = activeFilePath;
    return base;
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ title: title.trim(), task_type: taskType, priority, assigned_agent_role: role || null, input_payload: buildPayload() });
    setTitle(""); setPrompt(""); setEmbedFile(false); setActiveFilePath(null); setShowTemplateSave(false);
  };

  const loadTemplate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setTaskType(tpl.task_type as (typeof TASK_TYPES)[number]);
    setRole(tpl.assigned_agent_role as (typeof AGENT_ROLES)[number] | "");
    setPriority(tpl.priority);
    setPrompt(tpl.prompt_template);
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;
    saveTemplate({ name: templateName.trim(), task_type: taskType, assigned_agent_role: role, priority, prompt_template: prompt });
    setTemplateName(""); setShowTemplateSave(false);
  };

  return (
    <div className="space-y-2">
      {/* Template picker */}
      {templates.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            className="flex-1 border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-[11px] text-dbzs-muted"
            defaultValue=""
            onChange={(e) => { if (e.currentTarget.value) loadTemplate(e.currentTarget.value); e.currentTarget.value = ""; }}
          >
            <option value="">Template laden…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button
            className="border border-red-400/30 px-2 py-1 text-[10px] text-red-400 hover:bg-red-400/10"
            onClick={() => { const sel = document.querySelector<HTMLSelectElement>("[data-tpl-sel]"); if (!sel?.value) return; deleteTemplate(sel.value); }}
            title="Ausgewähltes Template löschen"
            type="button"
          >✕</button>
        </div>
      )}

      <input
        className="w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1.5 text-xs text-dbzs-text placeholder:text-dbzs-muted focus:border-dbzs-cyan focus:outline-none"
        onChange={(e) => handleTitleChange(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && canSubmit && !disabled) handleSubmit(); }}
        placeholder="Titel (min. 2 Zeichen) *"
        value={title}
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-dbzs-muted">
          Aufgabentyp
          <select
            className="mt-1 w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text"
            onChange={(e) => setTaskType(e.currentTarget.value as typeof taskType)}
            value={taskType}
          >
            {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-dbzs-muted">
          Agent-Rolle
          <select
            className="mt-1 w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text"
            onChange={(e) => setRole(e.currentTarget.value as typeof role)}
            value={role}
          >
            <option value="">— beliebig —</option>
            {AGENT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-[10px] text-dbzs-muted">
          Priorität
          <input
            className="mt-1 w-16 border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text"
            max={10}
            min={1}
            onChange={(e) => setPriority(Number(e.currentTarget.value))}
            type="number"
            value={priority}
          />
        </label>
        <span className="mt-4 text-[10px] text-dbzs-muted">
          {priority >= 8 ? "🔴 Hoch" : priority <= 3 ? "🔵 Niedrig" : "⚪ Normal"}
        </span>
      </div>

      <textarea
        className="h-16 w-full resize-y border border-dbzs-border bg-dbzs-panelSoft px-2 py-1.5 text-xs text-dbzs-text placeholder:text-dbzs-muted focus:border-dbzs-cyan focus:outline-none"
        onChange={(e) => handlePromptChange(e.currentTarget.value)}
        placeholder="Prompt / Aufgabenbeschreibung (optional)"
        value={prompt}
      />

      {/* File context embed */}
      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-dbzs-muted">
        <input
          checked={embedFile}
          className="accent-dbzs-cyan"
          onChange={(e) => void handleEmbedToggle(e.currentTarget.checked)}
          type="checkbox"
        />
        Datei als Kontext einbetten
        {activeFilePath && <span className="truncate text-[10px] text-dbzs-cyan">{activeFilePath.split(/[\\/]/).slice(-2).join("/")}</span>}
      </label>

      <div className="flex gap-2">
        <button
          className="flex-1 border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1.5 text-xs font-medium text-dbzs-cyan disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || !canSubmit}
          onClick={handleSubmit}
          type="button"
        >
          Job erstellen
        </button>
        <button
          className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1.5 text-[11px] text-dbzs-muted hover:text-dbzs-text"
          onClick={() => setShowTemplateSave((v) => !v)}
          title="Als Template speichern"
          type="button"
        >
          ★
        </button>
      </div>

      {/* Template save form */}
      {showTemplateSave && (
        <div className="flex gap-2">
          <input
            className="flex-1 border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text placeholder:text-dbzs-muted focus:border-dbzs-cyan focus:outline-none"
            onChange={(e) => setTemplateName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveTemplate(); }}
            placeholder="Template-Name…"
            value={templateName}
          />
          <button
            className="border border-green-400/30 bg-green-400/10 px-2 py-1 text-[11px] text-green-400 disabled:opacity-40"
            disabled={!templateName.trim()}
            onClick={handleSaveTemplate}
            type="button"
          >
            Speichern
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function JobMonitorPanel() {
  const workspacePath = useWorkspaceStore((store) => store.state.projectPath);
  const toast = useToastStore();
  const handoffJobContext = useRuntimeChatStore((store) => store.handoffJobContext);
  const selectedAgent = useAgentRegistryStore((store) => store.selectedAgent);
  const { status: runnerStatus, lastResult, isRunning, error: runnerError, runOnce, loadStatus } = useAgentRunnerStore();

  const {
    jobs, selectedJob, selectedJobDetail, selectedJobId, selectedStatus,
    isLoading, isDetailLoading, isMutating, error, sseConnected,
    loadJobs, loadJobDetail, selectJob, setStatusFilter,
    enqueueJob, claimNextJob, addWaypoint, addArtifact, verifySelectedJob, requeueStaleJobs,
    clearAllJobs, pruneFinishedJobs
  } = useJobSpoolerStore();

  const [workerId, setWorkerId] = useState(selectedAgent?.id ?? "coder-local");
  const [supportedRoles, setSupportedRoles] = useState<string[]>(selectedAgent?.role ? [selectedAgent.role] : ["coder"]);
  const [waypoint, setWaypoint] = useState<(typeof WAYPOINT_OPTIONS)[number]>("progress");
  const [waypointMessage, setWaypointMessage] = useState("Update aus dem Worker");
  const [waypointProgress, setWaypointProgress] = useState("50");
  const [artifactKind, setArtifactKind] = useState<(typeof ARTIFACT_KINDS)[number]>("output");
  const [artifactName, setArtifactName] = useState("result.md");
  const [artifactContent, setArtifactContent] = useState("");
  const [verifyVerdict, setVerifyVerdict] = useState<(typeof VERIFY_VERDICTS)[number]>("passed");
  const [verifyReason, setVerifyReason] = useState("Automatische Prüfung abgeschlossen");
  const [rerankerScore, setRerankerScore] = useState("0.92");
  const [artifactFilter, setArtifactFilter] = useState<(typeof ARTIFACT_FILTERS)[number]>("all");
  const [applyingPatchPath, setApplyingPatchPath] = useState<string | null>(null);
  const [patchApplyMessage, setPatchApplyMessage] = useState<string | null>(null);
  const [patchAppliedJobId, setPatchAppliedJobId] = useState<string | null>(null);
  const [gitBranchName, setGitBranchName] = useState("");
  const [gitCommitMsg, setGitCommitMsg] = useState("");
  const [gitFlowMessage, setGitFlowMessage] = useState<string | null>(null);
  const [gitFlowWorking, setGitFlowWorking] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [jobSort, setJobSort] = useState<"priority" | "updated" | "created" | "title">("priority");

  // Refs to avoid stale closures in polling intervals
  const isMutatingRef = useRef(isMutating);
  isMutatingRef.current = isMutating;
  const selectedJobIdRef = useRef(selectedJobId);
  selectedJobIdRef.current = selectedJobId;
  const selectedJobRef = useRef(selectedJob);
  selectedJobRef.current = selectedJob;

  // Initial load
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { void loadJobs(); }, [loadJobs, selectedStatus]);

  // Sync worker ID / roles when agent selection changes
  useEffect(() => {
    if (!selectedAgent?.id) return;
    setWorkerId((cur) => (cur === "coder-local" || cur.trim().length === 0 ? selectedAgent.id : cur));
    setSupportedRoles((cur) =>
      cur.length === 1 && cur[0] === "coder" && selectedAgent.role ? [selectedAgent.role] : cur
    );
  }, [selectedAgent?.id, selectedAgent?.role]);

  // Poll job list every 5s when there are active jobs
  const hasActiveJobs = useMemo(() => jobs.some((j) => ACTIVE_STATUSES.has(j.status)), [jobs]);
  useEffect(() => {
    if (!hasActiveJobs) return;
    const id = window.setInterval(() => {
      if (!isMutatingRef.current) void loadJobs();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [hasActiveJobs, loadJobs]);

  // Poll selected job detail every 5s when it's active
  const selectedJobIsActive = useMemo(
    () => Boolean(selectedJob && ACTIVE_STATUSES.has(selectedJob.status)),
    [selectedJob]
  );
  useEffect(() => {
    if (!selectedJobIsActive) return;
    const id = window.setInterval(() => {
      if (!isMutatingRef.current && selectedJobIdRef.current) {
        void loadJobDetail(selectedJobIdRef.current);
      }
    }, DETAIL_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [selectedJobIsActive, loadJobDetail]);
  // SSE connection for real-time job updates
  useEffect(() => {
    const { connectSse, disconnectSse } = useJobSpoolerStore.getState();
    connectSse();
    return () => {
      disconnectSse();
    };
  }, []);

  // Derived
  const patchProposals = useMemo(() => {
    if (lastResult?.patch_proposals?.length) return lastResult.patch_proposals;
    return parsePatchProposalsFromArtifacts(selectedJobDetail?.artifacts ?? []);
  }, [lastResult?.patch_proposals, selectedJobDetail?.artifacts]);

  const counts = useMemo(
    () => jobs.reduce<Record<string, number>>((acc, j) => { acc[j.status] = (acc[j.status] ?? 0) + 1; return acc; }, {}),
    [jobs]
  );

  const visibleJobs = useMemo(() => {
    const query = jobSearch.trim().toLowerCase();
    return [...jobs]
      .filter((job) => {
        if (!query) {
          return true;
        }
        return [
          job.title,
          job.id,
          job.task_type,
          job.assigned_agent_role ?? "",
          job.assigned_worker ?? "",
          job.error_message ?? ""
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => {
        switch (jobSort) {
          case "title":
            return left.title.localeCompare(right.title);
          case "created":
            return right.created_at.localeCompare(left.created_at);
          case "updated":
            return right.updated_at.localeCompare(left.updated_at);
          case "priority":
          default:
            return right.priority - left.priority || right.created_at.localeCompare(left.created_at);
        }
      });
  }, [jobSearch, jobSort, jobs]);

  const groupedJobs = useMemo(
    () =>
      JOB_BUCKETS.map((bucket) => ({
        ...bucket,
        jobs: visibleJobs.filter((job) => (bucket.statuses as readonly string[]).includes(job.status))
      })),
    [visibleJobs]
  );

  const filteredArtifacts = useMemo(() => {
    const arts = selectedJobDetail?.artifacts ?? [];
    return artifactFilter === "all" ? arts : arts.filter((a) => a.kind === artifactFilter);
  }, [artifactFilter, selectedJobDetail?.artifacts]);

  const selectedJobMaxProgress = useMemo(
    () => (selectedJobDetail ? maxProgress(selectedJobDetail.events) : 0),
    [selectedJobDetail]
  );
  const selectedJobHasPassedVerification = useMemo(
    () => (selectedJobDetail ? hasPassedVerification(selectedJobDetail.verifications) : false),
    [selectedJobDetail]
  );
  const canVerifySelected = useMemo(
    () => Boolean(selectedJob && VERIFYABLE_STATUSES.has(selectedJob.status)),
    [selectedJob]
  );

  const claimRoles = supportedRoles.map((r) => r.trim()).filter(Boolean);
  const workerReady = workerId.trim().length > 0;

  // Quick-action helpers
  const canQuickVerify = (j: JobRecord) => VERIFYABLE_STATUSES.has(j.status);
  const canQuickDone = (j: JobRecord) => {
    if (j.status === "waiting_verification") return true;
    if (j.status !== "running") return false;
    if (!selectedJobDetail || selectedJobDetail.job.id !== j.id) return false;
    return selectedJobHasPassedVerification || selectedJobMaxProgress >= 90;
  };

  // Handlers
  const handleRunOnce = async () => {
    if (!workerReady) return;
    const result = await runOnce({ agent_id: workerId.trim(), workspace_root: workspacePath ?? undefined, supported_roles: claimRoles.length > 0 ? claimRoles : ["coder"] });
    if (result.job_id) await selectJob(result.job_id);
    else await loadJobs();
  };

  const handleApplyPatch = async (filePath: string, proposedContent: string) => {
    if (!workspacePath) { setPatchApplyMessage("Workspace fehlt."); return; }
    const apply = window.dbzs?.applyPatchWithRestorePoint;
    if (!apply) { setPatchApplyMessage("Safe Patch Pipeline nicht verfügbar."); return; }
    setApplyingPatchPath(filePath);
    setPatchApplyMessage(null);
    try {
      await apply(filePath, proposedContent, "before_patch");
      setPatchApplyMessage(`Patch angewendet: ${filePath}`);
      if (selectedJobId) {
        setPatchAppliedJobId(selectedJobId);
        setGitBranchName(`agent/job-${selectedJobId.slice(0, 8)}`);
        setGitCommitMsg(selectedJob?.title ?? `Agent job ${selectedJobId.slice(0, 8)}`);
        setGitFlowMessage(null);
      }
    } catch (err) {
      setPatchApplyMessage(err instanceof Error ? err.message : "Patch fehlgeschlagen.");
    } finally {
      setApplyingPatchPath(null);
    }
  };

  const handleGitBranchAndCommit = async () => {
    if (!workspacePath || !gitBranchName.trim() || !gitCommitMsg.trim()) return;
    const gitBranch = (window.dbzs as unknown as Record<string, unknown>)?.gitCreateBranch as ((root: string, name: string) => Promise<unknown>) | undefined;
    const gitCommit = (window.dbzs as unknown as Record<string, unknown>)?.gitCommit as ((root: string, msg: string, paths: string[]) => Promise<unknown>) | undefined;
    setGitFlowWorking(true);
    setGitFlowMessage(null);
    try {
      if (gitBranch) {
        await gitBranch(workspacePath, gitBranchName.trim());
      }
      if (gitCommit) {
        await gitCommit(workspacePath, gitCommitMsg.trim(), []);
      }
      setGitFlowMessage(`Branch "${gitBranchName.trim()}" erstellt + Commit angelegt.`);
    } catch (err) {
      setGitFlowMessage(err instanceof Error ? err.message : "Git-Operation fehlgeschlagen.");
    } finally {
      setGitFlowWorking(false);
    }
  };

  const handleAddWaypoint = async () => {
    if (!selectedJobId || !workerReady) return;
    const parsed = waypointProgress.trim() ? Number.parseInt(waypointProgress, 10) : undefined;
    await addWaypoint({ worker_id: workerId.trim(), waypoint, message: waypointMessage, progress: Number.isNaN(parsed ?? Number.NaN) ? undefined : parsed, metadata: {} });
  };

  const handleAddArtifact = async () => {
    if (!selectedJobId || !artifactName.trim() || !artifactContent.trim()) return;
    await addArtifact({ worker_id: workerReady ? workerId.trim() : undefined, kind: artifactKind, name: artifactName.trim(), content: artifactContent, metadata: {} });
  };

  const handleVerify = async () => {
    if (!selectedJobId || !workerReady || !canVerifySelected) return;
    const parsed = rerankerScore.trim() ? Number.parseFloat(rerankerScore) : undefined;
    await verifySelectedJob({ worker_id: workerId.trim(), verdict: verifyVerdict, reranker_score: Number.isNaN(parsed ?? Number.NaN) ? undefined : parsed, reason: verifyReason, evidence: {} });
  };

  const quickProgress = async (j: JobRecord) => {
    if (!workerReady || !ACTIVE_STATUSES.has(j.status)) return;
    await addWaypoint({ worker_id: workerId.trim(), waypoint: "progress", message: "In Arbeit", progress: 50, metadata: { source: "quick_action" } }, j.id);
  };

  const quickVerification = async (j: JobRecord) => {
    if (!workerReady || !canQuickVerify(j)) return;
    await addWaypoint({ worker_id: workerId.trim(), waypoint: "waiting_verification", message: "Bereit zur Verifikation", progress: 90, metadata: { source: "quick_action" } }, j.id);
  };

  const quickComplete = async (j: JobRecord) => {
    if (!workerReady || !canQuickDone(j)) return;
    await addWaypoint({ worker_id: workerId.trim(), waypoint: "completed", message: "Abgeschlossen", progress: 100, metadata: { source: "quick_action" } }, j.id);
  };

  const quickLogArtifact = async (j: JobRecord) => {
    await addArtifact({ worker_id: workerReady ? workerId.trim() : undefined, kind: "log", name: `quick-log-${new Date().toISOString()}`, content: "Quick log entry aus JobMonitor.", metadata: { source: "quick_action" } }, j.id);
  };

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4 space-y-3">

      {/* Header */}
      <div className="flex flex-col gap-2 rounded border border-dbzs-border bg-dbzs-bg p-3 shadow-inner">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className={`dbzs-animate-status-ring absolute inline-flex h-full w-full rounded-full ${sseConnected ? "bg-emerald-400" : "bg-red-400"}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${sseConnected ? "bg-emerald-500" : "bg-red-500"}`}></span>
            </span>
            <h3 className="text-sm font-semibold tracking-wide text-dbzs-text">Job Monitor</h3>
            <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border ${sseConnected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
              {sseConnected ? "Live" : "Offline"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="border border-dbzs-border bg-dbzs-panelSoft px-2.5 py-0.5 text-[11px] text-dbzs-muted hover:border-dbzs-cyan hover:text-dbzs-cyan rounded transition"
              disabled={isLoading || isMutating}
              onClick={() => void loadJobs()}
              type="button"
            >
              {isLoading ? "…" : "Refresh"}
            </button>
          </div>
        </div>

        <p className="text-[11px] text-dbzs-muted leading-relaxed">
          Zentrales Cockpit für echte Queue-/Jobzustände. Workflow-Boards, Agent-Registry und Test-Runs bleiben bewusst separat.
        </p>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text"
            onChange={(event) => setJobSearch(event.currentTarget.value)}
            placeholder="Jobs suchen: Titel, ID, Rolle, Worker"
            value={jobSearch}
          />
          <select
            className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text"
            onChange={(event) => setJobSort(event.currentTarget.value as typeof jobSort)}
            value={jobSort}
          >
            <option value="priority">Sortierung: Priorität</option>
            <option value="updated">Sortierung: Update</option>
            <option value="created">Sortierung: Erstellung</option>
            <option value="title">Sortierung: Titel</option>
          </select>
          <div className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-[11px] text-dbzs-muted">
            Retry via echter API nur für stale/requeue vorhanden. Direkter Cancel-Endpunkt für Jobs ist derzeit nicht verfügbar.
          </div>
        </div>

        {/* Live Admin Maintenance Row */}
        <div className="flex items-center justify-between border-t border-dbzs-border/40 pt-2 mt-1 gap-2 text-[10px]">
          <span className="text-dbzs-muted font-medium uppercase tracking-[0.08em]">Aufdräumen / Queue:</span>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10 transition"
              onClick={() => {
                if (confirm("Möchtest du wirklich alle erledigten (completed & failed) Jobs aus dem Verlauf fegen?")) {
                  void pruneFinishedJobs();
                }
              }}
              title="Entfernt alle bereits komplettierten oder fehlgeschlagenen Jobs aus der Datenbank, um die Queue sauber zu halten"
              type="button"
            >
              Fegen (Prune)
            </button>
            <button
              className="px-2 py-0.5 rounded border border-red-500/30 bg-red-500/5 text-red-500 hover:bg-red-500/10 transition font-medium"
              onClick={() => {
                if (confirm("WARNUNG: Möchtest du wirklich die komplette Job-Datenbank unwiderruflich zurücksetzen und alle Jobs löschen?")) {
                  void clearAllJobs();
                }
              }}
              title="Löscht absolut alle Jobs inkl. laufender und blockierter komplett aus der Datenbank"
              type="button"
            >
              Reset All
            </button>
          </div>
        </div>
      </div>

      {/* Status counters */}
      <div className="grid grid-cols-2 gap-1.5 text-[11px] md:grid-cols-4">
        {(["queued", "running", "waiting_verification", "failed"] as const).map((s) => (
          <button
            className={`rounded border px-2 py-1 text-left transition ${selectedStatus === s ? statusBadgeClass(s) : "border-dbzs-border bg-dbzs-bg text-dbzs-muted hover:border-dbzs-cyan"}`}
            key={s}
            onClick={() => setStatusFilter(s)}
            type="button"
          >
            <div className="uppercase tracking-[0.1em]">{statusLabel(s)}</div>
            <div className="text-sm font-bold">{counts[s] ?? 0}</div>
          </button>
        ))}
      </div>

      {/* Enqueue form */}
      <CollapsibleSection title="Job erstellen" defaultOpen={true}>
        <EnqueueJobForm disabled={isMutating} onSubmit={(req) => void enqueueJob(req)} />
      </CollapsibleSection>

      {/* Worker config */}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-dbzs-muted">
          Statusfilter
          <select
            className="mt-1 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
            onChange={(e) => setStatusFilter(e.currentTarget.value as JobStatusFilter)}
            value={selectedStatus}
          >
            {STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label} {f.value !== "all" && counts[f.value] ? `(${counts[f.value]})` : ""}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-dbzs-muted">
          Worker-ID
          <input
            className="mt-1 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
            onChange={(e) => setWorkerId(e.currentTarget.value)}
            value={workerId}
          />
        </label>
      </div>

      {/* Agent Runner */}
      <div className="rounded border border-dbzs-border bg-dbzs-bg p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-dbzs-muted">Agent Runner</h4>
            <p className="mt-0.5 text-[11px] text-dbzs-muted">
              {runnerStatus?.last_message ?? "Claim + LLM + Patches"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40 hover:border-dbzs-cyan hover:text-dbzs-text"
              disabled={isLoading || isMutating}
              onClick={() => void claimNextJob({ worker_id: workerId.trim(), supported_roles: claimRoles })}
              type="button"
            >
              Claimen
            </button>
            <button
              className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
              disabled={isRunning || isMutating || !workerReady}
              onClick={() => void handleRunOnce()}
              type="button"
            >
              {isRunning ? "Läuft…" : "Run once"}
            </button>
          </div>
        </div>
        {runnerError && <p className="mt-2 text-xs text-red-400">{runnerError}</p>}
        {lastResult?.llm_skipped && <p className="mt-1 text-[11px] text-amber-300">LLM übersprungen — Runtime starten für Patch-Vorschläge.</p>}
      </div>

      {/* Patch proposals */}
      {patchProposals.length > 0 && (
        <CollapsibleSection title={`Patch-Vorschläge (${patchProposals.length})`} defaultOpen={true}>
          <ul className="space-y-2">
            {patchProposals.map((patch) => (
              <li className="rounded border border-dbzs-border p-2 text-xs" key={patch.file_path}>
                <div className="font-medium text-dbzs-text">{patch.file_path}</div>
                {patch.summary && <p className="mt-1 text-dbzs-muted">{patch.summary}</p>}
                <button
                  className="mt-2 border border-dbzs-border bg-dbzs-panel px-2 py-1 text-[11px] disabled:opacity-40"
                  disabled={applyingPatchPath === patch.file_path}
                  onClick={() => void handleApplyPatch(patch.file_path, patch.proposed_content)}
                  type="button"
                >
                  {applyingPatchPath === patch.file_path ? "Wird angewendet…" : "Patch anwenden (Restore Point)"}
                </button>
              </li>
            ))}
          </ul>
          {patchApplyMessage && <p className="mt-2 text-[11px] text-dbzs-muted">{patchApplyMessage}</p>}
        </CollapsibleSection>
      )}

      {patchAppliedJobId === selectedJobId && selectedJobId && (
        <CollapsibleSection title="Git-Commit für diesen Job" defaultOpen={true}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] text-dbzs-muted">Branch</span>
              <input
                className="flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text"
                onChange={(e) => setGitBranchName(e.target.value)}
                placeholder="agent/job-…"
                value={gitBranchName}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] text-dbzs-muted">Commit-Msg</span>
              <input
                className="flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text"
                onChange={(e) => setGitCommitMsg(e.target.value)}
                placeholder="Commit-Nachricht"
                value={gitCommitMsg}
              />
            </div>
            <button
              className="w-full border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[11px] text-dbzs-cyan disabled:opacity-40"
              disabled={gitFlowWorking || !gitBranchName.trim() || !gitCommitMsg.trim()}
              onClick={() => void handleGitBranchAndCommit()}
              type="button"
            >
              {gitFlowWorking ? "Wird ausgeführt…" : "Branch erstellen + Commit"}
            </button>
            {gitFlowMessage && <p className="text-[11px] text-dbzs-muted">{gitFlowMessage}</p>}
          </div>
        </CollapsibleSection>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Job list */}
      <div className="space-y-3">
        {visibleJobs.length === 0 ? (
          <div className="rounded border border-dashed border-dbzs-border bg-dbzs-bg p-4 text-center text-xs text-dbzs-muted">
            Keine Jobs — erstelle einen Job oben oder starte einen Agenten.
          </div>
        ) : (
          groupedJobs.map((bucket) =>
            bucket.jobs.length > 0 ? (
              <div className="rounded border border-dbzs-border bg-dbzs-bg" key={bucket.key}>
                <div className="flex items-center justify-between border-b border-dbzs-border px-3 py-2 text-[11px]">
                  <span className="uppercase tracking-[0.12em] text-dbzs-muted">{bucket.title}</span>
                  <span className="text-dbzs-text">{bucket.jobs.length}</span>
                </div>
                <div className="space-y-1 p-2">
                  {bucket.jobs.map((job) => {
                    const isSelected = selectedJobId === job.id;
                    const progressValue = isSelected ? selectedJobMaxProgress : 0;
                    return (
                      <div
                        className={`cursor-pointer rounded border px-3 py-2 text-xs transition ${
                          isSelected
                            ? "border-dbzs-cyan bg-dbzs-cyan/5 text-dbzs-text"
                            : "border-dbzs-border bg-dbzs-panelSoft text-dbzs-muted hover:border-dbzs-border/80 hover:bg-dbzs-panel"
                        }`}
                        key={job.id}
                        onClick={() => void selectJob(job.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void selectJob(job.id); } }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="block truncate font-medium text-dbzs-text">{job.title}</span>
                            <span className="mt-1 block truncate text-[10px] text-dbzs-muted">{job.id}</span>
                          </div>
                          <StatusBadge status={job.status} />
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-dbzs-muted">
                          <span>P{job.priority}</span>
                          <span>{job.attempt_count}/{job.max_attempts} Versuche</span>
                          <span>{job.task_type}</span>
                          {job.assigned_agent_role && <span>{job.assigned_agent_role}</span>}
                          {job.assigned_worker && <span className="truncate max-w-24">{job.assigned_worker}</span>}
                        </div>
                        {isSelected && progressValue > 0 && <ProgressBar value={progressValue} />}
                        {isSelected && ACTIVE_STATUSES.has(job.status) ? (
                          <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                            <div className="flex flex-wrap gap-1">
                              <button className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-0.5 text-[10px] text-dbzs-muted disabled:opacity-40 hover:text-dbzs-text" disabled={isMutating || !workerReady} onClick={() => void quickProgress(job)} title="Fortschritt 50%" type="button">WIP</button>
                              <button className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-0.5 text-[10px] text-dbzs-muted disabled:opacity-40 hover:text-dbzs-text" disabled={isMutating || !workerReady || !canQuickVerify(job)} onClick={() => void quickVerification(job)} title="Zur Verifikation" type="button">Verify</button>
                              <button className="border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400 disabled:opacity-40" disabled={isMutating || !workerReady || !canQuickDone(job)} onClick={() => void quickComplete(job)} title="Abschließen" type="button">Done</button>
                              <button className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-0.5 text-[10px] text-dbzs-muted disabled:opacity-40 hover:text-dbzs-text" disabled={isMutating} onClick={() => void quickLogArtifact(job)} title="Log-Artefakt" type="button">Log</button>
                            </div>
                            {isMutating ? (
                              <p className="text-[10px] text-dbzs-muted">Aktion läuft …</p>
                            ) : null}
                          </div>
                        ) : null}
                        {isSelected && TERMINAL_STATUSES.has(job.status) ? (
                          <p className="mt-2 text-[10px] text-dbzs-muted">
                            Terminaler Jobstatus — Details und Artefakte unten.
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null
          )
        )}
      </div>

      {/* Selected job detail */}
      {selectedJob && (
        <div className="rounded border border-dbzs-border bg-dbzs-bg p-3 space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium text-dbzs-text">{formatJobLabel(selectedJob)}</div>
            <div className="flex items-center gap-2">
              <StatusBadge status={selectedJob.status} />
              {isDetailLoading && <span className="text-[10px] text-dbzs-muted">Lade…</span>}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <DetailItem label="Worker" value={selectedJob.assigned_worker ?? "-"} />
            <DetailItem label="Erstellt" value={formatTs(selectedJob.created_at)} />
            <DetailItem label="Aktualisiert" value={formatTs(selectedJob.updated_at)} />
            <DetailItem label="Lease bis" value={formatTs(selectedJob.lease_expires_at)} />
            <DetailItem label="Abgeschlossen" value={formatTs(selectedJob.completed_at)} />
            <DetailItem label="ID" value={selectedJob.id} />
          </dl>

          <TrajectoryMiniPanel jobId={selectedJobId} />

          <button
            className="mt-2 w-full border border-dbzs-border px-2 py-1 text-[10px] text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-cyan"
            onClick={() => void openPlatformDiagnosticsWindow()}
            type="button"
          >
            Plattform-Diagnose öffnen (IPC · Sync · Trajectory)
          </button>

          <button
            className="w-full border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-2 py-1 text-[11px] text-dbzs-cyan disabled:opacity-40"
            disabled={!workspacePath}
            onClick={() => {
              if (!workspacePath) {
                return;
              }
              const artifactSummary = selectedJobDetail?.artifacts
                ?.slice(0, 4)
                .map((artifact) => `- ${artifact.kind}: ${artifact.name}`)
                .join("\n");
              handoffJobContext({
                jobId: selectedJob.id,
                title: selectedJob.title,
                workspaceRoot: workspacePath,
                description:
                  typeof selectedJob.input_payload?.description === "string"
                    ? selectedJob.input_payload.description
                    : null,
                artifactSummary: artifactSummary ?? null
              });
              toast.success("Runtime Chat", "Job-Kontext übergeben — nächste Chat-Nachricht nutzt ihn.");
            }}
            type="button"
          >
            Im Runtime Chat fortsetzen
          </button>

          {selectedJobDetail && (
            <div className="space-y-2">

              {/* Output artifacts — most important, shown first */}
              {filteredArtifacts.filter((a) => a.kind === "output").length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-green-400">Artifacts · Output</div>
                  <div className="space-y-1">
                    {filteredArtifacts.filter((a) => a.kind === "output").map((a) => (
                      <ExpandableArtifact key={a.id} name={a.name} kind={a.kind} content={a.content} jobId={selectedJob.id} />
                    ))}
                  </div>
                </div>
              )}

              {/* Waypoint timeline */}
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-dbzs-muted">Job-Verlauf</div>
                <WaypointTimeline events={selectedJobDetail.events} />
              </div>

              {/* All artifacts with filter */}
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-dbzs-muted">Alle Artefakte ({filteredArtifacts.length})</div>
                  <select
                    className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-0.5 text-[10px] text-dbzs-text"
                    onChange={(e) => setArtifactFilter(e.currentTarget.value as typeof artifactFilter)}
                    value={artifactFilter}
                  >
                    {ARTIFACT_FILTERS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  {filteredArtifacts.length === 0 ? (
                    <p className="rounded border border-dashed border-dbzs-border bg-dbzs-panelSoft p-2 text-[11px] text-dbzs-muted">Keine Artefakte.</p>
                  ) : (
                    filteredArtifacts.map((a) => <ExpandableArtifact key={a.id} name={a.name} kind={a.kind} content={a.content} jobId={selectedJob.id} />)
                  )}
                </div>
              </div>

              {/* Input / Output payloads */}
              {selectedJobDetail.job.input_payload && Object.keys(selectedJobDetail.job.input_payload).length > 0 && (
                <CollapsibleSection title="Input Payload">
                  <pre className="whitespace-pre-wrap break-words text-[11px] text-dbzs-text">{formatJson(selectedJobDetail.job.input_payload)}</pre>
                </CollapsibleSection>
              )}
              {selectedJobDetail.job.output_payload && (
                <CollapsibleSection title="Output Payload">
                  <pre className="whitespace-pre-wrap break-words text-[11px] text-dbzs-text">{formatJson(selectedJobDetail.job.output_payload)}</pre>
                </CollapsibleSection>
              )}
              {selectedJobDetail.job.error_message && (
                <div className="rounded border border-red-400/40 bg-red-400/10 p-2 text-[11px] text-red-400">
                  {selectedJobDetail.job.error_message}
                </div>
              )}

              {/* Developer tools — collapsed by default */}
              <CollapsibleSection title="Entwickler-Werkzeuge">
                <div className="space-y-4">
                  {/* Waypoint */}
                  <div>
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-dbzs-muted">Waypoint senden</div>
                    <div className="grid grid-cols-2 gap-2">
                      <select className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text" onChange={(e) => setWaypoint(e.currentTarget.value as typeof waypoint)} value={waypoint}>
                        {WAYPOINT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <input className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text" onChange={(e) => setWaypointProgress(e.currentTarget.value)} placeholder="Progress 0-100" value={waypointProgress} />
                    </div>
                    <input className="mt-1 w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text" onChange={(e) => setWaypointMessage(e.currentTarget.value)} placeholder="Nachricht" value={waypointMessage} />
                    <button className="mt-1 w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text disabled:opacity-40" disabled={isMutating || !selectedJobId || !workerReady} onClick={() => void handleAddWaypoint()} type="button">Waypoint senden</button>
                  </div>

                  {/* Artifact */}
                  <div>
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-dbzs-muted">Artefakt speichern</div>
                    <div className="grid grid-cols-2 gap-2">
                      <select className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text" onChange={(e) => setArtifactKind(e.currentTarget.value as typeof artifactKind)} value={artifactKind}>
                        {ARTIFACT_KINDS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <input className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text" onChange={(e) => setArtifactName(e.currentTarget.value)} placeholder="Dateiname" value={artifactName} />
                    </div>
                    <textarea className="mt-1 h-16 w-full resize-y border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text" onChange={(e) => setArtifactContent(e.currentTarget.value)} placeholder="Inhalt" value={artifactContent} />
                    <button className="mt-1 w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text disabled:opacity-40" disabled={isMutating || !selectedJobId || !artifactName.trim() || !artifactContent.trim()} onClick={() => void handleAddArtifact()} type="button">Artefakt speichern</button>
                  </div>

                  {/* Verify */}
                  <div>
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-dbzs-muted">Verifikation</div>
                    <div className="grid grid-cols-2 gap-2">
                      <select className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text" onChange={(e) => setVerifyVerdict(e.currentTarget.value as typeof verifyVerdict)} value={verifyVerdict}>
                        {VERIFY_VERDICTS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <input className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text" onChange={(e) => setRerankerScore(e.currentTarget.value)} placeholder="Reranker Score" value={rerankerScore} />
                    </div>
                    <input className="mt-1 w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text" onChange={(e) => setVerifyReason(e.currentTarget.value)} placeholder="Begründung" value={verifyReason} />
                    <button
                      className="mt-1 w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-text disabled:opacity-40"
                      disabled={isMutating || !selectedJobId || !workerReady || !canVerifySelected}
                      onClick={() => void handleVerify()}
                      title={canVerifySelected ? undefined : "Nur bei running/waiting_verification möglich"}
                      type="button"
                    >
                      Verifikation senden
                    </button>
                  </div>

                  {/* Requeue */}
                  <button className="w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40 hover:text-dbzs-text" disabled={isLoading || isMutating} onClick={() => void requeueStaleJobs()} type="button">Stale Jobs requeuen</button>
                </div>
              </CollapsibleSection>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
