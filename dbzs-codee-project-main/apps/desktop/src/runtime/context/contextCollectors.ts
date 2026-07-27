import type { ContextCollector, ContextSignal } from "@/runtime/context/contextContracts";
import { isContextPathAllowed } from "@dbzs/shared";
import { useEditorStore } from "@/stores/editorStore";
import { useGitStore } from "@/stores/gitStore";
import { useTestAgentStore } from "@/stores/testAgentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

function truncate(value: string, max = 4000): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

export class ActiveFileCollector implements ContextCollector {
  readonly id = "active-file";

  async collect(): Promise<ContextSignal[]> {
    const activeTab = useEditorStore.getState().activeTab;
    if (!activeTab || !isContextPathAllowed(activeTab.path)) {
      return [];
    }

    return [
      {
        source: "active_file",
        key: activeTab.path,
        value: truncate(activeTab.content),
        metadata: {
          language: activeTab.language,
          dirty: activeTab.isDirty
        }
      }
    ];
  }
}

export class OpenTabsCollector implements ContextCollector {
  readonly id = "open-tabs";

  async collect(): Promise<ContextSignal[]> {
    const tabs = useEditorStore.getState().tabs;
    return tabs.filter((tab) => isContextPathAllowed(tab.path)).slice(0, 12).map((tab) => ({
      source: "open_tabs",
      key: tab.path,
      value: `${tab.name} (${tab.language})`
    }));
  }
}

export class DiagnosticsCollector implements ContextCollector {
  readonly id = "diagnostics";

  async collect(): Promise<ContextSignal[]> {
    const run = useTestAgentStore.getState().currentRun;
    if (!run) {
      return [];
    }

    return [
      {
        source: "diagnostics",
        key: run.runId,
        value: `${run.label} => ${run.status} (exit=${run.exitCode ?? "-"})`
      }
    ];
  }
}

export class GitDiffCollector implements ContextCollector {
  readonly id = "git-diff";

  async collect(): Promise<ContextSignal[]> {
    const gitStore = useGitStore.getState();
    const signals: ContextSignal[] = [];

    if (gitStore.selectedDiff) {
      signals.push({
        source: "git_diff",
        key: gitStore.selectedFilePath ?? "full",
        value: truncate(gitStore.selectedDiff, 6000)
      });
    }

    if (gitStore.repositoryStatus) {
      signals.push({
        source: "git_diff",
        key: "repo-status",
        value: JSON.stringify({
          branch: gitStore.repositoryStatus.currentBranch,
          ahead: gitStore.repositoryStatus.aheadCount,
          behind: gitStore.repositoryStatus.behindCount,
          changedFiles: gitStore.changedEntries.length
        })
      });
    }

    return signals;
  }
}

export class WorkspaceStructureCollector implements ContextCollector {
  readonly id = "workspace-structure";

  async collect(): Promise<ContextSignal[]> {
    const files = useWorkspaceStore.getState().files;
    return files.filter((entry) => isContextPathAllowed(entry.relativePath)).slice(0, 24).map((entry) => ({
      source: "workspace",
      key: entry.relativePath,
      value: `${entry.name}:${entry.language}`
    }));
  }
}
