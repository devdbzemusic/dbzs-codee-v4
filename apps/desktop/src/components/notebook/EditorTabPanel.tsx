import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ensureMonacoConfigured } from "@/monaco";
import type { EditorTab, PendingFileChangeState } from "@/stores/editorStore";
import { ContextMenu } from "@/components/ui/ContextMenu";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

export type EditorTabPanelProps = {
  activePendingChange: PendingFileChangeState | null;
  activeTab: EditorTab | null;
  editorBusy: boolean;
  editorFontSize: number;
  editorTheme: "dark" | "light";
  tabs: EditorTab[];
  applyPendingChange: (filePath: string) => Promise<void>;
  closeTab: (tabId: string) => void;
  discardPendingChange: (filePath: string) => void;
  openFile: () => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  saveActiveFile: () => Promise<void>;
  saveActiveFileAs: () => Promise<void>;
  selectTab: (tabId: string) => void;
  updateActiveContent: (content: string) => void;
};

export function EditorTabPanel({
  activePendingChange,
  activeTab,
  editorBusy,
  editorFontSize,
  editorTheme,
  tabs,
  applyPendingChange,
  closeTab,
  discardPendingChange,
  openFile,
  restoreSnapshot,
  saveActiveFile,
  saveActiveFileAs,
  selectTab,
  updateActiveContent
}: EditorTabPanelProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string | null } | null>(null);

  const tabMenuItems = useMemo(() => {
    if (!contextMenu?.tabId) return [];
    const target = tabs.find((tab) => tab.id === contextMenu.tabId);
    if (!target) return [];

    const items: Array<null | { label: string; action: () => void | Promise<void>; disabled?: boolean; danger?: boolean }> = [];
    items.push({ label: "Tab schließen", action: () => closeTab(target.id) });
    items.push({ label: "Alle anderen schließen", action: () => tabs.filter((tab) => tab.id !== target.id).forEach((tab) => closeTab(tab.id)) });
    items.push({ label: "Alle schließen", action: () => tabs.forEach((tab) => closeTab(tab.id)) });
    items.push(null);
    items.push({ label: target.isDirty ? "Speichern" : "Nur anzeigen", action: () => {
      if (target.isDirty) {
        void saveActiveFile();
      } else {
        selectTab(target.id);
      }
    } });
    items.push({ label: "Pfad kopieren", action: async () => {
      await navigator.clipboard.writeText(target.path);
    } });
    items.push({ label: "Im Explorer anzeigen", action: () => {
      void window.dbzs.openInSystemExplorer?.(target.path);
    } });
    return items;
  }, [closeTab, contextMenu?.tabId, saveActiveFile, selectTab, tabs]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-dbzs-border px-4">
        <div className="min-w-0 text-sm font-medium">
          {activeTab ? activeTab.name : "Editor"}
          {activeTab?.isDirty ? <span className="text-dbzs-amber"> *</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="border border-dbzs-border bg-dbzs-panel px-3 py-1.5 text-xs text-dbzs-text"
            onClick={() => void openFile()}
            type="button"
          >
            Oeffnen
          </button>
          <button
            className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1.5 text-xs font-medium text-dbzs-cyan disabled:opacity-40"
            disabled={!activeTab || editorBusy}
            onClick={() => void saveActiveFileAs()}
            type="button"
          >
            Speichern unter
          </button>
          <button
            className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1.5 text-xs font-medium text-dbzs-cyan disabled:opacity-40"
            disabled={!activeTab || !activeTab.isDirty || editorBusy}
            onClick={() => void saveActiveFile()}
            type="button"
          >
            {activeTab?.source === "workspace" ? "Diff prüfen" : "Speichern"}
          </button>
        </div>
      </div>
      {tabs.length > 0 ? (
        <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-dbzs-border bg-dbzs-panel px-2">
          {tabs.map((tab) => (
            <div
              className={`flex h-7 items-center border text-xs ${
                activeTab?.id === tab.id
                  ? "border-dbzs-cyan/60 bg-dbzs-cyan/10 text-dbzs-text"
                  : "border-dbzs-border bg-dbzs-panelSoft text-dbzs-muted"
              }`}
              key={tab.id}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
              }}
            >
              <button className="px-3" onClick={() => selectTab(tab.id)} type="button">
                {tab.isDirty ? "* " : ""}
                {tab.name}
              </button>
              <button
                className="border-l border-dbzs-border px-2 text-dbzs-muted hover:text-dbzs-text"
                onClick={() => closeTab(tab.id)}
                title="Tab schliessen"
                type="button"
              >
                x
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {activePendingChange ? (
        <div className="shrink-0 border-b border-dbzs-border bg-dbzs-panel px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-dbzs-text">
                Diff-Vorschau: {activePendingChange.label}
              </div>
              <div className="text-[11px] text-dbzs-muted">Änderung wird erst nach Bestätigung geschrieben.</div>
              <div className="mt-1 text-[11px] text-dbzs-muted">
                Quelle:{" "}
                {activePendingChange.source === "agent"
                  ? `Agent (${activePendingChange.agentId ?? "unbekannt"})`
                  : "Editor"}
              </div>
              {activePendingChange.source === "agent" && activePendingChange.reason ? (
                <div className="truncate text-[11px] text-dbzs-muted">Grund: {activePendingChange.reason}</div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[11px] text-dbzs-cyan disabled:opacity-40"
                disabled={editorBusy}
                onClick={() => void applyPendingChange(activePendingChange.filePath)}
                type="button"
              >
                Anwenden
              </button>
              <button
                className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text disabled:opacity-40"
                disabled={editorBusy}
                onClick={() => discardPendingChange(activePendingChange.filePath)}
                type="button"
              >
                Verwerfen
              </button>
              <button
                className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text disabled:opacity-40"
                disabled={editorBusy}
                onClick={() => void restoreSnapshot(activePendingChange.snapshotId)}
                type="button"
              >
                Wiederherstellen
              </button>
            </div>
          </div>
          <pre className="max-h-[min(240px,35vh)] overflow-y-auto whitespace-pre-wrap break-words border border-dbzs-border bg-dbzs-bg p-2 text-[11px] text-dbzs-muted">
            {activePendingChange.diff}
          </pre>
        </div>
      ) : null}
      {contextMenu && (
        <ContextMenu
          items={tabMenuItems}
          onClose={() => setContextMenu(null)}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab ? (
          <MonacoEditorPane
            content={activeTab.content}
            editorFontSize={editorFontSize}
            editorTheme={editorTheme}
            language={activeTab.language}
            onChange={updateActiveContent}
            path={activeTab.path}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-dbzs-muted">
            Keine Datei geoeffnet. Oeffne eine Datei im Explorer oder mit Strg+O.
          </div>
        )}
      </div>
    </div>
  );
}

type MonacoEditorPaneProps = {
  content: string;
  editorFontSize: number;
  editorTheme: "dark" | "light";
  language: string;
  path: string;
  onChange: (content: string) => void;
};

function MonacoEditorPane({ content, editorFontSize, editorTheme, language, onChange, path }: MonacoEditorPaneProps) {
  const [monacoReady, setMonacoReady] = useState(false);
  const [monacoError, setMonacoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void ensureMonacoConfigured()
      .then(() => {
        if (!cancelled) {
          setMonacoReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMonacoError(error instanceof Error ? error.message : "Monaco konnte nicht geladen werden.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (monacoError) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-dbzs-red">
        Editor-Fehler: {monacoError}
      </div>
    );
  }

  if (!monacoReady) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-dbzs-muted">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-dbzs-cyan/30 border-t-dbzs-cyan" />
        <p>Monaco-Editor wird geladen …</p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center p-8 text-sm text-dbzs-muted">
          Editor-Oberfläche wird vorbereitet …
        </div>
      }
    >
      <div className="h-full min-h-[240px] w-full">
        <MonacoEditor
          height="100%"
          language={language}
          onChange={(value) => onChange(value ?? "")}
          options={{
            automaticLayout: true,
            fontSize: Math.max(12, editorFontSize),
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on"
          }}
          path={path}
          theme={editorTheme === "light" ? "vs" : "vs-dark"}
          value={content}
        />
      </div>
    </Suspense>
  );
}
