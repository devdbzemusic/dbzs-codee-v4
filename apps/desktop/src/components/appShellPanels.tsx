import { useEffect, useState } from "react";
import type {
  AgentCreateRequest,
  AgentHealthInfo,
  AgentLogEntry,
  AgentRecord,
  AgentUpdateRequest,
  AllowedCommand,
  CommandRunLogs,
  CommandRunStatus,
  KnownIssue,
  MemoryTask,
  ProjectMemory,
  ProposedChange,
  WorkspaceProjectFile
} from "@dbzs/shared";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { backendClient } from "@/services/backendClient";
import { SettingsNotebook } from "@/settings";

export function TestAgentPanel({
  allowedCommands,
  currentRun,
  error,
  logs,
  onRunCommand,
  onRunRecommended,
  onStop,
  stage,
  summary
}: {
  allowedCommands: AllowedCommand[];
  currentRun: CommandRunStatus | null;
  error: string | null;
  logs: CommandRunLogs | null;
  onRunCommand: (commandId: string) => void;
  onRunRecommended: () => void;
  onStop: () => void;
  stage: "idle" | "running" | "completed";
  summary: string;
}) {
  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Test Agent</h3>
        <button
          className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
          disabled={stage === "running"}
          onClick={onRunRecommended}
          type="button"
        >
          Empfohlene Checks
        </button>
      </div>

      <div className="mt-3 text-[11px] text-dbzs-muted">
        Status: {currentRun ? currentRun.status : stage}
        {currentRun ? ` - ${currentRun.label}` : ""}
        {currentRun && currentRun.exitCode !== null ? ` - exit ${currentRun.exitCode}` : ""}
      </div>

      <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
        {allowedCommands.map((command) => (
          <button
            className="w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-left text-xs text-dbzs-text disabled:opacity-40"
            disabled={stage === "running"}
            key={command.id}
            onClick={() => onRunCommand(command.id)}
            type="button"
          >
            {command.label}
          </button>
        ))}
      </div>

      <button
        className="mt-2 w-full border border-dbzs-red/40 bg-dbzs-red/10 px-2 py-1 text-xs text-dbzs-red disabled:opacity-40"
        disabled={!currentRun || currentRun.status !== "running"}
        onClick={onStop}
        type="button"
      >
        Stoppen
      </button>

      {summary ? <p className="mt-2 text-[11px] text-dbzs-muted">{summary}</p> : null}
      {error ? <p className="mt-2 text-xs text-dbzs-red">{error}</p> : null}

      <div className="mt-2 space-y-1">
        <p className="text-[11px] uppercase tracking-wide text-dbzs-muted">stdout</p>
        <pre className="max-h-24 overflow-y-auto border border-dbzs-border bg-dbzs-bg p-2 text-[11px] text-dbzs-muted">
          {logs?.stdout || "-"}
        </pre>
        <p className="text-[11px] uppercase tracking-wide text-dbzs-muted">stderr</p>
        <pre className="max-h-24 overflow-y-auto border border-dbzs-border bg-dbzs-bg p-2 text-[11px] text-dbzs-muted">
          {logs?.stderr || "-"}
        </pre>
      </div>
    </section>
  );
}

export function AgentRegistryPanel({
  agents,
  createAgent,
  pendingProposedChanges,
  isLoading,
  isLoadingLogs,
  isMutating,
  logs,
  onApplyProposedChange,
  onShowProposedDiff,
  onRejectProposedChange,
  deleteSelectedAgent,
  loadSelectedAgentLogs,
  onRefresh,
  onSelect,
  selectedAgent,
  selectedAgentId,
  setSelectedAgentEnabled,
  startSelectedAgent,
  stopSelectedAgent,
  updateAgent
}: {
  agents: AgentRecord[];
  createAgent: (request: AgentCreateRequest) => Promise<void>;
  pendingProposedChanges: ProposedChange[];
  isLoading: boolean;
  isLoadingLogs: boolean;
  isMutating: boolean;
  logs: AgentLogEntry[];
  onApplyProposedChange: (filePath: string) => void;
  onShowProposedDiff: (filePath: string) => void;
  onRejectProposedChange: (proposedChangeId: string) => void;
  deleteSelectedAgent: () => Promise<void>;
  loadSelectedAgentLogs: (limit?: number) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelect: (agentId: string | null) => void;
  selectedAgent: AgentRecord | null;
  selectedAgentId: string | null;
  setSelectedAgentEnabled: (enabled: boolean) => Promise<void>;
  startSelectedAgent: () => Promise<void>;
  stopSelectedAgent: () => Promise<void>;
  updateAgent: (request: AgentUpdateRequest) => Promise<void>;
}) {
  const [agentHealth, setAgentHealth] = useState<AgentHealthInfo | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("node");
  const [newArgs, setNewArgs] = useState("--version");
  const [newCwd, setNewCwd] = useState("");
  const [agentContextMenu, setAgentContextMenu] = useState<{ x: number; y: number; agentId: string | null } | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCommand, setEditCommand] = useState("");
  const [editArgs, setEditArgs] = useState("");
  const [editCwd, setEditCwd] = useState("");

  useEffect(() => {
    if (!selectedAgent) {
      setEditName("");
      setEditDescription("");
      setEditCommand("");
      setEditArgs("");
      setEditCwd("");
      return;
    }

    setEditName(selectedAgent.name);
    setEditDescription(selectedAgent.description);
    setEditCommand(selectedAgent.command);
    setEditArgs(selectedAgent.args.join(" "));
    setEditCwd(selectedAgent.cwd ?? "");
  }, [selectedAgent]);

  useEffect(() => {
    void loadSelectedAgentLogs();
    setAgentHealth(null);
  }, [loadSelectedAgentLogs, selectedAgentId]);

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Agent Registry</h3>
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40"
          disabled={isLoading || isMutating}
          onClick={() => void onRefresh()}
          type="button"
        >
          Aktualisieren
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <input aria-label="Neue Agent-ID" className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setNewId(event.currentTarget.value)} placeholder="agent-id" value={newId} />
        <input aria-label="Neuer Agent-Name" className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setNewName(event.currentTarget.value)} placeholder="Name" value={newName} />
        <input aria-label="Neuer Agent-Befehl" className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setNewCommand(event.currentTarget.value)} placeholder="command" value={newCommand} />
        <input aria-label="Neue Agent-Argumente" className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setNewArgs(event.currentTarget.value)} placeholder="args" value={newArgs} />
      </div>
      <input aria-label="Neues Agent-Arbeitsverzeichnis" className="mt-2 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setNewCwd(event.currentTarget.value)} placeholder="cwd (optional)" value={newCwd} />
      <button
        className="mt-2 w-full border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-2 text-xs font-medium text-dbzs-cyan disabled:opacity-40"
        disabled={isMutating || newId.trim().length < 2 || newName.trim().length < 2 || newCommand.trim().length === 0}
        onClick={() => {
          const args = newArgs.split(" ").map((value) => value.trim()).filter(Boolean);
          void createAgent({
            id: newId.trim(),
            name: newName.trim(),
            role: "coder",
            description: "",
            command: newCommand.trim(),
            args,
            cwd: newCwd.trim() ? newCwd.trim() : null,
            enabled: true
          });
        }}
        type="button"
      >
        Agent anlegen
      </button>

      <div className="mt-3 max-h-40 space-y-1 overflow-y-auto">
        {agents.length === 0 ? (
          <p className="text-xs text-dbzs-muted">Noch keine Agenten registriert.</p>
        ) : (
          agents.map((agent) => (
            <button
              className={`w-full border px-2 py-2 text-left text-xs ${selectedAgentId === agent.id ? "border-dbzs-cyan/60 bg-dbzs-cyan/10 text-dbzs-text" : "border-dbzs-border bg-dbzs-bg text-dbzs-muted"}`}
              key={agent.id}
              onClick={() => onSelect(agent.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setAgentContextMenu({ x: event.clientX, y: event.clientY, agentId: agent.id });
              }}
              type="button"
            >
              <div className="truncate font-medium">{agent.name}</div>
              <div className="mt-1 flex justify-between gap-2 text-[11px]">
                <span>{agent.role}</span>
                <span>{agent.status.state}</span>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="mt-3 space-y-1 border border-dbzs-border bg-dbzs-bg p-2">
        <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Offene Vorschlaege</div>
        {pendingProposedChanges.length === 0 ? (
          <p className="text-[11px] text-dbzs-muted">Keine offenen Agent-Vorschlaege.</p>
        ) : (
          pendingProposedChanges.map((change) => (
            <div className="space-y-1 border border-dbzs-border bg-dbzs-panel p-2" key={change.id}>
              <div className="truncate text-[11px] font-medium text-dbzs-text">{change.filePath}</div>
              <div className="text-[11px] text-dbzs-muted">Agent: {change.agentId}</div>
              <div className="line-clamp-2 text-[11px] text-dbzs-muted">Grund: {change.reason}</div>
              <div className="grid grid-cols-3 gap-1">
                <button className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text" onClick={() => onShowProposedDiff(change.filePath)} type="button">Diff anzeigen</button>
                <button className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[11px] text-dbzs-cyan" onClick={() => onApplyProposedChange(change.filePath)} type="button">Anwenden</button>
                <button className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text" onClick={() => onRejectProposedChange(change.id)} type="button">Verwerfen</button>
              </div>
            </div>
          ))
        )}
      </div>

      {agentContextMenu && (
        <ContextMenu
          items={(() => {
            const target = agents.find((agent) => agent.id === agentContextMenu.agentId);
            if (!target) return [];
            const isRunning = target.status.state === "running";
            return [
              { label: isRunning ? "Stoppen" : "Starten", action: () => { if (isRunning) { void stopSelectedAgent(); } else { void startSelectedAgent(); } } },
              { label: "Logs laden", action: () => { void loadSelectedAgentLogs(); } },
              { label: target.enabled ? "Deaktivieren" : "Aktivieren", action: () => { void setSelectedAgentEnabled(!target.enabled); } },
              null,
              { label: "Loeschen", action: () => { void deleteSelectedAgent(); }, danger: true }
            ];
          })()}
          onClose={() => setAgentContextMenu(null)}
          x={agentContextMenu.x}
          y={agentContextMenu.y}
        />
      )}

      {selectedAgent ? (
        <div className="mt-3 space-y-2 border border-dbzs-border bg-dbzs-bg p-2">
          <input aria-label="Agent-Name" className="w-full border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setEditName(event.currentTarget.value)} value={editName} />
          <input aria-label="Agent-Beschreibung" className="w-full border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setEditDescription(event.currentTarget.value)} placeholder="Beschreibung" value={editDescription} />
          <input aria-label="Agent-Befehl" className="w-full border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setEditCommand(event.currentTarget.value)} value={editCommand} />
          <input aria-label="Agent-Argumente" className="w-full border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setEditArgs(event.currentTarget.value)} value={editArgs} />
          <input aria-label="Agent-Arbeitsverzeichnis" className="w-full border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setEditCwd(event.currentTarget.value)} placeholder="cwd" value={editCwd} />
          <label className="flex items-center justify-between gap-3 text-xs text-dbzs-muted">
            Aktiviert
            <input checked={selectedAgent.enabled} className="h-4 w-4 accent-dbzs-cyan" disabled={isMutating} onChange={(event) => { void setSelectedAgentEnabled(event.currentTarget.checked); }} type="checkbox" />
          </label>
          <div className="grid grid-cols-4 gap-2">
            <button className="border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40" disabled={isMutating} onClick={() => { const args = editArgs.split(" ").map((value) => value.trim()).filter(Boolean); void updateAgent({ name: editName.trim(), description: editDescription, command: editCommand.trim(), args, cwd: editCwd.trim() ? editCwd.trim() : null }); }} type="button">Speichern</button>
            <button className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40" disabled={isMutating || !selectedAgent.enabled || selectedAgent.status.state === "running"} onClick={() => void startSelectedAgent()} type="button">Start</button>
            <button className="border border-dbzs-border bg-dbzs-panel px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40" disabled={isMutating || selectedAgent.status.state !== "running"} onClick={() => void stopSelectedAgent()} type="button">Stop</button>
            <button className="border border-dbzs-red/40 bg-dbzs-red/10 px-2 py-1 text-xs text-dbzs-red disabled:opacity-40" disabled={isMutating} onClick={() => void deleteSelectedAgent()} type="button">Loeschen</button>
          </div>
          <p className="text-[11px] text-dbzs-muted">
            Status: {selectedAgent.status.state}
            {selectedAgent.status.pid ? ` (pid ${selectedAgent.status.pid})` : ""}
            {selectedAgent.status.message ? ` - ${selectedAgent.status.message}` : ""}
          </p>

          <div className="space-y-1 border border-dbzs-border bg-dbzs-panel p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wide text-dbzs-muted">Health</span>
              <button className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-muted disabled:opacity-40" disabled={healthLoading} onClick={() => {
                setHealthLoading(true);
                backendClient.getAgentHealth(selectedAgent.id).then((h) => setAgentHealth(h)).catch(() => setAgentHealth(null)).finally(() => setHealthLoading(false));
              }} type="button">
                Laden
              </button>
            </div>
            {agentHealth ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-dbzs-muted">
                <span>PID</span><span className="text-dbzs-text">{agentHealth.pid ?? "-"}</span>
                <span>State</span><span className="text-dbzs-text">{agentHealth.state}</span>
                <span>Uptime</span><span className="text-dbzs-text">{agentHealth.uptime_seconds != null ? `${Math.floor(agentHealth.uptime_seconds)}s` : "-"}</span>
                <span>Fehler/1h</span><span className="text-dbzs-text">{agentHealth.error_count_1h}</span>
                {agentHealth.last_log ? <span className="col-span-2 truncate text-dbzs-muted/80">{agentHealth.last_log}</span> : null}
              </div>
            ) : (
              <p className="text-[11px] text-dbzs-muted">{healthLoading ? "Laedt..." : "Noch nicht geladen."}</p>
            )}
          </div>

          <div className="space-y-1 border border-dbzs-border bg-dbzs-panel p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wide text-dbzs-muted">Logs</span>
              <button className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-muted disabled:opacity-40" disabled={isLoadingLogs || isMutating} onClick={() => void loadSelectedAgentLogs()} type="button">
                Refresh
              </button>
            </div>
            <div className="max-h-28 space-y-1 overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-[11px] text-dbzs-muted">Keine Logs vorhanden.</p>
              ) : (
                logs.map((entry) => (
                  <div className="text-[11px] leading-5 text-dbzs-muted" key={entry.id}>
                    <span className="text-dbzs-text">[{entry.level}]</span> {entry.message}
                    <span className="ml-1 text-dbzs-muted/80">({new Date(entry.created_at).toLocaleTimeString()})</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ProjectMemoryPanel({
  error,
  isLoading,
  isMutating,
  memory,
  onAddKnownIssue,
  onAddRecentTask,
  onMarkImportantFile,
  onRefresh
}: {
  error: string | null;
  isLoading: boolean;
  isMutating: boolean;
  memory: ProjectMemory | null;
  onAddKnownIssue: (issue: KnownIssue) => Promise<void>;
  onAddRecentTask: (task: MemoryTask) => Promise<void>;
  onMarkImportantFile: (path: string, reason: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [importantFilePath, setImportantFilePath] = useState("");
  const [importantFileReason, setImportantFileReason] = useState("");
  const [issueTitle, setIssueTitle] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueSeverity, setIssueSeverity] = useState<KnownIssue["severity"]>("medium");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskSummary, setTaskSummary] = useState("");
  const [taskFiles, setTaskFiles] = useState("");

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Project Memory</h3>
        <button className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40" disabled={isLoading || isMutating} onClick={() => void onRefresh()} type="button">Refresh</button>
      </div>

      <div className="mt-3 space-y-2 text-[11px] text-dbzs-muted">
        <div>Projekt: {memory?.projectName ?? "-"}</div>
        <div>Frameworks: {memory?.frameworks.join(", ") || "keine erkannt"}</div>
        <div>Sprachen: {memory?.languages.join(", ") || "keine erkannt"}</div>
        <div>Zuletzt aktualisiert: {memory?.updatedAt ? new Date(memory.updatedAt).toLocaleString("de-DE") : "-"}</div>
      </div>

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Architektur</div>
        <div className="mt-1 space-y-1">
          {(memory?.architectureNotes ?? []).map((note) => (
            <p className="border border-dbzs-border bg-dbzs-bg p-2 text-[11px] text-dbzs-muted" key={note}>{note}</p>
          ))}
          {(memory?.architectureNotes.length ?? 0) === 0 ? <p className="text-[11px] text-dbzs-muted">Noch keine Notizen.</p> : null}
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Wichtige Dateien</div>
        <div className="mt-1 max-h-24 space-y-1 overflow-y-auto">
          {(memory?.importantFiles ?? []).map((file) => (
            <div className="border border-dbzs-border bg-dbzs-bg p-2" key={`${file.path}:${file.reason}`}>
              <div className="truncate text-[11px] text-dbzs-text">{file.path}</div>
              <div className="text-[11px] text-dbzs-muted">{file.reason}</div>
            </div>
          ))}
          {(memory?.importantFiles.length ?? 0) === 0 ? <p className="text-[11px] text-dbzs-muted">Noch keine markierten Dateien.</p> : null}
        </div>
        <input aria-label="Important file path" className="mt-2 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setImportantFilePath(event.currentTarget.value)} placeholder="apps/desktop/src/App.tsx" value={importantFilePath} />
        <input aria-label="Important file reason" className="mt-2 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setImportantFileReason(event.currentTarget.value)} placeholder="Warum ist die Datei wichtig?" value={importantFileReason} />
        <button className="mt-2 w-full border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40" disabled={isMutating || importantFilePath.trim().length === 0} onClick={() => { void onMarkImportantFile(importantFilePath.trim(), importantFileReason.trim()); setImportantFilePath(""); setImportantFileReason(""); }} type="button">Datei markieren</button>
      </div>

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Letzte Tasks</div>
        <div className="mt-1 max-h-24 space-y-1 overflow-y-auto">
          {(memory?.recentTasks ?? []).map((task) => (
            <div className="border border-dbzs-border bg-dbzs-bg p-2" key={task.id}>
              <div className="text-[11px] text-dbzs-text">{task.title}</div>
              <div className="line-clamp-2 text-[11px] text-dbzs-muted">{task.summary}</div>
            </div>
          ))}
          {(memory?.recentTasks.length ?? 0) === 0 ? <p className="text-[11px] text-dbzs-muted">Noch keine Task-Historie.</p> : null}
        </div>
        <input aria-label="Recent task title" className="mt-2 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setTaskTitle(event.currentTarget.value)} placeholder="Task Titel" value={taskTitle} />
        <textarea aria-label="Recent task summary" className="mt-2 h-16 w-full resize-none border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setTaskSummary(event.currentTarget.value)} placeholder="Kurzfassung" value={taskSummary} />
        <input aria-label="Recent task files" className="mt-2 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setTaskFiles(event.currentTarget.value)} placeholder="Dateien (kommagetrennt)" value={taskFiles} />
        <button className="mt-2 w-full border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40" disabled={isMutating || taskTitle.trim().length === 0 || taskSummary.trim().length === 0} onClick={() => { const affectedFiles = taskFiles.split(",").map((entry) => entry.trim()).filter(Boolean); void onAddRecentTask({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: taskTitle.trim(), summary: taskSummary.trim(), affectedFiles, createdAt: new Date().toISOString() }); setTaskTitle(""); setTaskSummary(""); setTaskFiles(""); }} type="button">Task speichern</button>
      </div>

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-dbzs-muted">Bekannte Probleme</div>
        <div className="mt-1 max-h-24 space-y-1 overflow-y-auto">
          {(memory?.knownIssues ?? []).map((issue) => (
            <div className="border border-dbzs-border bg-dbzs-bg p-2" key={issue.id}>
              <div className="text-[11px] text-dbzs-text">{issue.title} - {issue.severity}</div>
              <div className="line-clamp-2 text-[11px] text-dbzs-muted">{issue.description}</div>
            </div>
          ))}
          {(memory?.knownIssues.length ?? 0) === 0 ? <p className="text-[11px] text-dbzs-muted">Keine bekannten Probleme gespeichert.</p> : null}
        </div>
        <input aria-label="Known issue title" className="mt-2 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setIssueTitle(event.currentTarget.value)} placeholder="Issue Titel" value={issueTitle} />
        <textarea aria-label="Known issue description" className="mt-2 h-16 w-full resize-none border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setIssueDescription(event.currentTarget.value)} placeholder="Issue Beschreibung" value={issueDescription} />
        <select aria-label="Known issue severity" className="mt-2 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setIssueSeverity(event.currentTarget.value as KnownIssue["severity"])} value={issueSeverity}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
        <button className="mt-2 w-full border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40" disabled={isMutating || issueTitle.trim().length === 0 || issueDescription.trim().length === 0} onClick={() => { void onAddKnownIssue({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: issueTitle.trim(), description: issueDescription.trim(), severity: issueSeverity }); setIssueTitle(""); setIssueDescription(""); setIssueSeverity("medium"); }} type="button">Issue speichern</button>
      </div>

      {error ? <p className="mt-2 text-xs text-dbzs-red">{error}</p> : null}
    </section>
  );
}

export function DocsAnalysisPanel({
  error,
  isLoading,
  markdown,
  onAnalyze,
  onGenerate,
  setWorkspaceRoot,
  summary,
  workspaceRoot
}: {
  error: string | null;
  isLoading: boolean;
  markdown: string;
  onAnalyze: () => Promise<void>;
  onGenerate: () => Promise<void>;
  setWorkspaceRoot: (workspaceRoot: string) => void;
  summary: { files_scanned: number; directories_scanned: number; todo_count: number } | null;
  workspaceRoot: string;
}) {
  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <h3 className="text-sm font-medium">Docs + Analyse</h3>
      <input aria-label="Workspace root" className="mt-3 w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setWorkspaceRoot(event.currentTarget.value)} placeholder="Workspace root" value={workspaceRoot} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40" disabled={isLoading} onClick={() => void onAnalyze()} type="button">Analysieren</button>
        <button className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40" disabled={isLoading} onClick={() => void onGenerate()} type="button">Docs generieren</button>
      </div>
      {summary ? <div className="mt-2 text-[11px] text-dbzs-muted">files: {summary.files_scanned} - dirs: {summary.directories_scanned} - todo: {summary.todo_count}</div> : null}
      {error ? <p className="mt-2 text-xs text-dbzs-red">{error}</p> : null}
      {markdown ? <div className="mt-2 max-h-28 overflow-y-auto border border-dbzs-border bg-dbzs-bg p-2 text-[11px] whitespace-pre-wrap text-dbzs-muted">{markdown}</div> : null}
    </section>
  );
}

export function RuntimeChatDetachedPlaceholder({ onFocus }: { onFocus: () => void }) {
  return (
    <section className="border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-dbzs-text">Runtime Chat abgespalten</h3>
          <p className="mt-1 text-xs leading-5 text-dbzs-muted">
            Der Chat laeuft im eigenen Fenster. Nachrichten bleiben synchronisiert.
          </p>
        </div>
        <button className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan" onClick={onFocus} type="button">
          Fenster fokussieren
        </button>
      </div>
    </section>
  );
}

export function SettingsPanel({ compact = true }: { compact?: boolean }) {
  return <SettingsNotebook compact={compact} />;
}

export function WorkspaceFileRow({
  file,
  onOpen
}: {
  file: WorkspaceProjectFile;
  onOpen: (filePath: string) => void;
}) {
  return (
    <button
      className="w-full border border-dbzs-border bg-dbzs-panelSoft px-2 py-1.5 text-left text-xs text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-text"
      onClick={() => onOpen(file.path)}
      type="button"
    >
      {file.relativePath}
    </button>
  );
}
