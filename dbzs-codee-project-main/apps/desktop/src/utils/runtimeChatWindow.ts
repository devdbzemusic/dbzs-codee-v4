import { backendClient } from "@/services/backendClient";
import type { FileEditorTab } from "@/stores/editorStore";
import type { WorkspaceFile } from "@dbzs/shared";

export function toRuntimeChatContextFile(tab: FileEditorTab | null): WorkspaceFile | null {
  if (!tab) {
    return null;
  }

  return {
    path: tab.path,
    name: tab.name,
    language: tab.language,
    content: tab.content.slice(0, 16_000)
  };
}

export async function openRuntimeChatWindow(): Promise<void> {
  await backendClient.openRuntimeChatWindow();
}

export async function closeRuntimeChatWindow(): Promise<void> {
  await backendClient.closeRuntimeChatWindow();
}

export async function focusRuntimeChatWindow(): Promise<void> {
  await openRuntimeChatWindow();
}
