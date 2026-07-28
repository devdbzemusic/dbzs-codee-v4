import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn()
});
import type { RuntimeChatAttachment, WorkspaceFile, WorkspaceProjectFile } from "@dbzs/shared";
import { RuntimeChatTab, stripPrivateReasoning } from "@/components/RuntimeChatTab";
import { mergeAssistantMessageState, useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { buildWorkspaceContext, buildWorkspaceContextSystemMessage } from "@/services/runtimeChatContext";
import {
  buildAgentImplementationPrompt,
  buildJobTakeoverRequest,
  executeAssistantTakeover
} from "@/services/runtimeChatTakeover";

const enqueueJobMock = vi.fn();

describe("safe execution trace rendering", () => {
  it("removes complete and streaming private reasoning blocks", () => {
    expect(stripPrivateReasoning("<think>private tokens</think>Visible")).toBe("Visible");
    expect(stripPrivateReasoning("Visible<analysis>unfinished secret")).toBe("Visible");
    expect(stripPrivateReasoning("<reasoning-summary>legacy</reasoning-summary>Answer")).toBe("Answer");
  });
});

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    enqueueJob: (...args: unknown[]) => enqueueJobMock(...args)
  }
}));

function projectFile(path: string, relativePath: string, language: string): WorkspaceProjectFile {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  const name = segments.at(-1) ?? relativePath;
  return {
    path,
    relativePath,
    name,
    language
  };
}

describe("RuntimeChatTab patch card", () => {
  beforeEach(() => {
    window.dbzs = {
      ...window.dbzs,
      openChatAttachmentDialog: vi.fn(),
      prepareClipboardChatAttachments: vi.fn()
    };
    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-1",
        role: "assistant",
        content: "Ich prüfe die Datei.",
        patchProposalId: "prop-1",
        actions: [{
          id: "act-approve",
          runId: "run-1",
          messageId: "msg-1",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "approve_patch",
          title: "Übernehmen",
          state: "pending",
          payload: { proposalId: "prop-1" },
          createdAt: new Date().toISOString()
        }, {
          id: "act-reject",
          runId: "run-1",
          messageId: "msg-1",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "reject_patch",
          title: "Ablehnen",
          state: "pending",
          payload: { proposalId: "prop-1" },
          createdAt: new Date().toISOString()
        }]
      }],
      patchProposalsById: {
        "prop-1": {
          id: "prop-1",
          runId: "run-1",
          title: "Fix add implementation",
          summary: "Replace subtraction with addition.",
          changes: [{
            id: "change-1",
            runId: "run-1",
            filePath: "src/math.ts",
            changeType: "modify",
            proposedContent: "export function add() { return 1; }",
            reason: "The function should add.",
            summary: "The function should add.",
            riskLevel: "low",
            requiresReview: true,
            createdAt: new Date().toISOString()
          }],
          createdAt: new Date().toISOString()
        }
      },
      patchPreviewsById: {
        "prop-1": {
          proposalId: "prop-1",
          state: "WAITING_FOR_APPROVAL",
          previews: [{
            changeId: "change-1",
            filePath: "src/math.ts",
            changeType: "modify",
            snapshotId: "snap-1",
            beforeContent: "export function add() { return 0; }",
            afterContent: "export function add() { return 1; }",
            diff: "- return 0\n+ return 1"
          }],
          approvalVersion: "v1",
          createdAt: new Date().toISOString()
        }
      },
      agentActionsById: {
        "prop-1": {
          kind: "patch",
          id: "prop-1",
          runId: "run-1",
          version: 1,
          riskLevel: "medium",
          state: "pending",
          proposalId: "prop-1"
        }
      },
      activePatchProposal: null,
      activePatchPreview: null,
      patchState: null,
      patchError: null,
      patchApplyResult: null,
      patchValidationResult: null
    });
  });

  it("renders the patch card and approval buttons inline for the assistant message", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    root.render(
      <RuntimeChatTab
        activeFile={null}
        status={{ state: "running", provider: "ollama", model_id: "phi", model_name: "phi", port: 1234, pid: 1, endpoint: "http://localhost:1234", message: "Runtime aktiv" }}
        workspaceRoot="D:/repo"
        workspaceName="dbzs-codee"
        workspaceFiles={[]}
      />
    );

    const state = useRuntimeChatStore.getState();
    expect(state.messages[0]?.patchProposalId).toBe("prop-1");
    expect(state.messages[0]?.actions?.map((action) => action.kind)).toEqual(expect.arrayContaining(["approve_patch", "reject_patch"]));

    expect(state.messages[0]?.actions?.some((action) => action.title === "Übernehmen")).toBe(true);
    expect(state.messages[0]?.actions?.some((action) => action.title === "Ablehnen")).toBe(true);

    root.unmount();
    container.remove();
  });

  it("shows a conversation-first empty state with natural examples", () => {
    useRuntimeChatStore.setState({
      messages: [],
      patchProposalsById: {},
      patchPreviewsById: {},
      agentActionsById: {},
      activePatchProposal: null,
      activePatchPreview: null,
      patchState: null,
      patchError: null,
      patchApplyResult: null,
      patchValidationResult: null
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <RuntimeChatTab
          activeFile={null}
          status={{ state: "running", provider: "ollama", model_id: "phi", model_name: "phi", port: 1234, pid: 1, endpoint: "http://localhost:1234", message: "Runtime aktiv" }}
          workspaceRoot="D:/repo"
          workspaceName="dbzs-codee"
          workspaceFiles={[]}
        />
      );
    });

    expect(container.textContent).toContain("Beschreibe einfach natürlich dein Ziel");
    expect(container.textContent).toContain("Wie weit bist du gerade?");
    expect(container.textContent).not.toContain("Skills oben aktivieren");

    root.unmount();
    container.remove();
  });

  it("renders plan approval buttons for a parsed plan proposal in the chat", () => {
    const merged = mergeAssistantMessageState({
      id: "msg-plan-ui",
      role: "assistant",
      content: ""
    }, {
      id: "msg-plan-ui",
      role: "assistant",
      content: `<plan>{"type":"agent_plan_proposal","version":1,"id":"plan-ui","runId":"run-ui","title":"Inspect the bug","summary":"Review the failing function and update it.","steps":[],"createdAt":"2026-01-01T00:00:00.000Z"}</plan>`
    }, { workspaceRoot: "D:/repo" });

    useRuntimeChatStore.setState({
      messages: [merged],
      patchProposalsById: {},
      patchPreviewsById: {},
      agentActionsById: {
        "plan-ui": {
          kind: "plan",
          id: "plan-ui",
          runId: "run-ui",
          version: 1,
          riskLevel: "medium",
          state: "pending",
          title: "Inspect the bug",
          summary: "Review the failing function and update it.",
          steps: []
        }
      },
      activePatchProposal: null,
      activePatchPreview: null,
      patchState: null,
      patchError: null,
      patchApplyResult: null,
      patchValidationResult: null
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <RuntimeChatTab
          activeFile={null}
          status={{ state: "running", provider: "ollama", model_id: "phi", model_name: "phi", port: 1234, pid: 1, endpoint: "http://localhost:1234", message: "Runtime aktiv" }}
          workspaceRoot="D:/repo"
          workspaceName="dbzs-codee"
          workspaceFiles={[]}
        />
      );
    });

    expect(container.textContent).toContain("Plan übernehmen");
    expect(container.textContent).toContain("Ablehnen");

    root.unmount();
    container.remove();
  });

  it("renders terminal approval notice from the agent action registry", () => {
    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-command",
        role: "assistant",
        content: "Command approval needed",
        actionIds: ["cmd-1"],
        actions: []
      }],
      patchProposalsById: {},
      patchPreviewsById: {},
      agentActionsById: {
        "cmd-1": {
          kind: "command",
          id: "cmd-1",
          runId: "run-command",
          version: 1,
          riskLevel: "medium",
          state: "pending",
          commandRequestId: "cmd-1"
        }
      },
      activePatchProposal: null,
      activePatchPreview: null,
      patchState: null,
      patchError: null,
      patchApplyResult: null,
      patchValidationResult: null
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <RuntimeChatTab
          activeFile={null}
          status={{ state: "running", provider: "ollama", model_id: "phi", model_name: "phi", port: 1234, pid: 1, endpoint: "http://localhost:1234", message: "Runtime aktiv" }}
          workspaceRoot="D:/repo"
          workspaceName="dbzs-codee"
          workspaceFiles={[]}
        />
      );
    });

    expect(container.textContent).toContain("Terminal-Freigabe");

    root.unmount();
    container.remove();
  });
});

describe("RuntimeChatTab file attachments", () => {
  beforeEach(() => {
    useRuntimeChatStore.setState({
      messages: [],
      patchProposalsById: {},
      patchPreviewsById: {},
      agentActionsById: {},
      activePatchProposal: null,
      activePatchPreview: null,
      patchState: null,
      patchError: null,
      patchApplyResult: null,
      patchValidationResult: null,
      isSending: false,
      isStreaming: false,
      error: null
    });
  });

  it("allows sending files selected from the file dialog", async () => {
    const sendMessageMock = vi.fn().mockResolvedValue(true);
    const attachment: RuntimeChatAttachment = {
      id: "img-1",
      name: "notes.md",
      kind: "text",
      extension: "md",
      mimeType: "text/markdown",
      dataUrl: "",
      textContent: "# Notes",
      derivedSummary: "7 Zeichen eingebunden",
      source: "file_dialog",
      sizeBytes: 4096
    };
    window.dbzs = {
      ...window.dbzs,
      openChatAttachmentDialog: vi.fn().mockResolvedValue([attachment]),
      prepareClipboardChatAttachments: vi.fn()
    };
    useRuntimeChatStore.setState({
      sendMessage: sendMessageMock
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <RuntimeChatTab
          activeFile={null}
          status={{ state: "running", provider: "ollama", model_id: "phi", model_name: "phi", port: 1234, pid: 1, endpoint: "http://localhost:1234", message: "Runtime aktiv" }}
          workspaceRoot="D:/repo"
          workspaceName="dbzs-codee"
          workspaceFiles={[]}
        />
      );
    });

    const imageButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Anhaengen")
    );
    expect(imageButton).toBeTruthy();

    await act(async () => {
      imageButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("notes.md");

    const sendButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Senden")
    ) as HTMLButtonElement | undefined;
    expect(sendButton?.disabled).toBe(false);

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(sendMessageMock).toHaveBeenCalledOnce();
    expect(sendMessageMock).toHaveBeenCalledWith(
      "Bitte analysiere die angehaengten Dateien.",
      expect.anything(),
      null,
      null,
      null,
      "runtime_chat",
      expect.objectContaining({
        hasImageInput: false,
        requiresVision: false,
        attachments: [attachment]
      })
    );

    root.unmount();
    container.remove();
  });

  it("accepts pasted clipboard files and shows a preview", async () => {
    class FileReaderMock {
      result: string | ArrayBuffer | null = null;
      onerror: null | (() => void) = null;
      onload: null | (() => void) = null;

      readAsDataURL(file: File) {
        this.result = `data:${file.type};base64,BBBB`;
        this.onload?.();
      }
    }

    vi.stubGlobal("FileReader", FileReaderMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <RuntimeChatTab
          activeFile={null}
          status={{ state: "running", provider: "ollama", model_id: "phi", model_name: "phi", port: 1234, pid: 1, endpoint: "http://localhost:1234", message: "Runtime aktiv" }}
          workspaceRoot="D:/repo"
          workspaceName="dbzs-codee"
          workspaceFiles={[]}
        />
      );
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();

    const file = new File(["hello"], "clip.txt", { type: "text/plain" });
    const preparedAttachment: RuntimeChatAttachment = {
      id: "clip-1",
      name: "clip.txt",
      kind: "text",
      extension: "txt",
      mimeType: "text/plain",
      dataUrl: "",
      textContent: "hello",
      source: "clipboard",
      sizeBytes: 5
    };
    window.dbzs.prepareClipboardChatAttachments = vi.fn().mockResolvedValue([preparedAttachment]);
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        items: [{
          kind: "file",
          type: "text/plain",
          getAsFile: () => file
        }]
      }
    });

    await act(async () => {
      textarea?.dispatchEvent(pasteEvent);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("clip.txt");
    expect(container.textContent).toContain("Zwischenablage");

    root.unmount();
    container.remove();
    vi.unstubAllGlobals();
  });
});

describe("buildWorkspaceContext", () => {
  beforeEach(() => {
    window.dbzs = {
      getAppInfo: vi.fn(),
      getBackendHealth: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      openFileDialog: vi.fn(),
      openImageFileDialog: vi.fn(),
      openChatAttachmentDialog: vi.fn(),
      prepareClipboardChatAttachments: vi.fn(),
      saveFile: vi.fn(),
      getModelIndex: vi.fn(),
      getRuntimeStatus: vi.fn(),
      startRuntimeModel: vi.fn(),
      stopRuntimeModel: vi.fn(),
      sendRuntimeChat: vi.fn(),
      listAgents: vi.fn().mockResolvedValue([]),
      getAgent: vi.fn(),
      createAgent: vi.fn(),
      updateAgent: vi.fn(),
      startAgent: vi.fn(),
      stopAgent: vi.fn(),
      deleteAgent: vi.fn(),
      listAgentLogs: vi.fn().mockResolvedValue([]),
      listProjectMemory: vi.fn().mockResolvedValue([]),
      upsertProjectMemory: vi.fn(),
      deleteProjectMemory: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      analyzeDocs: vi.fn(),
      generateDocs: vi.fn(),
      readProjectFile: vi.fn()
    };
  });

  it("returns null context when no workspace is open", async () => {
    const result = await buildWorkspaceContext(null, null, [], null);

    expect(result.context).toBeNull();
    expect(result.sampledCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  it("emits progress events while loading context files", async () => {
    const files: WorkspaceProjectFile[] = [
      projectFile("D:/repo/README.md", "README.md", "markdown")
    ];
    const progress: string[] = [];

    window.dbzs.readProjectFile = vi.fn(async () => ({
      path: "D:/repo/README.md",
      name: "README.md",
      language: "markdown",
      content: "# Hello"
    }));

    await buildWorkspaceContext("D:/repo", "dbzs-codee", files, null, (event) => {
      progress.push(event.type);
    });

    expect(progress).toContain("start");
    expect(progress).toContain("reading");
    expect(progress).toContain("loaded");
    expect(progress).toContain("done");
  });

  it("keeps sending context when one sampled file read fails", async () => {
    const files: WorkspaceProjectFile[] = [
      projectFile("D:/repo/apps/desktop/src/main.tsx", "apps/desktop/src/main.tsx", "typescript"),
      projectFile("D:/repo/README.md", "README.md", "markdown"),
      projectFile("D:/repo/package.json", "package.json", "json")
    ];

    const activeFile: WorkspaceFile = {
      path: "D:/repo/apps/desktop/src/main.tsx",
      name: "main.tsx",
      language: "typescript",
      content: "console.log('active');"
    };

    const readProjectFileMock = vi.fn(async (filePath: string) => {
      if (filePath.endsWith("README.md")) {
        throw new Error("read failed");
      }
      if (filePath.endsWith("package.json")) {
        return {
          path: filePath,
          name: "package.json",
          language: "json",
          content: '{"name":"dbzs"}'
        } satisfies WorkspaceFile;
      }
      return null;
    });

    window.dbzs.readProjectFile = readProjectFileMock;

    const result = await buildWorkspaceContext("D:/repo", "dbzs-codee", files, activeFile);

    expect(result.context).not.toBeNull();
    expect(result.failedCount).toBe(1);
    expect(result.sampledCount).toBe(2);
    expect(result.context?.sampledFiles.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining(["apps/desktop/src/main.tsx", "package.json"])
    );
    expect(readProjectFileMock).not.toHaveBeenCalledWith(activeFile.path);
  });
});

describe("buildWorkspaceContextSystemMessage", () => {
  it("includes sampled file contents for the model", () => {
    const message = buildWorkspaceContextSystemMessage({
      rootPath: "D:/repo",
      name: "dbzs-codee",
      fileTree: ["README.md", "package.json"],
      sampledFiles: [
        {
          path: "D:/repo/README.md",
          relativePath: "README.md",
          language: "markdown",
          content: "# DBZS"
        }
      ]
    });

    expect(message).toContain("[Workspace Context]");
    expect(message).toContain("README.md");
    expect(message).toContain("# DBZS");
    expect(message).toContain("```markdown");
  });

  it("returns null without workspace context", () => {
    expect(buildWorkspaceContextSystemMessage(null)).toBeNull();
  });
});

describe("buildAgentImplementationPrompt", () => {
  it("wraps a proposal as actionable build instruction", () => {
    const prompt = buildAgentImplementationPrompt("Implementiere Feature X mit Tests.");

    expect(prompt).toContain("[Agent Build Mode]");
    expect(prompt).toContain("Vorschlag:");
    expect(prompt).toContain("Implementiere Feature X mit Tests.");
  });
});

describe("buildJobTakeoverRequest", () => {
  it("creates a queued implementation job with workspace context and active file metadata", () => {
    const activeFile: WorkspaceFile = {
      path: "D:/repo/apps/desktop/src/main.tsx",
      name: "main.tsx",
      language: "typescript",
      content: "console.log('active');"
    };

    const request = buildJobTakeoverRequest(
      "Implementiere den Button und teste ihn.",
      {
        rootPath: "D:/repo",
        name: "dbzs-codee",
        fileTree: ["README.md"],
        sampledFiles: []
      },
      activeFile
    );

    expect(request.title).toContain("Uebernehmen:");
    expect(request.task_type).toBe("implementation");
    expect(request.assigned_agent_role).toBe("coder");
    expect(request.input_payload?.source).toBe("assistant_takeover");
    expect(request.input_payload?.proposal).toContain("Implementiere den Button und teste ihn.");
    expect(request.input_payload?.workspace_context).toMatchObject({ rootPath: "D:/repo", name: "dbzs-codee" });
    expect(request.input_payload?.active_file).toMatchObject({
      path: activeFile.path,
      name: activeFile.name,
      language: activeFile.language,
      content: activeFile.content
    });
  });
});

describe("executeAssistantTakeover", () => {
  beforeEach(() => {
    enqueueJobMock.mockReset();
  });

  it("enqueues a job for plain-text assistant proposals", async () => {
    enqueueJobMock.mockResolvedValue({
      id: "job_123",
      title: "Uebernehmen: Milestone 1",
      status: "queued"
    });
    const queueProposedChanges = vi.fn();

    const detail = await executeAssistantTakeover({
      proposal: "Milestone 1: Server implementieren\nMilestone 2: Frontend",
      workspaceRoot: "D:/repo",
      workspaceContext: {
        rootPath: "D:/repo",
        name: "dbzs-codee",
        fileTree: [],
        sampledFiles: []
      },
      activeFile: null,
      queueProposedChanges
    });

    expect(enqueueJobMock).toHaveBeenCalledOnce();
    expect(queueProposedChanges).not.toHaveBeenCalled();
    expect(detail).toContain("Job eingereiht");
  });
});
