import type { ReactNode } from "react";
import {
  NOTEBOOK_TAB_LABELS,
  type NotebookTabId,
  useNotebookStore
} from "@/stores/notebookStore";

const TAB_ORDER: NotebookTabId[] = [
  "mission-control",
  "cdee",
  "runtime",
  "model-lab",
  "jobs",
  "agent-workbench",
  "editor"
];

export type OperationsNotebookProps = {
  missionControl: ReactNode;
  cdee: ReactNode;
  runtime: ReactNode;
  modelLab: ReactNode;
  jobs: ReactNode;
  agentWorkbench: ReactNode;
  editor: ReactNode;
  editorTabHasFiles?: boolean;
};

export function OperationsNotebook({
  missionControl,
  cdee,
  runtime,
  modelLab,
  jobs,
  agentWorkbench,
  editor,
  editorTabHasFiles = false
}: OperationsNotebookProps) {
  const activeTab = useNotebookStore((state) => state.activeTab);
  const setActiveTab = useNotebookStore((state) => state.setActiveTab);
  const splitChatEditor = useNotebookStore((state) => state.splitChatEditor);
  const toggleSplitChatEditor = useNotebookStore((state) => state.toggleSplitChatEditor);

  const tabContent: Record<NotebookTabId, ReactNode> = {
    "mission-control": missionControl,
    cdee,
    runtime,
    "model-lab": modelLab,
    jobs,
    "agent-workbench": agentWorkbench,
    editor
  };

  const showSplitPane = splitChatEditor && (activeTab === "cdee" || activeTab === "editor");

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#091017]">
      <div
        className="flex h-10 shrink-0 items-end gap-0 overflow-x-auto border-b border-dbzs-border bg-dbzs-panel px-2"
        role="tablist"
      >
        {TAB_ORDER.map((tabId) => {
          const isActive = activeTab === tabId;
          const showDirty = tabId === "editor" && editorTabHasFiles;
          return (
            <button
              aria-selected={isActive}
              className={`relative shrink-0 border px-4 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? "border-dbzs-cyan/60 border-b-transparent bg-[#091017] text-dbzs-cyan"
                  : "border-transparent border-b-dbzs-border bg-transparent text-dbzs-muted hover:text-dbzs-text"
              }`}
              key={tabId}
              onClick={() => setActiveTab(tabId)}
              role="tab"
              type="button"
            >
              {NOTEBOOK_TAB_LABELS[tabId]}
              {showDirty ? (
                <span aria-label="Ungespeicherte Änderungen" className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-dbzs-amber align-middle" />
              ) : null}
              {showDirty ? <span className="sr-only">Ungespeicherte Änderungen</span> : null}
            </button>
          );
        })}
        <button
          aria-pressed={splitChatEditor}
          className={`ml-auto flex shrink-0 items-center gap-1 self-center rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
            splitChatEditor
              ? "border-dbzs-cyan/60 bg-dbzs-cyan/10 text-dbzs-cyan"
              : "border-dbzs-border bg-transparent text-dbzs-muted hover:text-dbzs-text"
          }`}
          onClick={toggleSplitChatEditor}
          title="Chat und Editor nebeneinander anzeigen (Layoutmodus: Chat + Editor)"
          type="button"
        >
          <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <rect height="16" rx="1.5" width="18" x="3" y="4" />
            <path d="M12 4v16" strokeLinecap="round" />
          </svg>
          Split
        </button>
      </div>
      {showSplitPane ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden border-r border-dbzs-border">{tabContent.cdee}</div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{tabContent.editor}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{tabContent[activeTab]}</div>
      )}
    </section>
  );
}
