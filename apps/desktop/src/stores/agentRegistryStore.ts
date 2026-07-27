import { create } from "zustand";
import type { AgentCreateRequest, AgentLogEntry, AgentRecord, AgentUpdateRequest } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

interface AgentRegistryState {
  agents: AgentRecord[];
  logs: AgentLogEntry[];
  selectedAgentId: string | null;
  isLoading: boolean;
  isMutating: boolean;
  isLoadingLogs: boolean;
  error: string | null;
  selectedAgent: AgentRecord | null;
  loadAgents: () => Promise<void>;
  loadSelectedAgentLogs: (limit?: number) => Promise<void>;
  selectAgent: (agentId: string | null) => void;
  createAgent: (request: AgentCreateRequest) => Promise<void>;
  updateAgent: (request: AgentUpdateRequest) => Promise<void>;
  startSelectedAgent: () => Promise<void>;
  stopSelectedAgent: () => Promise<void>;
  deleteSelectedAgent: () => Promise<void>;
  setSelectedAgentEnabled: (enabled: boolean) => Promise<void>;
}

function deriveSelectedAgent(agents: AgentRecord[], selectedAgentId: string | null): AgentRecord | null {
  return selectedAgentId ? agents.find((agent) => agent.id === selectedAgentId) ?? null : null;
}

function upsertAgent(agents: AgentRecord[], nextAgent: AgentRecord): AgentRecord[] {
  const index = agents.findIndex((agent) => agent.id === nextAgent.id);
  if (index === -1) {
    return [...agents, nextAgent].sort((left, right) => left.name.localeCompare(right.name));
  }

  const copy = [...agents];
  copy[index] = nextAgent;
  return copy;
}

export const useAgentRegistryStore = create<AgentRegistryState>((set, get) => ({
  agents: [],
  logs: [],
  selectedAgentId: null,
  isLoading: false,
  isMutating: false,
  isLoadingLogs: false,
  error: null,
  selectedAgent: null,
  loadAgents: async () => {
    set({ isLoading: true, error: null });
    try {
      const agents = await backendClient.listAgents();
      const selectedAgentId = get().selectedAgentId ?? agents[0]?.id ?? null;
      set({
        agents,
        selectedAgentId,
        selectedAgent: deriveSelectedAgent(agents, selectedAgentId),
        isLoading: false
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Agent-Registry konnte nicht geladen werden",
        isLoading: false
      });
    }
  },
  loadSelectedAgentLogs: async (limit = 100) => {
    const selected = get().selectedAgent;
    if (!selected) {
      set({ logs: [] });
      return;
    }

    set({ isLoadingLogs: true, error: null });
    try {
      const logs = await backendClient.listAgentLogs(selected.id, limit);
      set({ logs, isLoadingLogs: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Agent-Logs konnten nicht geladen werden",
        isLoadingLogs: false
      });
    }
  },
  selectAgent: (agentId) => {
    const agents = get().agents;
    set({ selectedAgentId: agentId, selectedAgent: deriveSelectedAgent(agents, agentId), logs: [] });
  },
  createAgent: async (request) => {
    set({ isMutating: true, error: null });
    try {
      const created = await backendClient.createAgent(request);
      const agents = upsertAgent(get().agents, created);
      set({
        agents,
        selectedAgentId: created.id,
        selectedAgent: created,
        isMutating: false
      });
      await get().loadSelectedAgentLogs();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Agent konnte nicht erstellt werden",
        isMutating: false
      });
    }
  },
  updateAgent: async (request) => {
    const selected = get().selectedAgent;
    if (!selected) {
      return;
    }

    set({ isMutating: true, error: null });
    try {
      const updated = await backendClient.updateAgent(selected.id, request);
      const agents = upsertAgent(get().agents, updated);
      set({
        agents,
        selectedAgentId: updated.id,
        selectedAgent: updated,
        isMutating: false
      });
      await get().loadSelectedAgentLogs();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Agent konnte nicht aktualisiert werden",
        isMutating: false
      });
    }
  },
  startSelectedAgent: async () => {
    const selected = get().selectedAgent;
    if (!selected) {
      return;
    }

    set({ isMutating: true, error: null });
    try {
      const running = await backendClient.startAgent(selected.id);
      const agents = upsertAgent(get().agents, running);
      set({
        agents,
        selectedAgentId: running.id,
        selectedAgent: running,
        isMutating: false
      });
      await get().loadSelectedAgentLogs();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Agent konnte nicht gestartet werden",
        isMutating: false
      });
    }
  },
  stopSelectedAgent: async () => {
    const selected = get().selectedAgent;
    if (!selected) {
      return;
    }

    set({ isMutating: true, error: null });
    try {
      const stopped = await backendClient.stopAgent(selected.id);
      const agents = upsertAgent(get().agents, stopped);
      set({
        agents,
        selectedAgentId: stopped.id,
        selectedAgent: stopped,
        isMutating: false
      });
      await get().loadSelectedAgentLogs();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Agent konnte nicht gestoppt werden",
        isMutating: false
      });
    }
  },
  deleteSelectedAgent: async () => {
    const selected = get().selectedAgent;
    if (!selected) {
      return;
    }

    set({ isMutating: true, error: null });
    try {
      await backendClient.deleteAgent(selected.id);
      const agents = get().agents.filter((agent) => agent.id !== selected.id);
      const selectedAgentId = agents[0]?.id ?? null;
      set({
        agents,
        selectedAgentId,
        selectedAgent: deriveSelectedAgent(agents, selectedAgentId),
        logs: [],
        isMutating: false
      });
      await get().loadSelectedAgentLogs();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Agent konnte nicht geloescht werden",
        isMutating: false
      });
    }
  },
  setSelectedAgentEnabled: async (enabled) => {
    await get().updateAgent({ enabled });
  }
}));
