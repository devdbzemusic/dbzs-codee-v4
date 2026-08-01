/*
 * DBZS - Division By Zeros
 * Datei: workspaceTree.ts
 * Bereich: Desktop Services / Workspace Explorer
 *
 * Zweck:
 *   Stellt reine Tree-, Pfad- und Dateityp-Helfer fuer den Workspace Explorer bereit.
 *
 * Warum:
 *   Die Explorer-Komponente soll UI-Zustand rendern statt Baumaufbau und
 *   Pfadlogik inline zu besitzen.
 *
 * Wozu:
 *   Ermoeglicht isolierte Tests, spaetere Virtualisierung und stabilere
 *   Command-/Kontextmenue-Erweiterungen ohne neue IPC-Schnittstellen.
 *
 * Input:
 *   WorkspaceProjectFile-Listen, Collapse-/Filteroptionen und relative Pfade.
 *
 * Output:
 *   WorkspaceTreeNode-Strukturen, geflattete Zeilen, Folder-Statistiken und
 *   normalisierte Workspace-Pfade.
 *
 * Eltern:
 *   WorkspaceExplorer.tsx und zugehoerige Explorer-Tests.
 *
 * Kinder:
 *   Keine Runtime-Abhaengigkeiten; nur Shared-Typen.
 */

import type { WorkspaceProjectFile } from "@dbzs/shared";

export interface WorkspaceTreeNode {
  id: string;
  name: string;
  path: string;
  depth: number;
  type: "folder" | "file";
  language?: string;
  children: WorkspaceTreeNode[];
  file?: WorkspaceProjectFile;
}

export interface WorkspaceTreeBuildOptions {
  typeFilter?: string;
  query?: string;
  collapsed?: Set<string>;
}

export interface WorkspaceFileChip {
  label: string;
  color: string;
}

const TYPE_COLOR: Record<string, string> = {
  typescript: "text-blue-400",
  typescriptreact: "text-blue-400",
  javascript: "text-yellow-400",
  javascriptreact: "text-yellow-400",
  python: "text-green-400",
  markdown: "text-amber-400",
  json: "text-purple-400",
  css: "text-pink-400",
  scss: "text-pink-400",
  html: "text-orange-400",
};

export function toAbsPath(root: string, rel: string): string {
  const clean = rel.trim().replace(/^([\\/])+/, "").replace(/[\\/]+/g, "/");
  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[\\/]$/, "");
  return `${base}${sep}${clean.replace(/\//g, sep)}`;
}

export function parentRel(rel: string): string {
  const normalized = rel.replace(/[\\/]+/g, "/");
  const separatorIndex = normalized.lastIndexOf("/");
  return separatorIndex <= 0 ? "" : normalized.slice(0, separatorIndex);
}

export function siblingPath(rel: string, name: string): string {
  const parent = parentRel(rel);
  return parent ? `${parent}/${name}` : name;
}

export function fileChip(file: WorkspaceProjectFile): WorkspaceFileChip {
  const ext = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const labels: Record<string, string> = {
    css: "#", html: "<>", js: "JS", json: "{}", md: "MD",
    py: "PY", ts: "TS", tsx: "TSX", jsx: "JSX", scss: "SC",
    sh: "SH", yml: "YM", yaml: "YM", toml: "TM", rs: "RS",
    go: "GO", rb: "RB", java: "JV", kt: "KT", cs: "C#",
    cpp: "C+", c: "C", txt: "TX", env: "ENV",
  };
  return {
    label: (labels[ext] ?? ext.slice(0, 3).toUpperCase()) || "?",
    color: TYPE_COLOR[file.language ?? ""] ?? "text-dbzs-cyan",
  };
}

export function buildTree(files: WorkspaceProjectFile[]): WorkspaceTreeNode[] {
  const root: WorkspaceTreeNode[] = [];
  const folders = new Map<string, WorkspaceTreeNode>();

  for (const file of files) {
    const parts = file.relativePath.split(/[\\/]/).filter(Boolean);
    let current = root;
    let nodePath = "";

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      nodePath = nodePath ? `${nodePath}/${part}` : part;
      const isFile = index === parts.length - 1;

      if (isFile) {
        current.push({
          id: file.path,
          name: part,
          path: nodePath,
          depth: index,
          type: "file",
          language: file.language,
          children: [],
          file
        });
        continue;
      }

      let folder = folders.get(nodePath);
      if (!folder) {
        folder = { id: nodePath, name: part, path: nodePath, depth: index, type: "folder", children: [] };
        folders.set(nodePath, folder);
        current.push(folder);
      }
      current = folder.children;
    }
  }

  sortTree(root);
  return root;
}

function sortTree(nodes: WorkspaceTreeNode[]): void {
  nodes.sort((left, right) =>
    left.type !== right.type ? (left.type === "folder" ? -1 : 1) : left.name.localeCompare(right.name)
  );
  nodes.forEach((node) => sortTree(node.children));
}

export function flattenTree(nodes: WorkspaceTreeNode[], collapsed: Set<string>): WorkspaceTreeNode[] {
  const rows: WorkspaceTreeNode[] = [];
  const visit = (node: WorkspaceTreeNode) => {
    rows.push(node);
    if (node.type === "folder" && !collapsed.has(node.id)) {
      node.children.forEach(visit);
    }
  };
  nodes.forEach(visit);
  return rows;
}

export function buildWorkspaceRows(
  files: WorkspaceProjectFile[],
  options: WorkspaceTreeBuildOptions = {}
): WorkspaceTreeNode[] {
  let filteredFiles = files;
  const typeFilter = options.typeFilter ?? "all";
  if (typeFilter !== "all") {
    filteredFiles = filteredFiles.filter((file) => file.name.endsWith(`.${typeFilter}`));
  }

  const base = flattenTree(buildTree(filteredFiles), options.collapsed ?? new Set());
  const query = options.query?.trim().toLowerCase();
  if (!query) {
    return base;
  }
  return base.filter((node) => node.type === "file" && node.name.toLowerCase().includes(query));
}

export function countFolder(node: WorkspaceTreeNode): { files: number; folders: number } {
  let files = 0;
  let folders = 0;
  const walk = (current: WorkspaceTreeNode) => {
    for (const child of current.children) {
      if (child.type === "file") {
        files += 1;
      } else {
        folders += 1;
        walk(child);
      }
    }
  };
  walk(node);
  return { files, folders };
}

export function allFolderIds(nodes: WorkspaceTreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (node: WorkspaceTreeNode) => {
    if (node.type !== "folder") {
      return;
    }
    ids.push(node.id);
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return ids;
}

export function getUniqueExtensions(files: WorkspaceProjectFile[]): string[] {
  const exts = new Set<string>();
  for (const file of files) {
    const ext = file.name.split(".").at(-1)?.toLowerCase();
    if (ext) {
      exts.add(ext);
    }
  }
  return [...exts].sort();
}
