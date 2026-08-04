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
          {activeTab?.isDirty ? (
            <span aria-label="Ungespeicherte Änderungen" className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-dbzs-amber align-middle" title="Ungespeicherte Änderungen" />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 border border-dbzs-border bg-dbzs-panel px-3 py-1.5 text-xs text-dbzs-text"
            onClick={() => void openFile()}
            type="button"
          >
            <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Oeffnen
          </button>
          <button
            className="flex items-center gap-1.5 border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1.5 text-xs font-medium text-dbzs-cyan disabled:opacity-40"
            disabled={!activeTab || editorBusy}
            onClick={() => void saveActiveFileAs()}
            type="button"
          >
            <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M17 21v-8H7v8M7 3v5h8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Speichern unter
          </button>
          <button
            className="flex items-center gap-1.5 border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1.5 text-xs font-medium text-dbzs-cyan disabled:opacity-40"
            disabled={!activeTab || !activeTab.isDirty || editorBusy}
            onClick={() => void saveActiveFile()}
            type="button"
          >
            <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M17 21v-8H7v8M7 3v5h8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {activeTab?.source === "workspace" ? "Diff prüfen" : "Speichern"}
          </button>
        </div>
      </div>
      {activeTab ? (
        <div className="flex h-6 shrink-0 items-center gap-1 overflow-x-auto border-b border-dbzs-border bg-dbzs-bg/60 px-4 text-[10px] text-dbzs-muted">
          {breadcrumbSegments(activeTab.path).map((segment, index, segments) => (
            <span className="flex shrink-0 items-center gap-1" key={`${segment}-${index}`}>
              {index > 0 ? (
                <svg aria-hidden="true" className="h-2.5 w-2.5 text-dbzs-muted/50" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              ) : null}
              <span className={index === segments.length - 1 ? "text-dbzs-text" : ""}>{segment}</span>
            </span>
          ))}
        </div>
      ) : null}
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
              <button className="flex items-center gap-1.5 px-3" onClick={() => selectTab(tab.id)} type="button">
                {tab.isDirty ? (
                  <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-dbzs-amber" />
                ) : null}
                {tab.name}
              </button>
              <button
                className="border-l border-dbzs-border px-2 text-dbzs-muted hover:text-dbzs-text"
                onClick={() => closeTab(tab.id)}
                title="Tab schliessen"
                type="button"
              >
                <svg aria-hidden="true" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
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
                className="flex items-center gap-1 border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[11px] text-dbzs-cyan disabled:opacity-40"
                disabled={editorBusy}
                onClick={() => void applyPendingChange(activePendingChange.filePath)}
                type="button"
              >
                <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Anwenden
              </button>
              <button
                className="flex items-center gap-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text disabled:opacity-40"
                disabled={editorBusy}
                onClick={() => discardPendingChange(activePendingChange.filePath)}
                type="button"
              >
                <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
                Verwerfen
              </button>
              <button
                className="flex items-center gap-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text disabled:opacity-40"
                disabled={editorBusy}
                onClick={() => void restoreSnapshot(activePendingChange.snapshotId)}
                type="button"
              >
                <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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

function breadcrumbSegments(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
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
