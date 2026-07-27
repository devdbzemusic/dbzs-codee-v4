import { useEffect } from "react";
import type { AppMenuAction } from "@/types/appMenu";
import { useEditorStore } from "@/stores/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

function isAppMenuAction(value: string): value is AppMenuAction {
  return [
    "new-project",
    "open-project",
    "new-file",
    "new-folder",
    "open-file",
    "save-file",
    "save-file-as",
    "save-workspace"
  ].includes(value);
}

export function useAppMenuActions(): void {
  useEffect(() => {
    const subscribe = window.dbzs.onMenuAction;
    if (!subscribe) {
      return;
    }

    const handleAction = (action: string) => {
      if (!isAppMenuAction(action)) {
        return;
      }

      const workspace = useWorkspaceStore.getState();
      const editor = useEditorStore.getState();

      switch (action) {
        case "new-project":
          void workspace.createProject();
          return;
        case "open-project":
          void workspace.openProjectDirectory();
          return;
        case "new-file":
          void workspace.createNewFile();
          return;
        case "new-folder":
          void workspace.createNewFolder();
          return;
        case "open-file":
          void editor.openFile();
          return;
        case "save-file":
          void editor.saveActiveFile();
          return;
        case "save-file-as":
          void editor.saveActiveFileAs();
          return;
        case "save-workspace":
          void workspace.saveWorkspace();
          return;
      }
    };

    return subscribe(handleAction);
  }, []);
}

export function runAppMenuAction(action: AppMenuAction): void {
  const workspace = useWorkspaceStore.getState();
  const editor = useEditorStore.getState();

  switch (action) {
    case "new-project":
      void workspace.createProject();
      return;
    case "open-project":
      void workspace.openProjectDirectory();
      return;
    case "new-file":
      void workspace.createNewFile();
      return;
    case "new-folder":
      void workspace.createNewFolder();
      return;
    case "open-file":
      void editor.openFile();
      return;
    case "save-file":
      void editor.saveActiveFile();
      return;
    case "save-file-as":
      void editor.saveActiveFileAs();
      return;
    case "save-workspace":
      void workspace.saveWorkspace();
      return;
  }
}
