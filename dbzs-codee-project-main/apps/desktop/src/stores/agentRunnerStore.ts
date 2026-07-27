import type { AgentRunnerPatchProposal, AgentRunOnceRequest, AgentRunResult, AgentRunnerStatus } from "@dbzs/shared";
import { create } from "zustand";
import { backendClient } from "../services/backendClient";

interface AgentRunnerState {
  status: AgentRunnerStatus | null;
  lastResult: AgentRunResult | null;
  isRunning: boolean;
  error: string | null;
  loadStatus: () => Promise<void>;
  runOnce: (request: AgentRunOnceRequest) => Promise<AgentRunResult>;
  clearError: () => void;
}

export function parsePatchProposalsFromArtifacts(
  artifacts: Array<{ name: string; content: string }>
): AgentRunnerPatchProposal[] {
  const artifact = artifacts.find((entry) => entry.name === "patch_proposals.json");
  if (!artifact) {
    return [];
  }

  try {
    const parsed = JSON.parse(artifact.content) as { patches?: AgentRunnerPatchProposal[] };
    if (!Array.isArray(parsed.patches)) {
      return [];
    }
    return parsed.patches.filter(
      (patch) =>
        typeof patch.file_path === "string" &&
        patch.file_path.length > 0 &&
        typeof patch.proposed_content === "string" &&
        patch.proposed_content.length > 0
    );
  } catch {
    return [];
  }
}

export const useAgentRunnerStore = create<AgentRunnerState>((set) => ({
  status: null,
  lastResult: null,
  isRunning: false,
  error: null,
  loadStatus: async () => {
    try {
      const status = await backendClient.getAgentRunnerStatus();
      set({ status, error: null });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Agent-Runner-Status konnte nicht geladen werden"
      });
    }
  },
  runOnce: async (request) => {
    set({ isRunning: true, error: null });
    try {
      const result = await backendClient.runAgentOnce(request);
      set({
        lastResult: result,
        isRunning: false,
        status: {
          state: result.state,
          agent_id: result.agent_id,
          last_job_id: result.job_id ?? null,
          last_message: result.message,
          last_run_at: new Date().toISOString()
        }
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent Run once fehlgeschlagen";
      set({ error: message, isRunning: false });
      throw error;
    }
  },
  clearError: () => set({ error: null })
}));
