/*
 * DBZS - Division By Zeros
 * Datei: workspaceExplorerCommands.ts
 * Bereich: Desktop Services / Workspace Explorer
 *
 * Zweck:
 *   Definiert die interne Command-Registry fuer das Explorer-Kontextmenue.
 *
 * Warum:
 *   Aktionen sollen einheitliche Metadaten fuer Zieltyp, Workspace-Bedarf,
 *   Disabled-State und Gefahr erhalten, statt inline im React-Renderpfad zu wachsen.
 *
 * Wozu:
 *   Bereitet den spaeteren Ausbau des Kontextmenues vor, ohne bestehende
 *   window.dbzs-IPC-APIs zu veraendern.
 *
 * Input:
 *   Aktueller Explorer-Kontext und Handler, die weiterhin die vorhandene Bridge nutzen.
 *
 * Output:
 *   Sortierte WorkspaceExplorerCommand-Eintraege fuer Rendering und Tests.
 *
 * Eltern:
 *   WorkspaceExplorer.tsx.
 *
 * Kinder:
 *   workspaceTree.ts fuer den Zielknoten-Typ.
 */

import type { WorkspaceTreeNode } from "@/services/workspaceTree";

export type WorkspaceExplorerCommandId =
  | "open"
  | "newFile"
  | "newFolder"
  | "rename"
  | "move"
  | "duplicate"
  | "delete"
  | "copyRelativePath"
  | "copyAbsolutePath"
  | "reveal"
  | "pin"
  | "sendToAgent"
  | "preparePatch";

export interface WorkspaceExplorerCommandContext {
  target: WorkspaceTreeNode | null;
  hasWorkspace: boolean;
  targetPinned: boolean;
  folderCollapsed: boolean;
}

export interface WorkspaceExplorerCommand {
  id: WorkspaceExplorerCommandId;
  label: string;
  requiresWorkspace?: boolean;
  targetKind?: "file" | "folder" | "any" | "none";
  danger?: boolean;
  disabled: boolean;
  action: () => void | Promise<void>;
}

interface WorkspaceExplorerCommandHandlers {
  open: () => void | Promise<void>;
  newFile: () => void | Promise<void>;
  newFolder: () => void | Promise<void>;
  rename: () => void | Promise<void>;
  move: () => void | Promise<void>;
  duplicate: () => void | Promise<void>;
  delete: () => void | Promise<void>;
  copyRelativePath: () => void | Promise<void>;
  copyAbsolutePath: () => void | Promise<void>;
  reveal: () => void | Promise<void>;
  pin: () => void | Promise<void>;
  sendToAgent: () => void | Promise<void>;
  preparePatch: () => void | Promise<void>;
}

function targetMatches(
  target: WorkspaceTreeNode | null,
  targetKind: WorkspaceExplorerCommand["targetKind"]
): boolean {
  if (!targetKind || targetKind === "none") {
    return true;
  }
  if (!target) {
    return false;
  }
  return targetKind === "any" || target.type === targetKind;
}

function commandDisabled(
  context: WorkspaceExplorerCommandContext,
  command: Pick<WorkspaceExplorerCommand, "requiresWorkspace" | "targetKind">
): boolean {
  return Boolean(command.requiresWorkspace && !context.hasWorkspace) || !targetMatches(context.target, command.targetKind);
}

export function buildWorkspaceExplorerCommands(
  context: WorkspaceExplorerCommandContext,
  handlers: WorkspaceExplorerCommandHandlers
): WorkspaceExplorerCommand[] {
  const target = context.target;
  const commands: Array<Omit<WorkspaceExplorerCommand, "disabled">> = [];

  if (target) {
    commands.push({
      id: "open",
      label: target.type === "file" ? "Oeffnen" : (context.folderCollapsed ? "Ordner aufklappen" : "Ordner einklappen"),
      targetKind: "any",
      action: handlers.open
    });
  }

  commands.push(
    {
      id: "newFile",
      label: "Neue Datei",
      requiresWorkspace: true,
      targetKind: "none",
      action: handlers.newFile
    },
    {
      id: "newFolder",
      label: "Neuer Ordner",
      requiresWorkspace: true,
      targetKind: "none",
      action: handlers.newFolder
    }
  );

  if (target) {
    commands.push(
      {
        id: "rename",
        label: "Umbenennen (Dialog)",
        targetKind: "any",
        action: handlers.rename
      },
      {
        id: "move",
        label: "Verschieben nach...",
        targetKind: "any",
        action: handlers.move
      }
    );
  }

  if (target?.type === "file") {
    commands.push(
      {
        id: "pin",
        label: context.targetPinned ? "Loesen (unpin)" : "Anpinnen",
        targetKind: "file",
        action: handlers.pin
      },
      {
        id: "duplicate",
        label: "Duplizieren",
        targetKind: "file",
        action: handlers.duplicate
      }
    );
  }

  if (target) {
    commands.push(
      {
        id: "copyRelativePath",
        label: "Relativen Pfad kopieren",
        targetKind: "any",
        action: handlers.copyRelativePath
      },
      {
        id: "copyAbsolutePath",
        label: "Absoluten Pfad kopieren",
        targetKind: "any",
        action: handlers.copyAbsolutePath
      }
    );
  }

  if (target?.type === "file") {
    commands.push(
      {
        id: "preparePatch",
        label: "Patch vorbereiten",
        targetKind: "file",
        action: handlers.preparePatch
      },
      {
        id: "sendToAgent",
        label: "An Agent senden",
        targetKind: "file",
        action: handlers.sendToAgent
      }
    );
  }

  commands.push({
    id: "reveal",
    label: "Im Explorer oeffnen",
    requiresWorkspace: true,
    targetKind: "none",
    action: handlers.reveal
  });

  if (target) {
    commands.push({
      id: "delete",
      label: "Loeschen",
      targetKind: "any",
      danger: true,
      action: handlers.delete
    });
  }

  return commands.map((command) => ({
    ...command,
    disabled: commandDisabled(context, command)
  }));
}
