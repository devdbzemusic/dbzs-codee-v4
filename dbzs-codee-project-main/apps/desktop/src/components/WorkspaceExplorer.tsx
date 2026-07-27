import { type DragEvent, type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES,
  type ReviewArtifactSummary,
  type WorkspaceProjectFile
} from "@dbzs/shared";
import { useEditorStore } from "@/stores/editorStore";
import { useGitStore } from "@/stores/gitStore";
import { useToastStore } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ContextMenu } from "@/components/ui/ContextMenu";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const COLLAPSE_KEY = "dbzs-workspace-tree-collapsed-v1";
const RECENT_KEY = "dbzs-recent-files-v1";
const PINNED_KEY = "dbzs-pinned-files-v1";
const COMPACT_KEY = "dbzs-explorer-compact-v1";
const MAX_RECENT = 8;

const SCAN_IGNORED = [
  ...DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES, ".next",
  "out", "coverage", "__pycache__", ".venv", "venv"
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TreeNode {
  id: string;
  name: string;
  path: string;
  depth: number;
  type: "folder" | "file";
  language?: string;
  children: TreeNode[];
  file?: WorkspaceProjectFile;
}

interface ContextMenuState { x: number; y: number; target: TreeNode | null }

interface PendingPatchState {
  snapshotId: string;
  filePath: string;
  label: string;
  beforeContent: string;
  afterContent: string;
  diff: string;
}

interface HoverPreview {
  nodeId: string;
  x: number;
  y: number;
  content: string | null;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]); }
  catch { return new Set(); }
}

function saveSet(key: string, set: Set<string>): void {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]; }
  catch { return []; }
}

function saveRecent(recent: string[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function loadCompact(): boolean {
  return localStorage.getItem(COMPACT_KEY) === "1";
}

// ---------------------------------------------------------------------------
// Color by file type
// ---------------------------------------------------------------------------

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

function fileChip(file: WorkspaceProjectFile): { label: string; color: string } {
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

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function toAbsPath(root: string, rel: string): string {
  const clean = rel.trim().replace(/^([\\/])+/, "").replace(/[\\/]+/g, "/");
  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[\\/]$/, "");
  return `${base}${sep}${clean.replace(/\//g, sep)}`;
}

function parentRel(rel: string): string {
  const n = rel.replace(/[\\/]+/g, "/");
  const i = n.lastIndexOf("/");
  return i <= 0 ? "" : n.slice(0, i);
}

function siblingPath(rel: string, name: string): string {
  const p = parentRel(rel);
  return p ? `${p}/${name}` : name;
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

function buildTree(files: WorkspaceProjectFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, TreeNode>();

  for (const file of files) {
    const parts = file.relativePath.split(/[\\/]/).filter(Boolean);
    let current = root;
    let path = "";

    for (let i = 0; i < parts.length; i++) {
      path = path ? `${path}/${parts[i]}` : parts[i];
      const isFile = i === parts.length - 1;

      if (isFile) {
        current.push({ id: file.path, name: parts[i], path, depth: i, type: "file", language: file.language, children: [], file });
      } else {
        let folder = folders.get(path);
        if (!folder) {
          folder = { id: path, name: parts[i], path, depth: i, type: "folder", children: [] };
          folders.set(path, folder);
          current.push(folder);
        }
        current = folder.children;
      }
    }
  }

  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.type !== b.type ? (a.type === "folder" ? -1 : 1) : a.name.localeCompare(b.name));
    nodes.forEach((n) => sortTree(n.children));
  };
  sortTree(root);
  return root;
}

function flattenTree(nodes: TreeNode[], collapsed: Set<string>): TreeNode[] {
  const rows: TreeNode[] = [];
  const visit = (n: TreeNode) => {
    rows.push(n);
    if (n.type === "folder" && !collapsed.has(n.id)) n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return rows;
}

function countFolder(node: TreeNode): { files: number; folders: number } {
  let files = 0; let folders = 0;
  const walk = (n: TreeNode) => {
    for (const c of n.children) {
      if (c.type === "file") files++;
      else { folders++; walk(c); }
    }
  };
  walk(node);
  return { files, folders };
}

function allFolderIds(nodes: TreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (n: TreeNode) => { if (n.type === "folder") { ids.push(n.id); n.children.forEach(walk); } };
  nodes.forEach(walk);
  return ids;
}

function getUniqueExtensions(files: WorkspaceProjectFile[]): string[] {
  const exts = new Set<string>();
  for (const f of files) {
    const e = f.name.split(".").at(-1)?.toLowerCase();
    if (e) exts.add(e);
  }
  return [...exts].sort();
}

// ---------------------------------------------------------------------------
// promptTextInput helper
// ---------------------------------------------------------------------------

async function promptText(req: { title: string; label: string; value: string; confirmText: string }): Promise<string | null> {
  if (window.dbzs.promptTextInput) {
    return window.dbzs.promptTextInput({ ...req, cancelText: "Abbrechen" });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WorkspaceExplorer({ embeddedInPanel = false }: { embeddedInPanel?: boolean }) {
  const { activeTab, openWorkspaceFile } = useEditorStore();
  const { createProject, error, files, isLoading, openWorkspace, scanFiles, state, status } = useWorkspaceStore();
  const changedEntries = useGitStore((s) => s.changedEntries);
  const toast = useToastStore();

  // --- Persistent state ---
  const [collapsed, setCollapsed] = useState<Set<string>>(loadSet(COLLAPSE_KEY));
  const [pinned, setPinned] = useState<Set<string>>(loadSet(PINNED_KEY));
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [compactMode, setCompactMode] = useState(loadCompact);

  // --- Filter / search ---
  const [filterQuery, setFilterQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  // --- Interaction state ---
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [lastDeletedItem, setLastDeletedItem] = useState<{ path: string; label: string } | null>(null);
  const [pendingPatch, setPendingPatch] = useState<PendingPatchState | null>(null);
  const [showScanDiag, setShowScanDiag] = useState(false);
  const [scanDiagOutput, setScanDiagOutput] = useState<string | null>(null);
  const [reviewArtifacts, setReviewArtifacts] = useState<ReviewArtifactSummary[]>([]);

  // --- Keyboard nav ---
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  // --- Inline rename ---
  const [inlineRenameId, setInlineRenameId] = useState<string | null>(null);
  const [inlineRenameValue, setInlineRenameValue] = useState("");
  const inlineInputRef = useRef<HTMLInputElement>(null);

  // --- Multi-select ---
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedIdRef = useRef<string | null>(null);

  // --- Drag & Drop ---
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // --- Hover preview (#18) ---
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Move dialog (#11) ---
  const [moveDialogNode, setMoveDialogNode] = useState<TreeNode | null>(null);
  const [moveTarget, setMoveTarget] = useState("");

  // --- Auto refresh (#17) ---
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  useEffect(() => {
    let cancelled = false;
    const workspaceRoot = state.projectPath;
    setReviewArtifacts([]);
    if (!workspaceRoot || !window.dbzs.listReviewArtifacts) return;
    void window.dbzs
      .listReviewArtifacts(workspaceRoot)
      .then((items) => {
        if (!cancelled && useWorkspaceStore.getState().state.projectPath === workspaceRoot) {
          setReviewArtifacts(items);
        }
      })
      .catch((reviewError) => {
        if (!cancelled) {
          setActionError(
            reviewError instanceof Error ? reviewError.message : "Review-Artefakte konnten nicht geladen werden."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [files, state.projectPath]);

  const openReviewArtifact = useCallback(
    async (reviewId: string, kind: "report" | "findings") => {
      if (!state.projectPath || !window.dbzs.openReviewArtifact) return;
      try {
        const file = await window.dbzs.openReviewArtifact(state.projectPath, reviewId, kind);
        if (useWorkspaceStore.getState().state.projectPath !== state.projectPath) {
          throw new Error("Workspace wurde gewechselt; Review-Aktion wurde verworfen.");
        }
        await openWorkspaceFile(file.path);
      } catch (reviewError) {
        setActionError(
          reviewError instanceof Error ? reviewError.message : "Review-Artefakt konnte nicht geöffnet werden."
        );
      }
    },
    [openWorkspaceFile, state.projectPath]
  );

  // --- Derived data ---
  const tree = useMemo(() => buildTree(files), [files]);
  const extensions = useMemo(() => getUniqueExtensions(files), [files]);
  const gitStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of changedEntries) {
      const badge = e.status === "modified" ? "M"
        : e.status === "added" ? "+"
        : e.status === "untracked" ? "U"
        : e.status === "deleted" ? "D"
        : e.status === "renamed" ? "R"
        : e.status === "conflicted" ? "!"
        : "";
      if (badge) map.set(e.filePath.replace(/\\/g, "/"), badge);
    }
    return map;
  }, [changedEntries]);

  const filteredFiles = useMemo(() => {
    let result = files;
    if (typeFilter !== "all") {
      result = result.filter((f) => f.name.endsWith(`.${typeFilter}`));
    }
    return result;
  }, [files, typeFilter]);

  const filteredTree = useMemo(() => buildTree(filteredFiles), [filteredFiles]);

  const rows = useMemo(() => {
    const base = flattenTree(filteredTree, collapsed);
    if (!filterQuery.trim()) return base;
    const q = filterQuery.toLowerCase();
    return base.filter((n) => n.type === "file" && n.name.toLowerCase().includes(q));
  }, [filteredTree, collapsed, filterQuery]);

  const pinnedRows = useMemo(() => {
    return [...pinned].map((path) => files.find((f) => f.path === path)).filter(Boolean) as WorkspaceProjectFile[];
  }, [pinned, files]);

  const recentRows = useMemo(() => {
    return recent
      .map((path) => files.find((f) => f.path === path))
      .filter(Boolean) as WorkspaceProjectFile[];
  }, [recent, files]);

  // --- Auto-refresh effect (#17) ---
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      if (autoRefreshRef.current && state.projectPath) void scanFiles();
    }, 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, scanFiles, state.projectPath]);

  // --- Compact mode persist ---
  const toggleCompact = () => {
    setCompactMode((v) => {
      localStorage.setItem(COMPACT_KEY, v ? "0" : "1");
      return !v;
    });
  };

  // --- Collapse helpers ---
  const toggleFolder = (node: TreeNode) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(node.id) ? next.delete(node.id) : next.add(node.id);
      saveSet(COLLAPSE_KEY, next);
      return next;
    });
  };

  const collapseAll = () => {
    const ids = new Set(allFolderIds(tree));
    saveSet(COLLAPSE_KEY, ids);
    setCollapsed(ids);
  };

  const expandAll = () => {
    saveSet(COLLAPSE_KEY, new Set());
    setCollapsed(new Set());
  };

  // --- Open file (tracks recent) ---
  const openFile = useCallback(async (file: WorkspaceProjectFile) => {
    await openWorkspaceFile(file.path);
    setRecent((prev) => {
      const next = [file.path, ...prev.filter((p) => p !== file.path)].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
  }, [openWorkspaceFile]);

  // --- Keyboard navigation (#3) ---
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (inlineRenameId) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && focusedIndex >= 0) {
      e.preventDefault();
      const n = rows[focusedIndex];
      if (!n) return;
      if (n.type === "folder") toggleFolder(n);
      else if (n.file) void openFile(n.file);
    } else if (e.key === "ArrowRight" && focusedIndex >= 0) {
      const n = rows[focusedIndex];
      if (n?.type === "folder") {
        setCollapsed((prev) => { const s = new Set(prev); s.delete(n.id); saveSet(COLLAPSE_KEY, s); return s; });
      }
    } else if (e.key === "ArrowLeft" && focusedIndex >= 0) {
      const n = rows[focusedIndex];
      if (n?.type === "folder") {
        setCollapsed((prev) => { const s = new Set(prev); s.add(n.id); saveSet(COLLAPSE_KEY, s); return s; });
      }
    }
  };

  // --- Inline rename (#4) ---
  const startInlineRename = (node: TreeNode) => {
    setInlineRenameId(node.id);
    setInlineRenameValue(node.name);
    setContextMenu(null);
    setTimeout(() => inlineInputRef.current?.select(), 30);
  };

  const commitInlineRename = async () => {
    if (!inlineRenameId || !state.projectPath || !window.dbzs.renameWorkspacePath) {
      setInlineRenameId(null);
      return;
    }
    const node = rows.find((r) => r.id === inlineRenameId);
    if (!node || inlineRenameValue.trim() === node.name || !inlineRenameValue.trim()) {
      setInlineRenameId(null);
      return;
    }
    const src = node.type === "file" ? node.file?.path : toAbsPath(state.projectPath, node.path);
    if (!src) { setInlineRenameId(null); return; }
    const destRel = siblingPath(node.path, inlineRenameValue.trim());
    const dest = toAbsPath(state.projectPath, destRel);
    setActionBusy(true);
    try {
      await window.dbzs.renameWorkspacePath(src, dest);
      await scanFiles();
      if (node.type === "file") await openWorkspaceFile(dest);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Umbenennen fehlgeschlagen.");
    } finally {
      setActionBusy(false);
      setInlineRenameId(null);
    }
  };

  // --- Context menu ---
  const openContextMenu = (e: MouseEvent, node: TreeNode | null) => {
    e.preventDefault();
    setActionError(null);
    setContextMenu({ x: e.clientX, y: e.clientY, target: node });
  };
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!contextMenuRef.current || !contextMenu) return;
    contextMenuRef.current.style.left = `${contextMenu.x}px`;
    contextMenuRef.current.style.top = `${contextMenu.y}px`;
  }, [contextMenu]);

  // --- Multi-select (#21) ---
  const handleNodeClick = (e: MouseEvent, node: TreeNode) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.has(node.id) ? next.delete(node.id) : next.add(node.id);
        return next;
      });
      lastClickedIdRef.current = node.id;
      return;
    }
    if (e.shiftKey && lastClickedIdRef.current) {
      const fromIdx = rows.findIndex((r) => r.id === lastClickedIdRef.current);
      const toIdx = rows.findIndex((r) => r.id === node.id);
      if (fromIdx >= 0 && toIdx >= 0) {
        const [lo, hi] = [Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx)];
        setSelectedIds(new Set(rows.slice(lo, hi + 1).map((r) => r.id)));
        return;
      }
    }
    setSelectedIds(new Set());
    lastClickedIdRef.current = node.id;
    if (node.type === "folder") {
      toggleFolder(node);
    } else if (node.file) {
      void openFile(node.file);
    }
  };

  // --- Pin / Unpin (#8) ---
  const togglePin = (node: TreeNode) => {
    if (node.type !== "file" || !node.file) return;
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(node.file!.path) ? next.delete(node.file!.path) : next.add(node.file!.path);
      saveSet(PINNED_KEY, next);
      return next;
    });
    setContextMenu(null);
  };

  // --- Copy path (#9) ---
  const copyPath = async (node: TreeNode, absolute: boolean) => {
    const path = absolute
      ? (node.type === "file" ? node.file?.path : (state.projectPath ? toAbsPath(state.projectPath, node.path) : node.path))
      : node.path;
    await navigator.clipboard.writeText(path ?? node.path);
    toast.success(`Pfad kopiert`);
    setContextMenu(null);
  };

  // --- Duplicate file (#10) ---
  const handleDuplicate = async () => {
    const node = contextMenu?.target;
    if (!node || node.type !== "file" || !node.file || !state.projectPath) return;
    setContextMenu(null);
    const ext = node.name.includes(".") ? `.${node.name.split(".").pop()}` : "";
    const base = node.name.replace(new RegExp(`${ext.replace(".", "\\.")}$`), "");
    const copyName = `${base}_copy${ext}`;
    const copyRel = siblingPath(node.path, copyName);
    const destAbs = toAbsPath(state.projectPath, copyRel);
    setActionBusy(true);
    try {
      const src = await window.dbzs.readProjectFile!(node.file.path);
      await window.dbzs.writeProjectFile!(destAbs, src?.content ?? "");
      await scanFiles();
      await openWorkspaceFile(destAbs);
      toast.success(`Dupliziert: ${copyName}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Duplizieren fehlgeschlagen.");
    } finally {
      setActionBusy(false);
    }
  };

  // --- Move dialog (#11) ---
  const openMoveDialog = (node: TreeNode) => {
    setMoveDialogNode(node);
    setMoveTarget("");
    setContextMenu(null);
  };

  const handleMove = async () => {
    if (!moveDialogNode || !state.projectPath || !window.dbzs.renameWorkspacePath) return;
    const destFolder = moveTarget.trim();
    if (!destFolder) return;
    const srcAbs = moveDialogNode.type === "file"
      ? moveDialogNode.file?.path
      : toAbsPath(state.projectPath, moveDialogNode.path);
    if (!srcAbs) return;
    const destRel = `${destFolder}/${moveDialogNode.name}`;
    const destAbs = toAbsPath(state.projectPath, destRel);
    setActionBusy(true);
    try {
      await window.dbzs.renameWorkspacePath(srcAbs, destAbs);
      await scanFiles();
      toast.success(`Verschoben nach ${destFolder}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Verschieben fehlgeschlagen.");
    } finally {
      setActionBusy(false);
      setMoveDialogNode(null);
    }
  };

  // --- Drag & Drop (#12) ---
  const handleDragStart = (e: DragEvent, node: TreeNode) => {
    setDragSourceId(node.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
  };

  const handleDragOver = (e: DragEvent, node: TreeNode) => {
    if (node.type !== "folder" || node.id === dragSourceId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(node.id);
  };

  const handleDrop = async (e: DragEvent, targetNode: TreeNode) => {
    e.preventDefault();
    setDragOverId(null);
    if (!dragSourceId || targetNode.type !== "folder" || !state.projectPath || !window.dbzs.renameWorkspacePath) {
      setDragSourceId(null);
      return;
    }
    const srcNode = rows.find((r) => r.id === dragSourceId);
    setDragSourceId(null);
    if (!srcNode) return;
    const srcAbs = srcNode.type === "file" ? srcNode.file?.path : toAbsPath(state.projectPath, srcNode.path);
    if (!srcAbs) return;
    const destRel = `${targetNode.path}/${srcNode.name}`;
    const destAbs = toAbsPath(state.projectPath, destRel);
    if (window.confirm(`"${srcNode.name}" nach "${targetNode.path}" verschieben?`)) {
      setActionBusy(true);
      try {
        await window.dbzs.renameWorkspacePath(srcAbs, destAbs);
        await scanFiles();
        toast.success(`Verschoben: ${srcNode.name}`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Drag-Verschieben fehlgeschlagen.");
      } finally {
        setActionBusy(false);
      }
    }
  };

  // --- Hover preview (#18) ---
  const handleMouseEnterFile = (e: MouseEvent, node: TreeNode) => {
    if (!node.file || node.type !== "file") return;
    const { clientX, clientY } = e;
    hoverTimerRef.current = setTimeout(async () => {
      setHoverPreview({ nodeId: node.id, x: clientX, y: clientY, content: null, loading: true });
      try {
        const f = await window.dbzs.readProjectFile?.(node.file!.path);
        const lines = (f?.content ?? "").split("\n").slice(0, 15).join("\n");
        setHoverPreview((prev) => prev?.nodeId === node.id ? { ...prev, content: lines, loading: false } : prev);
      } catch {
        setHoverPreview(null);
      }
    }, 600);
  };

  const handleMouseLeaveFile = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverPreview(null);
  };

  // --- Send to agent (#22) ---
  const sendToAgent = (node: TreeNode) => {
    if (!node.file) return;
    localStorage.setItem("dbzs-job-file-ctx", node.file.path);
    toast.info(`Datei als Job-Kontext vorbereitet — erstelle Job im Job-Monitor`);
    setContextMenu(null);
  };

  // --- Batch delete (#21) ---
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0 || !state.projectPath || !window.dbzs.deleteWorkspacePath) return;
    const confirmed = window.confirm(`${selectedIds.size} Einträge löschen?`);
    if (!confirmed) return;
    setActionBusy(true);
    let errMsg: string | null = null;
    for (const id of selectedIds) {
      const node = rows.find((r) => r.id === id);
      if (!node) continue;
      const abs = node.type === "file" ? node.file?.path : toAbsPath(state.projectPath, node.path);
      if (!abs) continue;
      try { await window.dbzs.deleteWorkspacePath(abs); }
      catch (err) { errMsg = err instanceof Error ? err.message : "Fehler beim Löschen."; }
    }
    await scanFiles();
    setSelectedIds(new Set());
    setActionBusy(false);
    if (errMsg) setActionError(errMsg);
    else toast.success(`${selectedIds.size} Einträge gelöscht`);
  };

  // --- Existing handlers ---
  const preparePatchWorkflow = async (filePath: string, label: string, initialAfter?: string) => {
    if (!window.dbzs.createWorkspaceFileSnapshot || !window.dbzs.createWorkspaceDiff) throw new Error("Diff/Patch-Bridge nicht verfuegbar.");
    const snap = await window.dbzs.createWorkspaceFileSnapshot(filePath);
    let after = initialAfter;
    if (after === undefined && window.dbzs.readProjectFile) {
      try { after = (await window.dbzs.readProjectFile(filePath))?.content ?? ""; }
      catch { after = ""; }
    }
    const diff = await window.dbzs.createWorkspaceDiff(filePath, after ?? "");
    setPendingPatch({ snapshotId: snap.snapshotId, filePath, label, beforeContent: diff.beforeContent, afterContent: diff.afterContent, diff: diff.diff });
    setContextMenu(null);
  };

  const handleCreateFile = async () => {
    if (!state.projectPath) { setActionError("Kein aktiver Workspace."); return; }
    const suggested = contextMenu?.target?.type === "folder" ? `${contextMenu.target.path}/neu.txt` : "neu.txt";
    const rel = (await promptText({ title: "Neue Datei", label: "Relativer Pfad", value: suggested, confirmText: "Erstellen" }))?.trim();
    if (!rel) return;
    const parts = rel.split(/[\\/]+/).filter(Boolean);
    if (!parts.length || parts.includes("..")) { setActionError("Ungültiger Pfad."); return; }
    setActionBusy(true); setActionError(null);
    try { await preparePatchWorkflow(toAbsPath(state.projectPath, rel), rel, ""); }
    catch (err) { setActionError(err instanceof Error ? err.message : "Fehler."); }
    finally { setActionBusy(false); }
  };

  const handleCreateFolder = async () => {
    if (!state.projectPath || !window.dbzs.createWorkspaceFolder) { setActionError("Bridge nicht verfügbar."); return; }
    const def = contextMenu?.target ? (contextMenu.target.type === "folder" ? `${contextMenu.target.path}/neuer-ordner` : `${parentRel(contextMenu.target.path)}/neuer-ordner`.replace(/^\//, "")) : "neuer-ordner";
    const rel = (await promptText({ title: "Neuer Ordner", label: "Relativer Pfad", value: def, confirmText: "Erstellen" }))?.trim();
    if (!rel) return;
    setActionBusy(true); setActionError(null);
    try { await window.dbzs.createWorkspaceFolder(toAbsPath(state.projectPath, rel)); await scanFiles(); setContextMenu(null); }
    catch (err) { setActionError(err instanceof Error ? err.message : "Fehler."); }
    finally { setActionBusy(false); }
  };

  const handleRenamePath = async () => {
    if (!state.projectPath || !contextMenu?.target || !window.dbzs.renameWorkspacePath) return;
    const node = contextMenu.target;
    const newName = (await promptText({ title: "Umbenennen", label: "Neuer Name", value: node.name, confirmText: "Umbenennen" }))?.trim();
    if (!newName || newName === node.name) return;
    const srcAbs = node.type === "file" ? node.file?.path : toAbsPath(state.projectPath, node.path);
    if (!srcAbs) return;
    const destAbs = toAbsPath(state.projectPath, siblingPath(node.path, newName));
    setActionBusy(true); setActionError(null);
    try {
      await window.dbzs.renameWorkspacePath(srcAbs, destAbs);
      await scanFiles();
      if (node.type === "file") await openWorkspaceFile(destAbs);
      setContextMenu(null);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Umbenennen fehlgeschlagen."); }
    finally { setActionBusy(false); }
  };

  const handleDeletePath = async () => {
    if (!state.projectPath || !contextMenu?.target || !window.dbzs.deleteWorkspacePath) return;
    const node = contextMenu.target;
    const abs = node.type === "file" ? node.file?.path : toAbsPath(state.projectPath, node.path);
    if (!abs || !window.confirm(`In Workspace-Trash verschieben?\n\n${node.path}`)) return;
    setActionBusy(true); setActionError(null);
    try {
      const res = await window.dbzs.deleteWorkspacePath(abs);
      await scanFiles();
      if (res.hasUndo) setLastDeletedItem({ path: abs, label: node.path });
      setContextMenu(null);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Löschen fehlgeschlagen."); }
    finally { setActionBusy(false); }
  };

  const handleRestoreDelete = async () => {
    if (!window.dbzs.restoreLastDeletedWorkspacePath) return;
    setActionBusy(true);
    try { const r = await window.dbzs.restoreLastDeletedWorkspacePath(); if (r.restoredPath) { await scanFiles(); setLastDeletedItem(null); } }
    catch (err) { setActionError(err instanceof Error ? err.message : "Wiederherstellen fehlgeschlagen."); }
    finally { setActionBusy(false); }
  };

  const handleOpenInExplorer = async () => {
    if (!window.dbzs.openInSystemExplorer) { setActionError("Bridge nicht verfügbar."); return; }
    const path = contextMenu?.target
      ? (contextMenu.target.type === "file"
          ? contextMenu.target.file?.path
          : (state.projectPath ? toAbsPath(state.projectPath, contextMenu.target.path) : state.projectPath ?? undefined))
      : state.projectPath ?? undefined;
    setActionBusy(true); setActionError(null);
    try { await window.dbzs.openInSystemExplorer(path); setContextMenu(null); }
    catch (err) { setActionError(err instanceof Error ? err.message : "Fehler."); }
    finally { setActionBusy(false); }
  };

  const handleOpenTarget = async () => {
    const target = contextMenu?.target;
    if (!target) return;
    if (target.type === "file" && target.file) {
      await openFile(target.file);
      setContextMenu(null);
      return;
    }
    if (target.type === "folder") {
      toggleFolder(target);
      setContextMenu(null);
    }
  };

  const handlePreparePatch = async () => {
    if (!contextMenu?.target?.file) return;
    setActionBusy(true); setActionError(null);
    try { await preparePatchWorkflow(contextMenu.target.file.path, contextMenu.target.path); }
    catch (err) { setActionError(err instanceof Error ? err.message : "Fehler."); }
    finally { setActionBusy(false); }
  };

  const handlePatchContentChange = async (next: string) => {
    if (!pendingPatch || !window.dbzs.createWorkspaceDiff) return;
    const d = await window.dbzs.createWorkspaceDiff(pendingPatch.filePath, next);
    setPendingPatch({ ...pendingPatch, afterContent: d.afterContent, diff: d.diff });
  };

  const handleApplyPatch = async () => {
    if (!pendingPatch || !window.dbzs.applyWorkspacePatch) { setActionError("Bridge nicht verfügbar."); return; }
    setActionBusy(true); setActionError(null);
    try {
      await window.dbzs.applyWorkspacePatch(pendingPatch.filePath, pendingPatch.afterContent, pendingPatch.snapshotId, { reason: "before_patch", label: `Before patch: ${pendingPatch.label}` });
      await scanFiles(); await openWorkspaceFile(pendingPatch.filePath); setPendingPatch(null);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Fehler."); }
    finally { setActionBusy(false); }
  };

  const handleRestorePatch = async () => {
    if (!pendingPatch || !window.dbzs.restoreWorkspaceSnapshot) return;
    setActionBusy(true); setActionError(null);
    try { const r = await window.dbzs.restoreWorkspaceSnapshot(pendingPatch.snapshotId); await scanFiles(); if (r.file) await openWorkspaceFile(r.file.path); setPendingPatch(null); }
    catch (err) { setActionError(err instanceof Error ? err.message : "Fehler."); }
    finally { setActionBusy(false); }
  };

  const handleScanDiag = async () => {
    if (!state.projectPath || !window.dbzs.terminalExec) { setActionError("Terminal-Bridge fehlt."); return; }
    setActionBusy(true); setActionError(null); setScanDiagOutput(null);
    try {
      const r = await window.dbzs.terminalExec({ command: "git", args: ["status", "--short"], cwd: state.projectPath, timeoutMs: 30_000 });
      setScanDiagOutput([r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n") || "Keine Ausgabe.");
      setShowScanDiag(true);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Fehler."); }
    finally { setActionBusy(false); }
  };

  // --- Breadcrumb (#5) ---
  const breadcrumb = useMemo(() => {
    if (activeTab?.type !== "file" || !state.projectPath) return null;
    const rel = activeTab.path.replace(state.projectPath, "").replace(/^[\\/]/, "").replace(/\\/g, "/");
    return rel.split("/").filter(Boolean);
  }, [activeTab, state.projectPath]);

  const rowHeight = compactMode ? "h-5" : "h-7";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className={embeddedInPanel ? "flex flex-col" : "flex h-full min-h-0 flex-col"}
      onContextMenu={(e) => openContextMenu(e, null)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* ---- Header ---- */}
      <div className="shrink-0 border-b border-dbzs-border px-3 py-2 space-y-2">
        {/* Row 1: title + controls */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-xs font-semibold uppercase text-dbzs-text">Explorer</h2>
            <span
              aria-label="Hilfe"
              className="has-help-tooltip inline-grid h-4 w-4 place-items-center rounded-full border border-dbzs-border text-[10px] text-dbzs-muted"
              data-help="Linksklick öffnet/klappt auf, Rechtsklick = Menü, Doppelklick = Umbenennen, Ctrl+Klick = Mehrfachauswahl"
              role="img"
              tabIndex={0}
            >?</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[10px] text-dbzs-muted hover:text-dbzs-text"
              onClick={expandAll}
              title="Alle aufklappen"
              type="button"
            >⊞</button>
            <button
              className="border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[10px] text-dbzs-muted hover:text-dbzs-text"
              onClick={collapseAll}
              title="Alle einklappen"
              type="button"
            >⊟</button>
            <button
              className={`border border-dbzs-border px-1.5 py-0.5 text-[10px] ${compactMode ? "bg-dbzs-cyan/10 text-dbzs-cyan" : "bg-dbzs-bg text-dbzs-muted hover:text-dbzs-text"}`}
              onClick={toggleCompact}
              title={compactMode ? "Entspannter Modus" : "Kompakter Modus"}
              type="button"
            >≡</button>
            <button
              className={`border border-dbzs-border px-1.5 py-0.5 text-[10px] ${autoRefresh ? "bg-dbzs-green/10 text-dbzs-green" : "bg-dbzs-bg text-dbzs-muted hover:text-dbzs-text"}`}
              onClick={() => setAutoRefresh((v) => !v)}
              title={autoRefresh ? "Auto-Refresh an (alle 10s)" : "Auto-Refresh aus"}
              type="button"
            >↻</button>
          </div>
        </div>

        {/* Row 2: project name + breadcrumb */}
        <div className="min-w-0">
          <p className="truncate text-[11px] text-dbzs-muted">{state.projectName ?? "Kein Projekt"}</p>
          {breadcrumb && breadcrumb.length > 0 && (
            <div className="mt-0.5 flex items-center gap-0.5 flex-wrap text-[10px] text-dbzs-muted">
              {breadcrumb.map((part, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  {i > 0 && <span className="opacity-40">›</span>}
                  <span className={i === breadcrumb.length - 1 ? "text-dbzs-cyan" : ""}>{part}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Row 3: filter input + type dropdown */}
        <div className="flex gap-1">
          <input
            aria-label="Dateinamen filtern"
            className="flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-text placeholder:text-dbzs-muted"
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filtern…"
            value={filterQuery}
          />
          <select
            aria-label="Dateityp filtern"
            className="border border-dbzs-border bg-dbzs-bg px-1 py-0.5 text-[11px] text-dbzs-text"
            onChange={(e) => setTypeFilter(e.target.value)}
            value={typeFilter}
          >
            <option value="all">Alle</option>
            {extensions.map((ext) => (
              <option key={ext} value={ext}>.{ext}</option>
            ))}
          </select>
        </div>

        {/* Row 4: actions */}
        <div className="flex gap-1 flex-wrap">
          <button className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-muted hover:text-dbzs-text" disabled={isLoading} onClick={() => void createProject()} type="button">Neues Projekt</button>
          <button className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-muted hover:text-dbzs-text" disabled={isLoading} onClick={() => void openWorkspace()} type="button">Öffnen</button>
          {state.projectPath ? (
            <>
              <button className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-muted hover:text-dbzs-text" disabled={isLoading} onClick={() => void useWorkspaceStore.getState().createNewFile()} type="button">Datei neu</button>
              <button className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-muted hover:text-dbzs-text" disabled={isLoading} onClick={() => void useWorkspaceStore.getState().createNewFolder()} type="button">Neuer Ordner</button>
              <button className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-muted hover:text-dbzs-text" disabled={isLoading} onClick={() => void scanFiles()} type="button">Scannen</button>
              <button className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-muted hover:text-dbzs-text" disabled={isLoading} onClick={() => void useWorkspaceStore.getState().saveWorkspace()} type="button">Workspace speichern</button>
            </>
          ) : null}
        </div>

        {/* Batch actions when multi-selected */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 border border-dbzs-amber/30 bg-dbzs-amber/5 px-2 py-1 text-[11px] text-dbzs-amber">
            <span>{selectedIds.size} ausgewählt</span>
            <button className="hover:underline" onClick={() => void handleBatchDelete()} type="button">Alle löschen</button>
            <button className="hover:underline ml-auto" onClick={() => setSelectedIds(new Set())} type="button">✕</button>
          </div>
        )}

        {/* Undo delete */}
        {lastDeletedItem && (
          <div className="flex items-center justify-between gap-2 border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-[11px] text-dbzs-muted">
            <span className="min-w-0 truncate">Gelöscht: {lastDeletedItem.label}</span>
            <button className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[10px] text-dbzs-text" disabled={actionBusy} onClick={() => void handleRestoreDelete()} type="button">Rückgängig</button>
          </div>
        )}
      </div>

      {/* ---- Patch preview ---- */}
      {pendingPatch && (
        <div className="shrink-0 border-b border-dbzs-border bg-dbzs-panelSoft px-3 py-2 text-xs text-dbzs-muted">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-dbzs-text">Diff-Vorschau: {pendingPatch.label}</div>
              <div className="text-[11px]">Änderung erst nach Bestätigung angewendet.</div>
            </div>
            <div className="flex items-center gap-1">
              <button className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-text disabled:opacity-50" disabled={actionBusy} onClick={() => void handleApplyPatch()} type="button">Anwenden</button>
              <button className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-text disabled:opacity-50" disabled={actionBusy} onClick={() => setPendingPatch(null)} type="button">Verwerfen</button>
              <button className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-text disabled:opacity-50" disabled={actionBusy} onClick={() => void handleRestorePatch()} type="button">Snapshot</button>
            </div>
          </div>
          <textarea
            className="h-20 w-full resize-y border border-dbzs-border bg-dbzs-bg p-2 text-[11px] text-dbzs-text"
            onChange={(e) => void handlePatchContentChange(e.target.value)}
            value={pendingPatch.afterContent}
          />
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap border border-dbzs-border bg-dbzs-bg p-2 text-[10px] text-dbzs-text">{pendingPatch.diff}</pre>
        </div>
      )}

      {/* ---- Tree list ---- */}
      <div
        className={embeddedInPanel ? "py-1 text-xs" : "min-h-0 flex-1 overflow-auto py-1 text-xs"}
        ref={listRef}
      >
        {reviewArtifacts.length > 0 && !filterQuery && typeFilter === "all" && (
          <div className="mb-2 border-b border-dbzs-border/60 pb-1">
            <div className="px-3 py-0.5 text-[10px] uppercase tracking-wide text-dbzs-cyan">
              CODEE ARTEFAKTE
            </div>
            <div className="px-3 py-0.5 text-[10px] text-dbzs-muted">Reviews</div>
            {reviewArtifacts.map((review) => (
              <div className="mx-2 mb-1 rounded border border-dbzs-border/70 bg-dbzs-panelSoft px-2 py-1" key={review.reviewId}>
                <div className="truncate text-[10px] font-medium text-dbzs-text">
                  {review.reviewId} · {review.outcome ?? review.status}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <button className="text-[10px] text-dbzs-cyan hover:underline" onClick={() => void openReviewArtifact(review.reviewId, "report")} type="button">
                    Report
                  </button>
                  <button className="text-[10px] text-dbzs-cyan hover:underline" onClick={() => void openReviewArtifact(review.reviewId, "findings")} type="button">
                    Findings
                  </button>
                  <button
                    className="text-[10px] text-dbzs-cyan hover:underline"
                    onClick={() => state.projectPath && void window.dbzs.revealReviewArtifacts?.(state.projectPath, review.reviewId)}
                    type="button"
                  >
                    Ordner
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pinned files */}
        {pinnedRows.length > 0 && (
          <div className="mb-1">
            <div className="px-3 py-0.5 text-[10px] uppercase tracking-wide text-dbzs-muted opacity-60">Angeheftet</div>
            {pinnedRows.map((f) => {
              const chip = fileChip(f);
              const isActive = activeTab?.type === "file" && activeTab.path === f.path;
              return (
                <button
                  className={`flex ${rowHeight} w-full items-center gap-2 px-2 text-left ${isActive ? "bg-dbzs-cyan/10 text-dbzs-text" : "text-dbzs-muted hover:bg-dbzs-panelSoft hover:text-dbzs-text"}`}
                  key={f.path}
                  onClick={() => void openFile(f)}
                  onContextMenu={(e) => { const node = rows.find((r) => r.file?.path === f.path); openContextMenu(e, node ?? null); }}
                  type="button"
                >
                  <span className={`w-7 shrink-0 text-[10px] ${chip.color}`}>📌</span>
                  <span className="truncate">{f.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Recent files */}
        {recentRows.length > 0 && !filterQuery && typeFilter === "all" && (
          <div className="mb-1">
            <div className="px-3 py-0.5 text-[10px] uppercase tracking-wide text-dbzs-muted opacity-60">Zuletzt geöffnet</div>
            {recentRows.slice(0, 5).map((f) => {
              const chip = fileChip(f);
              const isActive = activeTab?.type === "file" && activeTab.path === f.path;
              return (
                <button
                  className={`flex ${rowHeight} w-full items-center gap-2 px-2 text-left ${isActive ? "bg-dbzs-cyan/10 text-dbzs-text" : "text-dbzs-muted hover:bg-dbzs-panelSoft hover:text-dbzs-text"}`}
                  key={f.path}
                  onClick={() => void openFile(f)}
                  type="button"
                >
                  <span className={`w-7 shrink-0 text-[10px] ${chip.color}`}>🕐</span>
                  <span className="truncate">{f.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {(pinnedRows.length > 0 || recentRows.length > 0) && !filterQuery && <div className="my-1 border-t border-dbzs-border" />}

        {/* Main tree */}
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-dbzs-muted">
            {isLoading ? "Scanne Projekt…" : filterQuery ? "Keine Treffer." : state.projectPath ? (
              <div className="space-y-2">
                <p>Workspace offen, Dateibaum leer.</p>
                <div className="rounded border border-dbzs-border bg-dbzs-panelSoft p-2 text-[11px]">
                  <div className="uppercase tracking-wide">Pfad</div>
                  <div className="mt-0.5 break-all text-dbzs-text">{state.projectPath}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-[11px] text-dbzs-text" onClick={() => void scanFiles()} type="button">Erneut scannen</button>
                  <button className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-[11px] text-dbzs-text" onClick={() => setShowScanDiag((v) => !v)} type="button">Diagnose</button>
                  <button className="border border-dbzs-border bg-dbzs-panelSoft px-2 py-1 text-[11px] text-dbzs-text disabled:opacity-50" disabled={actionBusy} onClick={() => void handleScanDiag()} type="button">Git-Status prüfen</button>
                </div>
                <div className="text-[11px]">Ignoriert: {SCAN_IGNORED.join(", ")}</div>
                {showScanDiag && (
                  <div className="rounded border border-dbzs-border bg-dbzs-panelSoft p-2 text-[11px]">
                    <div>Status: {status} · Dateien: {files.length}</div>
                    {scanDiagOutput && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap border border-dbzs-border bg-dbzs-bg p-1 text-[10px]">{scanDiagOutput}</pre>}
                  </div>
                )}
              </div>
            ) : "Noch kein Projekt geöffnet."}
          </div>
        ) : (
          rows.map((node, rowIndex) => {
            const isActive = node.type === "file" && activeTab?.type === "file" && activeTab.path === node.file?.path;
            const isFocused = rowIndex === focusedIndex;
            const isSelected = selectedIds.has(node.id);
            const isDragTarget = dragOverId === node.id;
            const gitKey = node.file?.relativePath.replace(/\\/g, "/") ?? "";
            const gitBadge = gitStatusMap.get(gitKey);
            const folderStats = node.type === "folder" ? countFolder(node) : null;
            const isRenaming = inlineRenameId === node.id;
            const chip = node.type === "file" && node.file ? fileChip(node.file) : null;
            const isPinned = node.type === "file" && node.file && pinned.has(node.file.path);

            return (
              <div
                className={`workspace-tree-row has-help-tooltip flex ${rowHeight} w-full items-center gap-1.5 px-2 text-left transition-colors ${
                  isDragTarget ? "bg-dbzs-cyan/20 border border-dashed border-dbzs-cyan" :
                  isSelected ? "bg-dbzs-amber/10 text-dbzs-text" :
                  isActive ? "bg-dbzs-cyan/10 text-dbzs-text" :
                  isFocused ? "bg-dbzs-panelSoft text-dbzs-text outline outline-1 outline-dbzs-cyan/40" :
                  "text-dbzs-muted hover:bg-dbzs-panelSoft hover:text-dbzs-text"
                }`}
                data-depth={Math.min(node.depth, 20)}
                data-help={node.type === "file" ? node.file?.relativePath : `${node.path} (${folderStats?.files ?? 0} Dateien)`}
                draggable
                key={`${node.type}-${node.id}`}
                onClick={(e) => { e.stopPropagation(); handleNodeClick(e, node); }}
                onContextMenu={(e) => openContextMenu(e, node)}
                onDoubleClick={() => { if (node.type === "file") startInlineRename(node); }}
                onDragEnd={() => { setDragSourceId(null); setDragOverId(null); }}
                onDragOver={(e) => handleDragOver(e, node)}
                onDragStart={(e) => handleDragStart(e, node)}
                onDrop={(e) => void handleDrop(e, node)}
                onMouseEnter={(e) => { setFocusedIndex(rowIndex); handleMouseEnterFile(e, node); }}
                onMouseLeave={handleMouseLeaveFile}
                role="button"
                tabIndex={-1}
              >
                {/* Expand/collapse icon */}
                <span className={`w-6 shrink-0 text-[10px] ${chip ? chip.color : "text-dbzs-muted"}`}>
                  {node.type === "folder"
                    ? (collapsed.has(node.id) ? "▶" : "▼")
                    : chip?.label ?? "?"}
                </span>

                {/* Name (or inline rename input) */}
                {isRenaming ? (
                  <input
                    autoFocus
                    className="flex-1 border border-dbzs-cyan/60 bg-dbzs-bg px-1 py-0 text-xs text-dbzs-text outline-none"
                    onBlur={() => void commitInlineRename()}
                    onChange={(e) => setInlineRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void commitInlineRename(); }
                      if (e.key === "Escape") { setInlineRenameId(null); }
                    }}
                    ref={inlineInputRef}
                    value={inlineRenameValue}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                )}

                {/* Pin indicator */}
                {isPinned && <span className="text-[9px] text-dbzs-amber opacity-70">📌</span>}

                {/* Git badge */}
                {gitBadge && (
                  <span className={`shrink-0 text-[10px] font-bold ${
                    gitBadge === "M" ? "text-dbzs-amber" :
                    gitBadge === "+" ? "text-dbzs-green" :
                    gitBadge === "U" ? "text-dbzs-muted" :
                    gitBadge === "D" ? "text-dbzs-red" :
                    gitBadge === "!" ? "text-red-400" :
                    "text-dbzs-muted"
                  }`}>{gitBadge}</span>
                )}

                {/* Folder stats mini */}
                {node.type === "folder" && folderStats && (
                  <span className="shrink-0 text-[9px] text-dbzs-muted/60">{folderStats.files}</span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ---- Status bar ---- */}
      {(status === "empty" && !error) && (
        <div className="shrink-0 border-t border-dbzs-border px-3 py-1 text-[11px] text-dbzs-muted">Keine scanbaren Dateien.</div>
      )}
      {error && <div className="shrink-0 border-t border-dbzs-border px-3 py-1 text-[11px] text-dbzs-red">{error}</div>}
      {actionError && <div className="shrink-0 border-t border-dbzs-border px-3 py-1 text-[11px] text-dbzs-red">{actionError}</div>}
      {rows.length > 0 && !filterQuery && (
        <div className="shrink-0 border-t border-dbzs-border px-3 py-1 text-[10px] text-dbzs-muted/60">
          {files.length} Dateien · {autoRefresh ? "Auto-Refresh aktiv" : "manuell"}
        </div>
      )}

      {/* ---- Context menu ---- */}
      {contextMenu && (
        <ContextMenu
          items={(() => {
            const target = contextMenu.target;
            const isFile = target?.type === "file";
            const isFolder = target?.type === "folder";
            const targetPinned = Boolean(target && target.type === "file" && target.file && pinned.has(target.file.path));
            const folderIsCollapsed = Boolean(isFolder && target && collapsed.has(target.id));

            const menuItems: Array<
              | null
              | { label: string; action: () => void | Promise<void>; disabled?: boolean; danger?: boolean }
            > = [];

            if (isFile || isFolder) {
              menuItems.push({
                label: isFile ? "Öffnen" : (folderIsCollapsed ? "Ordner aufklappen" : "Ordner einklappen"),
                action: () => void handleOpenTarget(),
              });
            }

            menuItems.push(
              { label: "Neue Datei", action: handleCreateFile, disabled: !state.projectPath },
              { label: "Neuer Ordner", action: handleCreateFolder, disabled: !state.projectPath },
              null
            );

            if (isFile || isFolder) {
              menuItems.push(
                { label: "Umbenennen (Dialog)", action: handleRenamePath, disabled: !target },
                { label: "Verschieben nach…", action: () => target && openMoveDialog(target), disabled: !target }
              );
            }

            if (isFile) {
              menuItems.push(
                { label: targetPinned ? "Lösen (unpin)" : "Anpinnen", action: () => target && togglePin(target), disabled: !target },
                { label: "Duplizieren", action: handleDuplicate, disabled: !target }
              );
            }

            if (isFile || isFolder) {
              menuItems.push(
                null,
                { label: "Relativen Pfad kopieren", action: () => target && void copyPath(target, false), disabled: !target },
                { label: "Absoluten Pfad kopieren", action: () => target && void copyPath(target, true), disabled: !target }
              );
            }

            if (isFile) {
              menuItems.push(
                null,
                { label: "Patch vorbereiten", action: handlePreparePatch, disabled: !target },
                { label: "An Agent senden", action: () => target && sendToAgent(target), disabled: !target }
              );
            }

            menuItems.push(
              null,
              { label: "Im Explorer öffnen", action: handleOpenInExplorer, disabled: !state.projectPath }
            );

            if (isFile || isFolder) {
              menuItems.push({ label: "Löschen", action: handleDeletePath, disabled: !target, danger: true });
            }

            return menuItems;
          })()}
          onClose={() => setContextMenu(null)}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}

      {/* ---- Move dialog (#11) ---- */}
      {moveDialogNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 border border-dbzs-border bg-dbzs-panel p-4 shadow-panel">
            <h3 className="text-xs font-semibold text-dbzs-text mb-3">"{moveDialogNode.name}" verschieben</h3>
            <label className="block text-[11px] text-dbzs-muted mb-1">Zielordner (relativer Pfad)</label>
            <select
              className="w-full border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text mb-3"
              onChange={(e) => setMoveTarget(e.target.value)}
              value={moveTarget}
            >
              <option value="">— Ordner wählen —</option>
              {allFolderIds(tree).map((fid) => (
                <option key={fid} value={fid}>{fid}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button className="flex-1 border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-xs text-dbzs-cyan disabled:opacity-40" disabled={!moveTarget || actionBusy} onClick={() => void handleMove()} type="button">Verschieben</button>
              <button className="flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted" onClick={() => setMoveDialogNode(null)} type="button">Abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Hover preview (#18) ---- */}
      {hoverPreview && (
        <div
          className="pointer-events-none fixed z-40 w-72 border border-dbzs-border bg-dbzs-panel shadow-panel"
          style={{ left: Math.min(hoverPreview.x + 12, window.innerWidth - 300), top: Math.min(hoverPreview.y, window.innerHeight - 200) }}
        >
          <div className="border-b border-dbzs-border px-2 py-1 text-[10px] text-dbzs-muted">Vorschau</div>
          <pre className="max-h-40 overflow-hidden p-2 text-[10px] text-dbzs-text leading-4 whitespace-pre-wrap break-words">
            {hoverPreview.loading ? "Lädt…" : (hoverPreview.content ?? "Kein Inhalt")}
          </pre>
        </div>
      )}
    </div>
  );
}
