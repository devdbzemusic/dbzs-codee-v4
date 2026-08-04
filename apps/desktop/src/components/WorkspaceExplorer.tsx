import { type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES,
  type ReviewArtifactSummary,
  type WorkspaceProjectFile
} from "@dbzs/shared";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "@/stores/editorStore";
import { useGitStore } from "@/stores/gitStore";
import { useToastStore } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import {
  allFolderIds,
  buildTree,
  buildWorkspaceRows,
  countFolder,
  fileChip,
  getUniqueExtensions,
  parentRel,
  siblingPath,
  toAbsPath,
  type WorkspaceTreeNode
} from "@/services/workspaceTree";
import { buildWorkspaceExplorerCommands } from "@/services/workspaceExplorerCommands";

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

type TreeNode = WorkspaceTreeNode;

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
  const { activeTab, openWorkspaceFile } = useEditorStore(
    useShallow((store) => ({
      activeTab: store.activeTab,
      openWorkspaceFile: store.openWorkspaceFile
    }))
  );
  const { createProject, error, files, isLoading, openWorkspace, scanFiles, state, status } = useWorkspaceStore(
    useShallow((store) => ({
      createProject: store.createProject,
      error: store.error,
      files: store.files,
      isLoading: store.isLoading,
      openWorkspace: store.openWorkspace,
      scanFiles: store.scanFiles,
      state: store.state,
      status: store.status
    }))
  );
  const changedEntries = useGitStore((s) => s.changedEntries);
  const toast = useToastStore(
    useShallow((store) => ({
      info: store.info,
      success: store.success
    }))
  );

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
  const moveDialogRef = useRef<HTMLDivElement | null>(null);
  const moveSelectRef = useRef<HTMLSelectElement | null>(null);

  // --- Move dialog (#11) ---
  const [moveDialogNode, setMoveDialogNode] = useState<TreeNode | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  useFocusTrap(moveDialogRef, Boolean(moveDialogNode), () => setMoveDialogNode(null), moveSelectRef);

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

  const rows = useMemo(
    () => buildWorkspaceRows(files, { collapsed, query: filterQuery, typeFilter }),
    [collapsed, files, filterQuery, typeFilter]
  );

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
      className={embeddedInPanel ? "flex flex-col" : "flex h-full min-h-0 flex-col bg-dbzs-panel"}
      onContextMenu={(e) => openContextMenu(e, null)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* ════════════════════════════════════════════════
          HEADER — title row + toolbar
          ════════════════════════════════════════════════ */}
      <header className="shrink-0 border-b border-dbzs-border bg-dbzs-panelSoft">
        {/* Row 1: title + icon-buttons */}
        <div className="flex h-9 items-center justify-between px-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <svg
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-dbzs-cyan"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              viewBox="0 0 24 24"
            >
              <path d="M3 7h18M3 12h18M3 17h18" strokeLinecap="round" />
            </svg>
            <h2 className="truncate text-[11px] font-semibold uppercase tracking-widest text-dbzs-muted">
              Explorer
            </h2>
          </div>
          <div className="flex items-center gap-0.5">
            {/* Expand all */}
            <button
              aria-label="Alle aufklappen"
              className="grid h-6 w-6 place-items-center rounded text-dbzs-muted transition-colors hover:bg-dbzs-cyan/10 hover:text-dbzs-cyan"
              onClick={expandAll}
              title="Alle aufklappen"
              type="button"
            >
              <svg fill="none" height="11" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="11">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
            {/* Collapse all */}
            <button
              aria-label="Alle einklappen"
              className="grid h-6 w-6 place-items-center rounded text-dbzs-muted transition-colors hover:bg-dbzs-cyan/10 hover:text-dbzs-cyan"
              onClick={collapseAll}
              title="Alle einklappen"
              type="button"
            >
              <svg fill="none" height="11" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="11">
                <path d="M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
            {/* Compact toggle */}
            <button
              aria-label={compactMode ? "Entspannter Modus" : "Kompakter Modus"}
              aria-pressed={compactMode}
              className={`grid h-6 w-6 place-items-center rounded transition-colors ${
                compactMode
                  ? "bg-dbzs-cyan/10 text-dbzs-cyan"
                  : "text-dbzs-muted hover:bg-dbzs-cyan/10 hover:text-dbzs-cyan"
              }`}
              onClick={toggleCompact}
              title={compactMode ? "Entspannter Modus" : "Kompakter Modus"}
              type="button"
            >
              <svg fill="none" height="11" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="11">
                <path d="M4 6h16M4 10h16M4 14h16M4 18h16" strokeLinecap="round" />
              </svg>
            </button>
            {/* Auto-refresh toggle */}
            <button
              aria-label={autoRefresh ? "Auto-Refresh deaktivieren" : "Auto-Refresh aktivieren"}
              aria-pressed={autoRefresh}
              className={`grid h-6 w-6 place-items-center rounded transition-colors ${
                autoRefresh
                  ? "bg-dbzs-green/10 text-dbzs-green"
                  : "text-dbzs-muted hover:bg-dbzs-cyan/10 hover:text-dbzs-cyan"
              }`}
              onClick={() => setAutoRefresh((v) => !v)}
              title={autoRefresh ? "Auto-Refresh an (alle 10s)" : "Auto-Refresh aus"}
              type="button"
            >
              <svg fill="none" height="11" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="11">
                <path d="M4 4v6h6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 20v-6h-6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L4 10M19 14l-1.64 4.36A9 9 0 0 1 3.51 15" strokeLinecap="round" />
              </svg>
            </button>
            {/* Help tooltip */}
            <span
              aria-label="Explorer-Steuerung: Linksklick öffnet/klappt auf, Rechtsklick = Menü, Doppelklick = Umbenennen, Ctrl+Klick = Mehrfachauswahl"
              className="has-help-tooltip grid h-6 w-6 place-items-center rounded text-[9px] text-dbzs-muted/50 hover:text-dbzs-muted"
              data-help="Linksklick öffnet/klappt auf · Rechtsklick = Menü · Doppelklick = Umbenennen · Ctrl+Klick = Mehrfachauswahl"
              role="img"
              tabIndex={0}
            >?</span>
          </div>
        </div>

        {/* Row 2: Sticky project header + breadcrumb */}
        {state.projectName && (
          <div className="border-t border-dbzs-border/50 bg-dbzs-bg/30 px-3 py-1.5">
            <p className="truncate text-[11px] font-medium text-dbzs-text">
              {state.projectName}
            </p>
            {breadcrumb && breadcrumb.length > 0 && (
              <div className="mt-0.5 flex flex-wrap items-center gap-0.5 text-[10px] text-dbzs-muted">
                {breadcrumb.map((part, i) => (
                  <span key={i} className="flex items-center gap-0.5">
                    {i > 0 && <span className="opacity-30 select-none">›</span>}
                    <span className={i === breadcrumb.length - 1 ? "text-dbzs-cyan" : ""}>{part}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Row 3: filter */}
        <div className="flex gap-1 border-t border-dbzs-border/50 px-2 py-1.5">
          <div className="relative flex-1">
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dbzs-muted/50"
              fill="none"
              height="10"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="10"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
            </svg>
            <input
              aria-label="Dateinamen filtern"
              className="h-6 w-full rounded border border-dbzs-border bg-dbzs-bg pl-6 pr-2 text-[11px] text-dbzs-text placeholder:text-dbzs-muted/50 focus:border-dbzs-cyan/50 focus:outline-none"
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filtern…"
              value={filterQuery}
            />
          </div>
          <select
            aria-label="Dateityp filtern"
            className="h-6 rounded border border-dbzs-border bg-dbzs-bg px-1 text-[11px] text-dbzs-text focus:border-dbzs-cyan/50 focus:outline-none"
            onChange={(e) => setTypeFilter(e.target.value)}
            value={typeFilter}
          >
            <option value="all">Alle</option>
            {extensions.map((ext) => (
              <option key={ext} value={ext}>.{ext}</option>
            ))}
          </select>
        </div>

        {/* Row 4: action buttons */}
        <div className="flex flex-wrap gap-1 border-t border-dbzs-border/50 px-2 py-1.5">
          <ExplorerActionBtn disabled={isLoading} onClick={() => void createProject()}>
            <svg fill="none" height="9" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="9">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            Projekt
          </ExplorerActionBtn>
          <ExplorerActionBtn disabled={isLoading} onClick={() => void openWorkspace()}>
            <svg fill="none" height="9" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="9">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Öffnen
          </ExplorerActionBtn>
          {state.projectPath && (
            <>
              <ExplorerActionBtn disabled={isLoading} onClick={() => void useWorkspaceStore.getState().createNewFile()}>
                Datei neu
              </ExplorerActionBtn>
              <ExplorerActionBtn disabled={isLoading} onClick={() => void useWorkspaceStore.getState().createNewFolder()}>
                Ordner neu
              </ExplorerActionBtn>
              <ExplorerActionBtn disabled={isLoading} onClick={() => void scanFiles()}>
                <svg fill="none" height="9" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="9">
                  <path d="M4 4v6h6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20 20v-6h-6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L4 10M19 14l-1.64 4.36A9 9 0 0 1 3.51 15" strokeLinecap="round" />
                </svg>
                Scan
              </ExplorerActionBtn>
              <ExplorerActionBtn disabled={isLoading} onClick={() => void useWorkspaceStore.getState().saveWorkspace()}>
                Speichern
              </ExplorerActionBtn>
            </>
          )}
        </div>

        {/* Batch selection bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 border-t border-dbzs-amber/20 bg-dbzs-amber/5 px-3 py-1 text-[11px] text-dbzs-amber">
            <span className="font-medium">{selectedIds.size} ausgewählt</span>
            <button
              className="ml-1 rounded px-1.5 py-0.5 hover:bg-dbzs-amber/10 hover:underline"
              onClick={() => void handleBatchDelete()}
              type="button"
            >
              Löschen
            </button>
            <button
              className="ml-auto grid h-4 w-4 place-items-center rounded hover:bg-dbzs-amber/10"
              onClick={() => setSelectedIds(new Set())}
              type="button"
              aria-label="Auswahl aufheben"
            >
              <svg fill="none" height="8" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" width="8">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        {/* Undo delete bar */}
        {lastDeletedItem && (
          <div className="flex items-center justify-between gap-2 border-t border-dbzs-border bg-dbzs-panelSoft px-3 py-1 text-[11px] text-dbzs-muted">
            <span className="min-w-0 truncate">
              Gelöscht: <span className="text-dbzs-text">{lastDeletedItem.label}</span>
            </span>
            <button
              className="shrink-0 rounded border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[10px] text-dbzs-text hover:border-dbzs-cyan/40 hover:text-dbzs-cyan disabled:opacity-40"
              disabled={actionBusy}
              onClick={() => void handleRestoreDelete()}
              type="button"
            >
              Rückgängig
            </button>
          </div>
        )}
      </header>

      {/* ════════════════════════════════════════════════
          PATCH PREVIEW
          ════════════════════════════════════════════════ */}
      {pendingPatch && (
        <div className="shrink-0 border-b border-dbzs-border bg-dbzs-panelSoft">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-dbzs-text">
                Diff-Vorschau: {pendingPatch.label}
              </div>
              <div className="text-[10px] text-dbzs-muted">
                Änderung erst nach Bestätigung angewendet.
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ExplorerActionBtn disabled={actionBusy} onClick={() => void handleApplyPatch()}>
                Anwenden
              </ExplorerActionBtn>
              <ExplorerActionBtn disabled={actionBusy} onClick={() => setPendingPatch(null)}>
                Verwerfen
              </ExplorerActionBtn>
              <ExplorerActionBtn disabled={actionBusy} onClick={() => void handleRestorePatch()}>
                Snapshot
              </ExplorerActionBtn>
            </div>
          </div>
          <div className="px-3 pb-2">
            <textarea
              className="h-20 w-full resize-y rounded border border-dbzs-border bg-dbzs-bg p-2 text-[11px] text-dbzs-text focus:border-dbzs-cyan/50 focus:outline-none"
              onChange={(e) => void handlePatchContentChange(e.target.value)}
              value={pendingPatch.afterContent}
            />
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-dbzs-border bg-dbzs-bg p-2 text-[10px] text-dbzs-text">
              {pendingPatch.diff}
            </pre>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════
          TREE LIST
          ════════════════════════════════════════════════ */}
      <div
        aria-activedescendant={focusedIndex >= 0 && rows[focusedIndex] ? `workspace-treeitem-${rows[focusedIndex].id}` : undefined}
        aria-label="Workspace-Dateibaum"
        className={embeddedInPanel ? "py-1 text-xs" : "min-h-0 flex-1 overflow-auto py-1 text-xs"}
        ref={listRef}
        role="tree"
      >
        {/* ── Codee Artifacts ── */}
        {reviewArtifacts.length > 0 && !filterQuery && typeFilter === "all" && (
          <div className="mb-1.5">
            <ExplorerSectionHeader label="Codee Artefakte" />
            <div className="px-2 pt-0.5 text-[10px] text-dbzs-muted/60">Reviews</div>
            {reviewArtifacts.map((review) => (
              <div
                className="mx-2 mb-1 rounded border border-dbzs-border/50 bg-dbzs-bg/40 px-2 py-1.5"
                key={review.reviewId}
              >
                <div className="truncate text-[10px] font-medium text-dbzs-text">
                  {review.reviewId}
                  <span className="ml-1.5 text-dbzs-muted/60">{review.outcome ?? review.status}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    className="rounded px-1.5 py-0.5 text-[10px] text-dbzs-cyan hover:bg-dbzs-cyan/10"
                    onClick={() => void openReviewArtifact(review.reviewId, "report")}
                    type="button"
                  >
                    Report
                  </button>
                  <button
                    className="rounded px-1.5 py-0.5 text-[10px] text-dbzs-cyan hover:bg-dbzs-cyan/10"
                    onClick={() => void openReviewArtifact(review.reviewId, "findings")}
                    type="button"
                  >
                    Findings
                  </button>
                  <button
                    className="rounded px-1.5 py-0.5 text-[10px] text-dbzs-cyan hover:bg-dbzs-cyan/10"
                    onClick={() => state.projectPath && void window.dbzs.revealReviewArtifacts?.(state.projectPath, review.reviewId)}
                    type="button"
                  >
                    Ordner
                  </button>
                </div>
              </div>
            ))}
            <div className="my-1 border-t border-dbzs-border/40" />
          </div>
        )}

        {/* ── Pinned files ── */}
        {pinnedRows.length > 0 && (
          <div className="mb-1">
            <ExplorerSectionHeader label="Angeheftet" />
            {pinnedRows.map((f) => {
              const chip = fileChip(f);
              const isActive = activeTab?.type === "file" && activeTab.path === f.path;
              return (
                <button
                  className={`flex ${rowHeight} w-full items-center gap-2 pl-3 pr-2 text-left transition-colors ${
                    isActive
                      ? "bg-dbzs-cyan/10 text-dbzs-text"
                      : "text-dbzs-muted hover:bg-dbzs-panelSoft hover:text-dbzs-text"
                  }`}
                  key={f.path}
                  onClick={() => void openFile(f)}
                  onContextMenu={(e) => { const node = rows.find((r) => r.file?.path === f.path); openContextMenu(e, node ?? null); }}
                  type="button"
                >
                  <span className="shrink-0 text-[10px] text-dbzs-amber">📌</span>
                  <span className={`shrink-0 w-5 text-[10px] ${chip.color}`}>{chip.label}</span>
                  <span className="min-w-0 truncate text-[11px]">{f.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Recent files ── */}
        {recentRows.length > 0 && !filterQuery && typeFilter === "all" && (
          <div className="mb-1">
            <ExplorerSectionHeader label="Zuletzt geöffnet" />
            {recentRows.slice(0, 5).map((f) => {
              const chip = fileChip(f);
              const isActive = activeTab?.type === "file" && activeTab.path === f.path;
              return (
                <button
                  className={`flex ${rowHeight} w-full items-center gap-2 pl-3 pr-2 text-left transition-colors ${
                    isActive
                      ? "bg-dbzs-cyan/10 text-dbzs-text"
                      : "text-dbzs-muted hover:bg-dbzs-panelSoft hover:text-dbzs-text"
                  }`}
                  key={f.path}
                  onClick={() => void openFile(f)}
                  type="button"
                >
                  <span className="shrink-0 text-[10px] text-dbzs-muted/50">🕐</span>
                  <span className={`shrink-0 w-5 text-[10px] ${chip.color}`}>{chip.label}</span>
                  <span className="min-w-0 truncate text-[11px]">{f.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {(pinnedRows.length > 0 || recentRows.length > 0) && !filterQuery && (
          <div className="my-1 border-t border-dbzs-border/40" />
        )}

        {/* ── Main tree ── */}
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-dbzs-muted">
            {isLoading ? (
              <div className="flex items-center gap-2 text-[11px]">
                <svg className="h-3.5 w-3.5 animate-spin text-dbzs-cyan" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
                </svg>
                Scanne Projekt…
              </div>
            ) : filterQuery ? (
              <div className="text-[11px]">
                <div className="text-dbzs-muted">Keine Treffer für „{filterQuery}"</div>
                <button
                  className="mt-2 text-[10px] text-dbzs-cyan hover:underline"
                  onClick={() => setFilterQuery("")}
                  type="button"
                >
                  Filter zurücksetzen
                </button>
              </div>
            ) : state.projectPath ? (
              <div className="space-y-2 text-[11px]">
                <p>Workspace offen, Dateibaum leer.</p>
                <div className="rounded border border-dbzs-border bg-dbzs-bg/50 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-dbzs-muted/60">Pfad</div>
                  <div className="mt-0.5 break-all text-dbzs-text">{state.projectPath}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <ExplorerActionBtn onClick={() => void scanFiles()}>Erneut scannen</ExplorerActionBtn>
                  <ExplorerActionBtn onClick={() => setShowScanDiag((v) => !v)}>Diagnose</ExplorerActionBtn>
                  <ExplorerActionBtn disabled={actionBusy} onClick={() => void handleScanDiag()}>
                    Git-Status
                  </ExplorerActionBtn>
                </div>
                <div className="text-[10px] text-dbzs-muted/50">
                  Ignoriert: {SCAN_IGNORED.join(", ")}
                </div>
                {showScanDiag && (
                  <div className="rounded border border-dbzs-border bg-dbzs-bg/50 p-2 text-[11px]">
                    <div>Status: {status} · Dateien: {files.length}</div>
                    {scanDiagOutput && (
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap border border-dbzs-border bg-dbzs-bg p-1 text-[10px]">
                        {scanDiagOutput}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3 text-[11px]">
                <div className="text-dbzs-muted">Noch kein Projekt geöffnet.</div>
                <div className="flex gap-1">
                  <ExplorerActionBtn disabled={isLoading} onClick={() => void createProject()}>
                    Neues Projekt
                  </ExplorerActionBtn>
                  <ExplorerActionBtn disabled={isLoading} onClick={() => void openWorkspace()}>
                    Öffnen
                  </ExplorerActionBtn>
                </div>
              </div>
            )}
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
            // Indentation via inline style for correct depth rendering
            const indent = node.depth * 12;

            return (
              <div
                className={`workspace-tree-row has-help-tooltip group flex ${rowHeight} w-full items-center gap-1 pr-2 text-left transition-colors ${
                  isDragTarget
                    ? "bg-dbzs-cyan/20 outline outline-1 outline-dashed outline-dbzs-cyan/60"
                    : isSelected
                    ? "bg-dbzs-amber/10 text-dbzs-text"
                    : isActive
                    ? "bg-dbzs-cyan/[0.12] text-dbzs-text"
                    : isFocused
                    ? "bg-dbzs-panelSoft text-dbzs-text outline outline-1 outline-dbzs-cyan/30"
                    : "text-dbzs-muted hover:bg-dbzs-panelSoft hover:text-dbzs-text"
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
                aria-current={isActive ? "true" : undefined}
                aria-expanded={node.type === "folder" ? !collapsed.has(node.id) : undefined}
                aria-label={node.type === "file" ? `Datei ${node.name}` : `Ordner ${node.name}`}
                aria-selected={isSelected || isActive}
                aria-level={node.depth + 1}
                id={`workspace-treeitem-${node.id}`}
                role="treeitem"
                style={{ paddingLeft: `${indent + 8}px` }}
                tabIndex={-1}
              >
                {/* Expand/collapse chevron or file type icon */}
                <span className={`shrink-0 text-[10px] ${chip ? chip.color : "text-dbzs-muted/60"}`}>
                  {node.type === "folder" ? (
                    <svg
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 transition-transform ${collapsed.has(node.id) ? "" : "rotate-90"}`}
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  ) : (
                    chip?.label ?? "·"
                  )}
                </span>

                {/* Name or inline rename input */}
                {isRenaming ? (
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-dbzs-cyan/60 bg-dbzs-bg px-1 py-0 text-[11px] text-dbzs-text outline-none"
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
                  <span className="min-w-0 flex-1 truncate text-[11px]">{node.name}</span>
                )}

                {/* Pin indicator */}
                {isPinned && (
                  <span aria-label="Angeheftet" className="shrink-0 text-[9px] text-dbzs-amber/70">📌</span>
                )}

                {/* Git badge */}
                {gitBadge && (
                  <span
                    className={`shrink-0 text-[10px] font-semibold tabular-nums ${
                      gitBadge === "M" ? "text-dbzs-amber" :
                      gitBadge === "+" ? "text-dbzs-green" :
                      gitBadge === "U" ? "text-dbzs-muted/60" :
                      gitBadge === "D" ? "text-dbzs-red" :
                      gitBadge === "R" ? "text-dbzs-cyan/70" :
                      gitBadge === "!" ? "text-red-400" :
                      "text-dbzs-muted"
                    }`}
                    title={
                      gitBadge === "M" ? "Geändert" :
                      gitBadge === "+" ? "Hinzugefügt" :
                      gitBadge === "U" ? "Unverfolgt" :
                      gitBadge === "D" ? "Gelöscht" :
                      gitBadge === "R" ? "Umbenannt" :
                      gitBadge === "!" ? "Konflikt" :
                      ""
                    }
                  >
                    {gitBadge}
                  </span>
                )}

                {/* Folder file count */}
                {node.type === "folder" && folderStats && (
                  <span className="shrink-0 text-[9px] text-dbzs-muted/40 tabular-nums">
                    {folderStats.files}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ════════════════════════════════════════════════
          STATUS BAR
          ════════════════════════════════════════════════ */}
      <footer className="shrink-0 border-t border-dbzs-border bg-dbzs-panelSoft">
        {/* Error messages */}
        {(error ?? actionError) && (
          <div className="flex items-center gap-2 border-b border-dbzs-border px-3 py-1 text-[11px] text-dbzs-red">
            <svg aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path clipRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" fillRule="evenodd" />
            </svg>
            <span className="truncate">{error ?? actionError}</span>
          </div>
        )}
        {/* Empty scan result */}
        {status === "empty" && !error && (
          <div className="px-3 py-1 text-[11px] text-dbzs-muted">
            Keine scanbaren Dateien.
          </div>
        )}
        {/* File count + refresh indicator */}
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-[10px] text-dbzs-muted/50 tabular-nums">
            {files.length} {files.length === 1 ? "Datei" : "Dateien"}
          </span>
          {autoRefresh && (
            <span className="flex items-center gap-1 text-[10px] text-dbzs-green/70">
              <span aria-hidden="true" className="dbzs-animate-status-pulse h-1.5 w-1.5 rounded-full bg-dbzs-green" />
              Auto-Refresh aktiv
            </span>
          )}
        </div>
      </footer>

      {/* ════════════════════════════════════════════════
          CONTEXT MENU
          ════════════════════════════════════════════════ */}
      {contextMenu && (
        <ContextMenu
          items={buildWorkspaceExplorerCommands(
            {
              target: contextMenu.target,
              hasWorkspace: Boolean(state.projectPath),
              targetPinned: Boolean(
                contextMenu.target?.type === "file" &&
                  contextMenu.target.file &&
                  pinned.has(contextMenu.target.file.path)
              ),
              folderCollapsed: Boolean(
                contextMenu.target?.type === "folder" && collapsed.has(contextMenu.target.id)
              )
            },
            {
              open: () => void handleOpenTarget(),
              newFile: handleCreateFile,
              newFolder: handleCreateFolder,
              rename: handleRenamePath,
              move: () => {
                if (contextMenu.target) openMoveDialog(contextMenu.target);
              },
              duplicate: handleDuplicate,
              delete: handleDeletePath,
              copyRelativePath: () => {
                if (contextMenu.target) void copyPath(contextMenu.target, false);
              },
              copyAbsolutePath: () => {
                if (contextMenu.target) void copyPath(contextMenu.target, true);
              },
              reveal: handleOpenInExplorer,
              pin: () => {
                if (contextMenu.target) togglePin(contextMenu.target);
              },
              sendToAgent: () => {
                if (contextMenu.target) sendToAgent(contextMenu.target);
              },
              preparePatch: handlePreparePatch
            }
          ).map((command) => ({
            label: command.label,
            action: command.action,
            disabled: command.disabled,
            danger: command.danger
          }))}
          onClose={() => setContextMenu(null)}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}

      {/* ════════════════════════════════════════════════
          MOVE DIALOG
          ════════════════════════════════════════════════ */}
      {moveDialogNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onMouseDown={() => setMoveDialogNode(null)} role="presentation">
          <div
            aria-labelledby="workspace-move-dialog-title"
            aria-modal="true"
            className="w-80 rounded border border-dbzs-border bg-dbzs-panel shadow-panel"
            onMouseDown={(event) => event.stopPropagation()}
            ref={moveDialogRef}
            role="dialog"
          >
            <div className="border-b border-dbzs-border px-4 py-3">
              <h3 className="text-xs font-semibold text-dbzs-text" id="workspace-move-dialog-title">
                „{moveDialogNode.name}" verschieben
              </h3>
            </div>
            <div className="px-4 py-3">
              <label className="mb-1.5 block text-[11px] text-dbzs-muted">
                Zielordner (relativer Pfad)
              </label>
              <select
                className="w-full rounded border border-dbzs-border bg-dbzs-bg px-2 py-1.5 text-[11px] text-dbzs-text focus:border-dbzs-cyan/50 focus:outline-none"
                onChange={(e) => setMoveTarget(e.target.value)}
                ref={moveSelectRef}
                value={moveTarget}
              >
                <option value="">— Ordner wählen —</option>
                {allFolderIds(tree).map((fid) => (
                  <option key={fid} value={fid}>{fid}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 border-t border-dbzs-border px-4 py-3">
              <button
                className="flex-1 rounded border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-2 py-1.5 text-[11px] text-dbzs-cyan hover:bg-dbzs-cyan/20 disabled:opacity-40"
                disabled={!moveTarget || actionBusy}
                onClick={() => void handleMove()}
                type="button"
              >
                Verschieben
              </button>
              <button
                className="flex-1 rounded border border-dbzs-border bg-dbzs-bg px-2 py-1.5 text-[11px] text-dbzs-muted hover:text-dbzs-text"
                onClick={() => setMoveDialogNode(null)}
                type="button"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════
          HOVER PREVIEW
          ════════════════════════════════════════════════ */}
      {hoverPreview && (
        <div
          className="pointer-events-none fixed z-40 w-72 rounded border border-dbzs-border bg-dbzs-panel shadow-panel"
          style={{
            left: Math.min(hoverPreview.x + 12, window.innerWidth - 300),
            top: Math.min(hoverPreview.y, window.innerHeight - 200)
          }}
        >
          <div className="border-b border-dbzs-border px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-dbzs-muted/60">
            Vorschau
          </div>
          <pre className="max-h-40 overflow-hidden whitespace-pre-wrap break-words p-2 text-[10px] leading-4 text-dbzs-text">
            {hoverPreview.loading ? (
              <span className="text-dbzs-muted/60">Lädt…</span>
            ) : (
              hoverPreview.content ?? <span className="text-dbzs-muted/40">Kein Inhalt</span>
            )}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local helper sub-components
// ---------------------------------------------------------------------------

function ExplorerSectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-dbzs-muted/50">
        {label}
      </span>
      <div className="h-px flex-1 bg-dbzs-border/40" />
    </div>
  );
}

function ExplorerActionBtn({
  children,
  disabled,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className="flex items-center gap-1 rounded border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-muted transition-colors hover:border-dbzs-cyan/30 hover:bg-dbzs-cyan/5 hover:text-dbzs-text disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
