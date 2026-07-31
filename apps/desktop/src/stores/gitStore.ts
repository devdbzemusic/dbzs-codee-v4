import { create } from "zustand";
import type {
  CommitAssistantContext,
  CommitMessageSuggestion,
  CommitRequest,
  GitCommitSuggestion,
  GitDiffSummary,
  GitRepositoryStatus,
  GitStatusEntry,
  RestorePoint
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { gitTelemetryService } from "@/services/gitTelemetryService";
import { useEditorStore } from "@/stores/editorStore";
import { useReviewStatusStore } from "@/stores/reviewStatusStore";
import { useTestAgentStore } from "@/stores/testAgentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

interface GitStoreState {
  repositoryStatus: GitRepositoryStatus | null;
  currentBranch: string;
  changedEntries: GitStatusEntry[];
  diffSummary: GitDiffSummary[];
  selectedFilePath: string | null;
  selectedDiff: string;
  commitSuggestion: GitCommitSuggestion | null;
  commitSuggestions: CommitMessageSuggestion[];
  selectedCommitSuggestionId: string | null;
  draftCommitTitle: string;
  draftCommitBody: string;
  selectedCommitFiles: string[];
  commitWarnings: string[];
  lastCommitHash: string | null;
  isCommitting: boolean;
  restorePoints: RestorePoint[];
  isRestorePointsLoading: boolean;
  restorePointsError: string | null;
  restorePointsRepairStatus: string | null;
  busyRestorePointId: string | null;
  isLoading: boolean;
  error: string | null;
  refreshGitStatus: () => Promise<void>;
  selectDiffFile: (filePath: string | null) => Promise<void>;
  generateCommitSuggestions: () => Promise<void>;
  selectCommitSuggestion: (suggestionId: string) => void;
  setDraftCommitTitle: (value: string) => void;
  setDraftCommitBody: (value: string) => void;
  toggleCommitFile: (filePath: string) => void;
  selectAllCommitFiles: () => void;
  createCommit: () => Promise<void>;
  refreshRestorePoints: () => Promise<void>;
  createManualRestorePoint: () => Promise<void>;
  restoreFromPoint: (restorePointId: string) => Promise<void>;
  deleteRestorePoint: (restorePointId: string) => Promise<void>;
  cleanupRestorePoints: () => Promise<void>;
  repairRestorePointIndex: () => Promise<void>;
}

function requireProjectPath(): string {
  const projectPath = useWorkspaceStore.getState().state.projectPath;
  if (!projectPath) {
    throw new Error("Kein Workspace aktiv.");
  }
  return projectPath;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildCommitWarnings(
  changedEntries: GitStatusEntry[],
  diffSummary: GitDiffSummary[],
  repositoryStatus: GitRepositoryStatus | null
): string[] {
  const warnings: string[] = [];

  const currentRun = useTestAgentStore.getState().currentRun;
  if (currentRun && (currentRun.status === "failed" || (typeof currentRun.exitCode === "number" && currentRun.exitCode > 0))) {
    warnings.push("Tests sind fehlgeschlagen. Commit ist moeglich, aber riskant.");
  }

  if (useReviewStatusStore.getState().hasErrors) {
    warnings.push("Review enthaelt Errors. Vor Commit bitte Findings pruefen.");
  }

  const hasVeryLargeDiff = diffSummary.some((entry) => entry.additions + entry.deletions >= 300);
  if (hasVeryLargeDiff) {
    warnings.push("Sehr grosser Diff erkannt. Kleinere Commits reduzieren Risiko.");
  }

  if (changedEntries.length >= 20) {
    warnings.push("Viele geaenderte Dateien erkannt. Bitte Commit-Scope eingrenzen.");
  }

  if (changedEntries.some((entry) => entry.status === "untracked")) {
    warnings.push("Untracked Dateien vorhanden. Nur gewuenschte Dateien auswaehlen.");
  }

  if ((repositoryStatus?.behindCount ?? 0) > 0) {
    warnings.push("Branch ist hinter Upstream. Vor Commit ggf. zuerst synchronisieren.");
  }

  return warnings;
}

function buildCommitContext(): CommitAssistantContext {
  const testStore = useTestAgentStore.getState();
  const reviewStore = useReviewStatusStore.getState();
  const editorStore = useEditorStore.getState();
  const appliedChanges = Object.values(editorStore.proposedChanges).filter((change) => change.status === "applied");

  return {
    agentRuns: [...testStore.history, ...(testStore.currentRun ? [testStore.currentRun] : [])],
    appliedChanges,
    reviewReports: reviewStore.latestReport ? [reviewStore.latestReport] : [],
    testResults: [...testStore.history, ...(testStore.currentRun ? [testStore.currentRun] : [])]
  };
}

export const useGitStore = create<GitStoreState>((set, get) => ({
  repositoryStatus: null,
  currentBranch: "",
  changedEntries: [],
  diffSummary: [],
  selectedFilePath: null,
  selectedDiff: "",
  commitSuggestion: null,
  commitSuggestions: [],
  selectedCommitSuggestionId: null,
  draftCommitTitle: "",
  draftCommitBody: "",
  selectedCommitFiles: [],
  commitWarnings: [],
  lastCommitHash: null,
  isCommitting: false,
  restorePoints: [],
  isRestorePointsLoading: false,
  restorePointsError: null,
  restorePointsRepairStatus: null,
  busyRestorePointId: null,
  isLoading: false,
  error: null,
  refreshGitStatus: async () => {
    set({ isLoading: true, error: null });

    try {
      const workspaceRoot = requireProjectPath();
      const [repositoryStatus, diffSummary, commitSuggestion] = await Promise.all([
        backendClient.getGitRepositoryStatus(workspaceRoot),
        backendClient.getGitDiffSummary(workspaceRoot),
        backendClient.getGitCommitSuggestion(workspaceRoot)
      ]);

      const nextSelectedFilePath = get().selectedFilePath ?? diffSummary[0]?.filePath ?? null;
      let selectedDiff = "";
      if (nextSelectedFilePath) {
        selectedDiff = await backendClient.getGitDiff(workspaceRoot, nextSelectedFilePath);
      }

      const changedPaths = repositoryStatus.entries.map((entry) => entry.filePath);
      const preservedSelectedFiles = get().selectedCommitFiles.filter((filePath) => changedPaths.includes(filePath));
      const selectedCommitFiles = preservedSelectedFiles.length > 0 ? preservedSelectedFiles : changedPaths;
      const commitWarnings = buildCommitWarnings(repositoryStatus.entries, diffSummary, repositoryStatus);

      set({
        repositoryStatus,
        currentBranch: repositoryStatus.currentBranch ?? "",
        changedEntries: repositoryStatus.entries,
        diffSummary,
        selectedFilePath: nextSelectedFilePath,
        selectedDiff,
        commitSuggestion,
        selectedCommitFiles,
        commitWarnings,
        isLoading: false,
        error: null
      });

      void gitTelemetryService.increment(workspaceRoot, "refresh_status");

      await get().refreshRestorePoints();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Git-Status konnte nicht geladen werden.",
        isLoading: false
      });
    }
  },
  selectDiffFile: async (filePath) => {
    try {
      const workspaceRoot = requireProjectPath();
      if (!filePath) {
        const fullDiff = await backendClient.getGitDiff(workspaceRoot);
        set({ selectedFilePath: null, selectedDiff: fullDiff, error: null });
        void gitTelemetryService.increment(workspaceRoot, "select_diff_full");
        return;
      }

      const diff = await backendClient.getGitDiff(workspaceRoot, filePath);
      set({ selectedFilePath: filePath, selectedDiff: diff, error: null });
      void gitTelemetryService.increment(workspaceRoot, "select_diff_file");
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Diff konnte nicht geladen werden."
      });
    }
  },
  generateCommitSuggestions: async () => {
    try {
      const workspaceRoot = requireProjectPath();
      const suggestions = await backendClient.suggestCommitMessages(workspaceRoot, buildCommitContext());
      const selectedCommitSuggestionId = suggestions[0]?.id ?? null;
      const draftCommitTitle = suggestions[0]?.title ?? "";
      const draftCommitBody = suggestions[0]?.body ?? "";
      set({
        commitSuggestions: suggestions,
        selectedCommitSuggestionId,
        draftCommitTitle,
        draftCommitBody,
        error: null
      });
      void gitTelemetryService.increment(workspaceRoot, "generate_commit_suggestions");
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Commit-Vorschlaege konnten nicht erzeugt werden."
      });
    }
  },
  selectCommitSuggestion: (suggestionId) => {
    const suggestion = get().commitSuggestions.find((entry) => entry.id === suggestionId);
    if (!suggestion) {
      return;
    }

    set({
      selectedCommitSuggestionId: suggestion.id,
      draftCommitTitle: suggestion.title,
      draftCommitBody: suggestion.body ?? ""
    });
  },
  setDraftCommitTitle: (value) => {
    set({ draftCommitTitle: value });
  },
  setDraftCommitBody: (value) => {
    set({ draftCommitBody: value });
  },
  toggleCommitFile: (filePath) => {
    const selected = new Set(get().selectedCommitFiles);
    if (selected.has(filePath)) {
      selected.delete(filePath);
    } else {
      selected.add(filePath);
    }
    set({ selectedCommitFiles: [...selected] });
  },
  selectAllCommitFiles: () => {
    set({
      selectedCommitFiles: unique(get().changedEntries.map((entry) => entry.filePath))
    });
  },
  createCommit: async () => {
    const workspaceRoot = requireProjectPath();
    const state = get();

    if (!state.repositoryStatus?.isRepository) {
      set({ error: "Workspace ist kein Git-Repository." });
      return;
    }

    if (state.selectedCommitFiles.length === 0) {
      set({ error: "Bitte mindestens eine Datei fuer den Commit auswaehlen." });
      return;
    }

    const trimmedTitle = state.draftCommitTitle.trim();
    if (!trimmedTitle) {
      set({ error: "Commit-Titel darf nicht leer sein." });
      return;
    }

    const approve = typeof window.confirm === "function"
      ? window.confirm("Commit jetzt erstellen? Dieser Schritt erstellt nur einen lokalen Commit.")
      : true;
    if (!approve) {
      return;
    }

    const fallbackSuggestion: CommitMessageSuggestion = {
      id: state.selectedCommitSuggestionId ?? `manual-${Date.now().toString(36)}`,
      title: trimmedTitle,
      body: state.draftCommitBody.trim() || undefined,
      type: "chore",
      scope: undefined,
      affectedFiles: state.selectedCommitFiles,
      riskLevel: "medium",
      createdAt: new Date().toISOString()
    };
    const selectedSuggestion = state.commitSuggestions.find((entry) => entry.id === state.selectedCommitSuggestionId);
    const message = selectedSuggestion
      ? {
          ...selectedSuggestion,
          title: trimmedTitle,
          body: state.draftCommitBody.trim() || undefined,
          affectedFiles: state.selectedCommitFiles
        }
      : fallbackSuggestion;

    const request: CommitRequest = {
      message,
      includeFiles: state.selectedCommitFiles
    };

    set({ isCommitting: true, error: null, lastCommitHash: null });
    try {
      await backendClient.validateCommitRequest(workspaceRoot, request);
      const result = await backendClient.createCommit(workspaceRoot, request);
      if (!result.success) {
        set({
          isCommitting: false,
          error: result.error ?? "Commit fehlgeschlagen."
        });
        return;
      }

      set({
        isCommitting: false,
        error: null,
        lastCommitHash: result.commitHash ?? null
      });
      void gitTelemetryService.increment(workspaceRoot, "create_commit");
      await get().refreshGitStatus();
      await get().generateCommitSuggestions();
    } catch (error) {
      set({
        isCommitting: false,
        error: error instanceof Error ? error.message : "Commit fehlgeschlagen."
      });
    }
  },
  refreshRestorePoints: async () => {
    set({ isRestorePointsLoading: true, restorePointsError: null });
    try {
      const workspaceRoot = requireProjectPath();
      const points = await backendClient.listRestorePoints(workspaceRoot);
      set({
        restorePoints: points,
        isRestorePointsLoading: false,
        restorePointsError: null
      });
    } catch (error) {
      set({
        isRestorePointsLoading: false,
        restorePointsError: error instanceof Error ? error.message : "Restore Points konnten nicht geladen werden."
      });
    }
  },
  createManualRestorePoint: async () => {
    try {
      const workspaceRoot = requireProjectPath();
      const state = get();
      const filePaths = state.selectedCommitFiles.length > 0
        ? state.selectedCommitFiles
        : state.changedEntries.map((entry) => entry.filePath);
      const uniquePaths = unique(filePaths);
      if (uniquePaths.length === 0) {
        set({ restorePointsError: "Keine Dateien fuer manuellen Restore Point gefunden." });
        return;
      }

      await backendClient.createRestorePoint(
        workspaceRoot,
        uniquePaths,
        "manual",
        `Manual checkpoint (${uniquePaths.length} files)`
      );
      void gitTelemetryService.increment(workspaceRoot, "create_restore_point");
      await get().refreshRestorePoints();
    } catch (error) {
      set({
        restorePointsError: error instanceof Error ? error.message : "Restore Point konnte nicht erstellt werden."
      });
    }
  },
  restoreFromPoint: async (restorePointId) => {
    set({ busyRestorePointId: restorePointId, restorePointsError: null });
    try {
      const workspaceRoot = requireProjectPath();
      const result = await backendClient.restorePoint(workspaceRoot, restorePointId);
      if (!result.success && result.errors.length > 0) {
        set({
          busyRestorePointId: null,
          restorePointsError: `Restore mit Fehlern: ${result.errors.join(" | ")}`
        });
      } else {
        set({ busyRestorePointId: null, restorePointsError: null });
      }

      void gitTelemetryService.increment(workspaceRoot, "restore_from_point");

      await get().refreshGitStatus();
      await get().generateCommitSuggestions();
      await get().refreshRestorePoints();
    } catch (error) {
      set({
        busyRestorePointId: null,
        restorePointsError: error instanceof Error ? error.message : "Restore fehlgeschlagen."
      });
    }
  },
  deleteRestorePoint: async (restorePointId) => {
    set({ busyRestorePointId: restorePointId, restorePointsError: null });
    try {
      const workspaceRoot = requireProjectPath();
      await backendClient.deleteRestorePoint(workspaceRoot, restorePointId);
      void gitTelemetryService.increment(workspaceRoot, "delete_restore_point");
      set({ busyRestorePointId: null });
      await get().refreshRestorePoints();
    } catch (error) {
      set({
        busyRestorePointId: null,
        restorePointsError: error instanceof Error ? error.message : "Restore Point konnte nicht geloescht werden."
      });
    }
  },
  cleanupRestorePoints: async () => {
    set({ restorePointsError: null });
    try {
      const workspaceRoot = requireProjectPath();
      await backendClient.cleanupRestorePoints(workspaceRoot);
      void gitTelemetryService.increment(workspaceRoot, "cleanup_restore_points");
      await get().refreshRestorePoints();
    } catch (error) {
      set({
        restorePointsError: error instanceof Error ? error.message : "Cleanup der Restore Points fehlgeschlagen."
      });
    }
  },
  repairRestorePointIndex: async () => {
    set({ restorePointsError: null, restorePointsRepairStatus: "Repariere Index..." });
    try {
      const workspaceRoot = requireProjectPath();
      const result = await backendClient.repairRestorePointIndex(workspaceRoot);
      set({
        restorePointsRepairStatus:
          result.recovered > 0 || result.corrupted.length > 0
            ? `${result.recovered} Restore Point(s) wiederhergestellt` +
              (result.corrupted.length > 0 ? `, ${result.corrupted.length} defekte Datei(en) uebersprungen.` : ".")
            : "Index war bereits konsistent."
      });
      await get().refreshRestorePoints();
    } catch (error) {
      set({
        restorePointsRepairStatus: null,
        restorePointsError: error instanceof Error ? error.message : "Index-Reparatur fehlgeschlagen."
      });
    }
  }
}));
