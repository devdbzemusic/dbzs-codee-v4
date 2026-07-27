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
  "jobs",
  "agent-workbench",
  "editor"
];

export type OperationsNotebookProps = {
  missionControl: ReactNode;
  cdee: ReactNode;
  runtime: ReactNode;
  jobs: ReactNode;
  agentWorkbench: ReactNode;
  editor: ReactNode;
  editorTabHasFiles?: boolean;
};

export function OperationsNotebook({
  missionControl,
  cdee,
  runtime,
  jobs,
  agentWorkbench,
  editor,
  editorTabHasFiles = false
}: OperationsNotebookProps) {
  const activeTab = useNotebookStore((state) => state.activeTab);
  const setActiveTab = useNotebookStore((state) => state.setActiveTab);

  const tabContent: Record<NotebookTabId, ReactNode> = {
    "mission-control": missionControl,
    cdee,
    runtime,
    jobs,
    "agent-workbench": agentWorkbench,
    editor
  };

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
              {showDirty ? <span className="ml-1 text-dbzs-amber">*</span> : null}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{tabContent[activeTab]}</div>
    </section>
  );
}
