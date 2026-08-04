import { create } from "zustand";
import type { TaskBoardItem, TaskStatus } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

interface TaskBoardState {
  tasks: TaskBoardItem[];
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  loadTasks: () => Promise<void>;
  createTask: (title: string, description: string) => Promise<void>;
  moveTask: (taskId: string, status: TaskStatus) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  linkJob: (taskId: string, jobId: string) => Promise<void>;
  unlinkJob: (taskId: string, jobId: string) => Promise<void>;
}

function upsertTask(tasks: TaskBoardItem[], next: TaskBoardItem): TaskBoardItem[] {
  const index = tasks.findIndex((task) => task.id === next.id);
  if (index === -1) {
    return [next, ...tasks];
  }

  const copy = [...tasks];
  copy[index] = next;
  return copy;
}

export const useTaskBoardStore = create<TaskBoardState>((set, get) => ({
  tasks: [],
  isLoading: false,
  isMutating: false,
  error: null,
  loadTasks: async () => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await backendClient.listTasks();
      set({ tasks, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Task Board konnte nicht geladen werden",
        isLoading: false
      });
    }
  },
  createTask: async (title, description) => {
    set({ isMutating: true, error: null });
    try {
      const task = await backendClient.createTask({ title, description, priority: 3 });
      set({ tasks: upsertTask(get().tasks, task), isMutating: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Task konnte nicht erstellt werden",
        isMutating: false
      });
    }
  },
  moveTask: async (taskId, status) => {
    set({ isMutating: true, error: null });
    try {
      const task = await backendClient.updateTask(taskId, { status });
      set({ tasks: upsertTask(get().tasks, task), isMutating: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Task konnte nicht verschoben werden",
        isMutating: false
      });
    }
  },
  deleteTask: async (taskId) => {
    set({ isMutating: true, error: null });
    try {
      await backendClient.deleteTask(taskId);
      set({ tasks: get().tasks.filter((task) => task.id !== taskId), isMutating: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Task konnte nicht geloescht werden",
        isMutating: false
      });
    }
  },
  linkJob: async (taskId, jobId) => {
    set({ isMutating: true, error: null });
    try {
      const task = await backendClient.linkJobToTask(taskId, jobId);
      set({ tasks: upsertTask(get().tasks, task), isMutating: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Job konnte nicht verknuepft werden",
        isMutating: false
      });
    }
  },
  unlinkJob: async (taskId, jobId) => {
    set({ isMutating: true, error: null });
    try {
      const task = await backendClient.unlinkJobFromTask(taskId, jobId);
      set({ tasks: upsertTask(get().tasks, task), isMutating: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Job-Verknuepfung konnte nicht entfernt werden",
        isMutating: false
      });
    }
  }
}));
