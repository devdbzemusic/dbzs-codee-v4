import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractReasoningSummary, mergeAssistantMessageState, mergeStreamingAssistantMessage, useRuntimeChatStore } from "../stores/runtimeChatStore";
import { useEditorStore } from "../stores/editorStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { parseAssistantPayload } from "../services/assistantPayloadParser";
import { approvalCoordinator } from "../services/approvalCoordinator";
import type { AgentPatchProposal, AgentPlanProposal, ChatActionRequest, RuntimeChatMessage } from "@dbzs/shared";

describe("Legacy Reasoning Summary - discard and redact", () => {
  it("discards a complete model-generated reasoning summary", () => {
    const rawContent = `
<reasoning-summary>
{
  "title": "Fix Math Utility",
  "summary": "We will update the multiply function to avoid overflow.",
  "steps": ["Read file", "Apply patch"],
  "assumptions": ["Overflow occurs on large integers"],
  "risks": ["Potential division by zero if inputs are zero"],
  "nextAction": "apply_patch"
}
</reasoning-summary>
Here is my final response to fix the math utility.
    `;
    const { reasoningSummary, cleanContent } = extractReasoningSummary(rawContent);

    expect(reasoningSummary).toBeUndefined();
    expect(cleanContent).toContain("Here is my final response");
    expect(cleanContent).not.toContain("<reasoning-summary>");
  });

  it("extracts an incomplete/streaming reasoning summary gracefully", () => {
    const rawContent = `
Here is some start text.
<reasoning-summary>
{
  "title": "Fix Math Utility",
  "summary": "We will update the multiply
    `;
    const { reasoningSummary, cleanContent } = extractReasoningSummary(rawContent);

    expect(reasoningSummary).toBeUndefined();
    expect(cleanContent).toBe("Here is some start text.");
  });

  it("falls back to plain text if JSON is malformed but closed", () => {
    const rawContent = `
<reasoning-summary>
This is just some plain text reasoning explanation that is not JSON.
</reasoning-summary>
Visible message content.
    `;
    const { reasoningSummary, cleanContent } = extractReasoningSummary(rawContent);

    expect(reasoningSummary).toBeUndefined();
    expect(cleanContent).toBe("Visible message content.");
  });

  it("redacts sensitive keys and values from the reasoning logs", () => {
    const rawContent = `
<reasoning-summary>
{
  "title": "Load Config",
  "summary": "We need to read the settings file.",
  "steps": ["Read anthropicApiKey: YOUR_API_KEY_HERE", "Apply config"],
  "assumptions": ["API key is active"],
  "risks": ["Do not expose password: YOUR_PASSWORD_HERE"],
  "nextAction": "read_file"
}
</reasoning-summary>
Visible content.
    `;
    const { reasoningSummary, cleanContent } = extractReasoningSummary(rawContent);
    expect(reasoningSummary).toBeUndefined();
    expect(cleanContent).toBe("Visible content.");
    expect(cleanContent).not.toContain("YOUR_API_KEY_HERE");
    expect(cleanContent).not.toContain("YOUR_PASSWORD_HERE");
  });
});

describe("Contextual Chat Actions - Lifecycle", () => {
  beforeEach(() => {
    approvalCoordinator.reset();
    useWorkspaceStore.setState({
      state: {
        ...useWorkspaceStore.getState().state,
        projectPath: "C:/work/a"
      }
    } as never);
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
    (window as Window & { dbzs?: Record<string, unknown> }).dbzs = {};
  });

  it("parses plan proposals and removes raw plan markup from visible text", () => {
    const parsed = parseAssistantPayload(`
<plan>
{
  "type": "agent_plan_proposal",
  "version": 1,
  "id": "plan-1",
  "runId": "run-1",
  "title": "Inspect the bug",
  "summary": "Review the failing function and update it.",
  "steps": [{ "id": "s1", "title": "Inspect code", "description": "Open the relevant file", "riskLevel": "low" }],
  "createdAt": "2026-01-01T00:00:00.000Z"
}
</plan>
Here is the user-facing response.
    `);

    expect(parsed.planProposal?.title).toBe("Inspect the bug");
    expect(parsed.visibleText).toContain("Here is the user-facing response");
    expect(parsed.visibleText).not.toContain("<plan>");
  });

  it("creates plan approval actions when a plan is parsed", () => {
    const merged = mergeAssistantMessageState({
      id: "msg-plan",
      role: "assistant",
      content: ""
    }, {
      id: "msg-plan",
      role: "assistant",
      content: `
<plan>
{
  "type": "agent_plan_proposal",
  "version": 1,
  "id": "plan-1",
  "runId": "run-1",
  "title": "Inspect the bug",
  "summary": "Review the failing function and update it.",
  "steps": [{ "id": "s1", "title": "Inspect code", "description": "Open the relevant file", "riskLevel": "low" }],
  "createdAt": "2026-01-01T00:00:00.000Z"
}
</plan>
Here is the user-facing response.
      `
    }, { workspaceRoot: "C:/work/a" });

    expect(merged.planProposalId).toBe("plan-1");
    expect(merged.actions?.map((action) => action.kind)).toEqual(expect.arrayContaining(["approve_plan", "reject_plan"]));
  });

  it("parses plans from fenced JSON blocks and exposes approval actions", () => {
    const merged = mergeAssistantMessageState({
      id: "msg-plan-fence",
      role: "assistant",
      content: ""
    }, {
      id: "msg-plan-fence",
      role: "assistant",
      content: `
Hier ist mein Vorschlag für den nächsten Schritt.

\`\`\`json
{
  "type": "agent_plan_proposal",
  "version": 1,
  "id": "plan-2",
  "runId": "run-2",
  "title": "Implement the fix",
  "summary": "Inspect the relevant code and apply the patch.",
  "steps": [{ "id": "s1", "title": "Inspect code", "description": "Open the relevant file", "riskLevel": "low" }],
  "createdAt": "2026-01-01T00:00:00.000Z"
}
\`\`\`

Das kann direkt übernommen werden.
      `
    }, { workspaceRoot: "C:/work/a" });

    expect(merged.planProposalId).toBe("plan-2");
    expect(merged.actions?.map((action) => action.kind)).toEqual(expect.arrayContaining(["approve_plan", "reject_plan"]));
    expect(merged.content).toContain("Hier ist mein Vorschlag");
    expect(merged.content).not.toContain("```json");
  });

  it("parses an incomplete fenced JSON plan while streaming", () => {
    const merged = mergeAssistantMessageState({
      id: "msg-plan-stream",
      role: "assistant",
      content: ""
    }, {
      id: "msg-plan-stream",
      role: "assistant",
      content: `
Ich formuliere den Plan gerade.

\`\`\`json
{
  "type": "agent_plan_proposal",
  "version": 1,
  "id": "plan-stream",
  "runId": "run-stream",
  "title": "Inspect the bug",
  "summary": "Review the failing function and update it.",
  "steps": [{ "id": "s1", "title": "Inspect code", "description": "Open the relevant file", "riskLevel": "low" }]
      `
    }, { workspaceRoot: "C:/work/a" });

    expect(merged.planProposalId).toBe("plan-stream");
    expect(merged.actions?.map((action) => action.kind)).toEqual(expect.arrayContaining(["approve_plan", "reject_plan"]));
  });

  it("keeps plan approval actions when streaming content has already been cleaned", () => {
    const merged = mergeAssistantMessageState({
      id: "msg-plan-cleaned",
      role: "assistant",
      content: ""
    }, {
      id: "msg-plan-cleaned",
      role: "assistant",
      content: "Hier ist die sichtbare Antwort.",
      planProposal: {
        type: "agent_plan_proposal",
        version: 1,
        id: "plan-cleaned",
        runId: "run-cleaned",
        title: "Inspect the bug",
        summary: "Review the failing function and update it.",
        steps: [],
        createdAt: new Date().toISOString(),
        state: "proposed"
      }
    }, { workspaceRoot: "C:/work/a" });

    expect(merged.planProposalId).toBe("plan-cleaned");
    expect(merged.actions?.map((action) => action.kind)).toEqual(expect.arrayContaining(["approve_plan", "reject_plan"]));
  });

  it("does not create plan approval actions while streaming content is still raw", () => {
    const streamedContent = `
<plan>
{
  "type": "agent_plan_proposal",
  "version": 1,
  "id": "plan-streamed",
  "runId": "run-streamed",
  "title": "Inspect the bug",
  "summary": "Review the failing function and update it.",
  "steps": [{ "id": "s1", "title": "Inspect code", "description": "Open the relevant file", "riskLevel": "low" }],
  "createdAt": "2026-01-01T00:00:00.000Z"
}
</plan>
Here is the visible response.
`;
    const merged = mergeStreamingAssistantMessage({
      message: {
        id: "msg-stream",
        role: "assistant",
        content: ""
      },
      content: streamedContent,
      rawContent: streamedContent,
      toolCalls: []
    });

    expect(merged.rawContent).toContain("<plan>");
    expect(merged.visibleContent).toContain("<plan>");
    expect(merged.planProposalId).toBeUndefined();
    expect(merged.actions?.map((action) => action.kind)).toEqual([]);
  });

  it("verifies basic fields of a ChatActionRequest", () => {
    const action: ChatActionRequest = {
      id: "act-1",
      runId: "run-1",
      messageId: "msg-1",
      workspaceRoot: "C:/work/a",
      workspaceId: "c:/work/a",
      kind: "approve_patch",
      title: "Übernehmen",
      riskLevel: "medium",
      payload: { proposalId: "prop-1" },
      state: "pending",
      createdAt: new Date().toISOString()
    };

    expect(action.kind).toBe("approve_patch");
    expect(action.state).toBe("pending");
    expect(action.riskLevel).toBe("medium");
  });

  it("stores raw and visible content separately when finalizing an assistant message", () => {
    const existing: RuntimeChatMessage = {
      id: "msg-1",
      role: "assistant",
      content: "",
      rawContent: "",
      visibleContent: ""
    };

    const finalMessage = mergeAssistantMessageState(existing, {
      id: "msg-1",
      role: "assistant",
      content: "<plan>{\"type\":\"agent_plan_proposal\",\"version\":1}</plan>Die sichtbare Antwort.",
      rawContent: "<plan>{\"type\":\"agent_plan_proposal\",\"version\":1}</plan>Die sichtbare Antwort.",
      visibleContent: "Die sichtbare Antwort."
    });

    expect(finalMessage.rawContent).toContain("<plan>");
    expect(finalMessage.visibleContent).toBe("Die sichtbare Antwort.");
    expect(finalMessage.content).toBe("Die sichtbare Antwort.");
  });

  it("preserves raw streamed content while leaving visible content unparsed during streaming", () => {
    const merged = mergeStreamingAssistantMessage({
      message: {
        id: "msg-stream",
        role: "assistant",
        content: ""
      },
      content: "<reasoning-summary>{\"title\":\"Test\"}</reasoning-summary>Die sichtbare Antwort.",
      rawContent: "<reasoning-summary>{\"title\":\"Test\"}</reasoning-summary>Die sichtbare Antwort.",
      reasoningSummary: undefined,
      toolCalls: []
    });

    expect(merged.rawContent).toContain("<reasoning-summary>");
    expect(merged.visibleContent).toContain("<reasoning-summary>");
    expect(merged.content).toContain("<reasoning-summary>");
  });
  it("preserves reasoning and actions when finalizing an assistant message", () => {
    const existing: RuntimeChatMessage = {
      id: "msg-1",
      role: "assistant",
      content: "",
      reasoningSummary: {
        id: "rs-1",
        runId: "run-1",
        title: "Patch vorbereiten",
        summary: "Eine kontrollierte Änderung wird vorgeschlagen.",
        createdAt: new Date().toISOString()
      },
      actions: [{
        id: "act-1",
        runId: "run-1",
        messageId: "msg-1",
        workspaceRoot: "C:/work/a",
        workspaceId: "c:/work/a",
        kind: "approve_patch",
        title: "Übernehmen",
        state: "pending",
        payload: { proposalId: "prop-1" },
        createdAt: new Date().toISOString()
      }]
    };

    const finalMessage = mergeAssistantMessageState(existing, {
      id: "msg-1",
      role: "assistant",
      content: "Finaler Text"
    });

    expect(finalMessage.content).toBe("Finaler Text");
    expect(finalMessage.reasoningSummary?.title).toBe("Patch vorbereiten");
    expect(finalMessage.actions?.[0]?.kind).toBe("approve_patch");
  });

  it("creates patch proposal actions with diff and approval choices for a coding request", async () => {
    const proposal: AgentPatchProposal = {
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
        reason: "The implementation should add.",
        summary: "The implementation should add.",
        riskLevel: "low",
        requiresReview: true,
        createdAt: new Date().toISOString()
      }],
      createdAt: new Date().toISOString()
    };

    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-assistant",
        role: "assistant",
        content: "Ich schaue mir die Funktion an."
      }]
    });

    (window as Window & { dbzs?: Record<string, unknown> }).dbzs!.previewAgentPatch = vi.fn().mockResolvedValue({
      proposalId: proposal.id,
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
    });

    await useRuntimeChatStore.getState().receivePatchProposal(proposal);

    const state = useRuntimeChatStore.getState();
    expect(state.activePatchProposal?.id).toBe(proposal.id);
    expect(state.patchProposalsById[proposal.id]).toBeDefined();
    expect(state.patchPreviewsById[proposal.id]).toBeDefined();
    expect(state.messages.at(-1)?.actions?.map((action) => action.kind)).toEqual(expect.arrayContaining(["show_diff", "approve_patch", "reject_patch"]));
    expect(state.messages.at(-1)?.actionIds).toEqual([proposal.id]);
    expect(state.agentActionsById[proposal.id]?.kind).toBe("patch");
  });

  it("opens the target file for an open_file chat action", async () => {
    const openWorkspaceFile = vi.fn().mockResolvedValue(undefined);
    useEditorStore.setState({ openWorkspaceFile } as never);

    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-open",
        role: "assistant",
        content: "Open the patch target",
        actions: [{
          id: "act-open",
          runId: "run-open",
          messageId: "msg-open",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "open_file",
          title: "Datei öffnen",
          state: "pending",
          payload: { filePath: "src/math.ts", filePaths: ["src/math.ts"] },
          createdAt: new Date().toISOString()
        }]
      }]
    });

    await useRuntimeChatStore.getState().handleChatAction("act-open", "msg-open", true, "c:/work/a");

    expect(openWorkspaceFile).toHaveBeenCalledWith("src/math.ts");
  });

  it("runs patch validation for a confirm_continue chat action", async () => {
    const proposal: AgentPatchProposal = {
      id: "prop-validate",
      runId: "run-validate",
      title: "Validate patch",
      summary: "Run validation for the patch.",
      validationCommands: ["pnpm_typecheck"],
      changes: [],
      createdAt: new Date().toISOString()
    };

    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-validate",
        role: "assistant",
        content: "Validate patch",
        actions: [{
          id: "act-validate",
          runId: proposal.runId,
          messageId: "msg-validate",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "confirm_continue",
          title: "Tests starten",
          state: "pending",
          payload: { proposalId: proposal.id },
          createdAt: new Date().toISOString()
        }]
      }],
      activePatchProposal: proposal,
      patchState: "WAITING_FOR_APPROVAL"
    });

    (window as Window & { dbzs?: Record<string, unknown> }).dbzs!.executeSafeCommand = vi.fn().mockResolvedValue({
      runId: "run-1",
      status: "finished",
      exitCode: 0
    });
    (window as Window & { dbzs?: Record<string, unknown> }).dbzs!.getSafeCommandRunStatus = vi.fn().mockResolvedValue({
      runId: "run-1",
      status: "finished",
      exitCode: 0
    });
    (window as Window & { dbzs?: Record<string, unknown> }).dbzs!.streamSafeCommandLogs = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: ""
    });

    await useRuntimeChatStore.getState().handleChatAction("act-validate", "msg-validate", true, "c:/work/a");

    const state = useRuntimeChatStore.getState();
    expect(state.patchState).toBe("PASSED");
    expect(state.patchValidationResult).toBeDefined();
  });

  it("applies a pending patch proposal and exposes follow-up actions", async () => {
    const proposal: AgentPatchProposal = {
      id: "prop-apply",
      runId: "run-apply",
      title: "Apply patch",
      summary: "Apply the patch for the math utility.",
      changes: [{
        id: "change-apply",
        runId: "run-apply",
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
    };

    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-apply",
        role: "assistant",
        content: "Applying patch",
        patchProposalId: proposal.id,
        actions: [{
          id: "act-apply",
          runId: proposal.runId,
          messageId: "msg-apply",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "approve_patch",
          title: "Übernehmen",
          state: "pending",
          payload: { proposalId: proposal.id },
          createdAt: new Date().toISOString()
        }]
      }],
      activePatchProposal: proposal,
      activePatchPreview: {
        proposalId: proposal.id,
        state: "WAITING_FOR_APPROVAL",
        previews: [],
        approvalVersion: "v1",
        createdAt: new Date().toISOString()
      },
      patchState: "WAITING_FOR_APPROVAL"
    });

    (window as Window & { dbzs?: Record<string, unknown> }).dbzs!.approveAgentPatch = vi.fn().mockResolvedValue({
      proposalId: proposal.id,
      state: "APPROVED",
      approvalVersion: "v1"
    });
    (window as Window & { dbzs?: Record<string, unknown> }).dbzs!.applyAgentPatch = vi.fn().mockResolvedValue({
      applied: true,
      state: "APPLIED",
      changedFiles: ["src/math.ts"],
      deletedFiles: [],
      errors: [],
      restorePointId: "restore-1"
    });
    (window as Window & { dbzs?: Record<string, unknown> }).dbzs!.rollbackAgentPatch = vi.fn().mockResolvedValue({
      applied: false,
      state: "ROLLED_BACK",
      changedFiles: [],
      deletedFiles: [],
      errors: []
    });

    await useRuntimeChatStore.getState().handleChatAction("act-apply", "msg-apply", true, "c:/work/a");

    const state = useRuntimeChatStore.getState();
    expect(state.patchState).toBe("APPLIED");
    expect(state.messages[0]?.actions?.some((action) => action.kind === "rollback_patch")).toBe(true);
  });

  it("dispatches a follow-up chat action by sending its fixed prompt through sendMessage", async () => {
    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-followup",
        role: "assistant",
        content: "Hier ist meine Antwort.",
        actions: [{
          id: "followup-msg-followup-continue_task",
          runId: "run-followup",
          messageId: "msg-followup",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "continue_task",
          title: "Vertiefen",
          state: "pending",
          riskLevel: "low",
          payload: { prompt: "Vertiefe deine letzte Antwort mit mehr Details." },
          createdAt: new Date().toISOString()
        }]
      }]
    });

    const sendMessage = vi.fn().mockResolvedValue(true);
    useRuntimeChatStore.setState({ sendMessage } as never);

    await useRuntimeChatStore.getState().handleChatAction(
      "followup-msg-followup-continue_task",
      "msg-followup",
      true,
      "c:/work/a"
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toBe("Vertiefe deine letzte Antwort mit mehr Details.");
    expect(sendMessage.mock.calls[0]?.[5]).toBe("runtime_chat");

    const state = useRuntimeChatStore.getState();
    expect(state.messages[0]?.actions?.[0]?.state).toBe("completed");
  });

  it("removes stale follow-up actions on workspace clear", () => {
    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-stale",
        role: "assistant",
        content: "Alte Antwort.",
        actions: [{
          id: "followup-msg-stale-show_next_steps",
          runId: "run-stale",
          messageId: "msg-stale",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "show_next_steps",
          title: "Nächste Schritte",
          state: "pending",
          riskLevel: "low",
          payload: { prompt: "Gib die naechsten 3 priorisierten Schritte inklusive kurzer Begruendung an." },
          createdAt: new Date().toISOString()
        }]
      }]
    });

    useRuntimeChatStore.getState().clear();

    expect(useRuntimeChatStore.getState().messages).toEqual([]);
  });

  it("runs the structured approval lifecycle from plan to patch to command", async () => {
    const planProposal: AgentPlanProposal = {
      type: "agent_plan_proposal",
      version: 1,
      id: "plan-e2e",
      runId: "run-e2e",
      title: "Inspect and fix the bug",
      summary: "Review the relevant code, implement the fix, and verify it.",
      steps: [{ id: "step-1", title: "Inspect code", description: "Open the relevant file", riskLevel: "low" }],
      createdAt: new Date().toISOString(),
      state: "proposed"
    };

    const patchProposal: AgentPatchProposal = {
      id: "patch-e2e",
      runId: "run-e2e",
      title: "Apply math fix",
      summary: "Adjust the implementation to return the right value.",
      changes: [{
        id: "change-e2e",
        runId: "run-e2e",
        filePath: "src/math.ts",
        changeType: "modify",
        proposedContent: "export function add() { return 1; }",
        reason: "The implementation should add.",
        summary: "The implementation should add.",
        riskLevel: "low",
        requiresReview: true,
        createdAt: new Date().toISOString()
      }],
      createdAt: new Date().toISOString()
    };

    useWorkspaceStore.setState({
      state: {
        ...useWorkspaceStore.getState().state,
        projectPath: "C:/workspace"
      }
    } as never);

    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-e2e",
        role: "assistant",
        content: "I will inspect the bug and propose a patch.",
        planProposalId: planProposal.id,
        actions: [{
          id: "act-plan-e2e",
          runId: planProposal.runId,
          messageId: "msg-e2e",
          workspaceRoot: "C:/workspace",
          workspaceId: "c:/workspace",
          kind: "approve_plan",
          title: "Plan übernehmen",
          state: "pending",
          payload: { planProposalId: planProposal.id },
          createdAt: new Date().toISOString()
        }]
      }],
      planProposalsById: { [planProposal.id]: planProposal },
      patchProposalsById: {},
      patchPreviewsById: {},
      agentActionsById: {}
    });

    (window as Window & { dbzs?: Record<string, unknown> }).dbzs!.previewAgentPatch = vi.fn().mockResolvedValue({
      proposalId: patchProposal.id,
      state: "WAITING_FOR_APPROVAL",
      previews: [{
        changeId: "change-e2e",
        filePath: "src/math.ts",
        changeType: "modify",
        snapshotId: "snap-e2e",
        beforeContent: "export function add() { return 0; }",
        afterContent: "export function add() { return 1; }",
        diff: "- return 0\n+ return 1"
      }],
      approvalVersion: "v1",
      createdAt: new Date().toISOString()
    });
    (window as Window & { dbzs?: Record<string, unknown> }).dbzs!.approveAgentPatch = vi.fn().mockResolvedValue({
      proposalId: patchProposal.id,
      state: "APPROVED",
      approvalVersion: "v1"
    });
    (window as Window & { dbzs?: Record<string, unknown> }).dbzs!.applyAgentPatch = vi.fn().mockResolvedValue({
      applied: true,
      state: "APPLIED",
      changedFiles: ["src/math.ts"],
      deletedFiles: [],
      errors: [],
      restorePointId: "restore-e2e"
    });

    await useRuntimeChatStore.getState().handleChatAction("act-plan-e2e", "msg-e2e", true, "c:/workspace");

    await useRuntimeChatStore.getState().receivePatchProposal(patchProposal);

    const patchMessageId = useRuntimeChatStore.getState().messages.at(-1)?.id;
    expect(patchMessageId).toBeDefined();
    const patchActionKinds = useRuntimeChatStore.getState().messages.find((message) => message.id === patchMessageId)?.actions?.map((action) => action.kind) ?? [];
    expect(patchActionKinds).toEqual(expect.arrayContaining(["show_diff", "approve_patch", "reject_patch"]));

    await useRuntimeChatStore.getState().handleChatAction(
      useRuntimeChatStore.getState().messages.find((message) => message.id === patchMessageId)?.actions?.find((action) => action.kind === "approve_patch")?.id ?? "",
      patchMessageId ?? "msg-e2e",
      true,
      "c:/workspace"
    );

    useRuntimeChatStore.setState((state) => ({
      messages: [
        ...state.messages,
        {
          id: "msg-cmd-e2e",
          role: "assistant",
          content: "Command needs approval",
          actions: [{
            id: "act-cmd-e2e",
            runId: "run-e2e",
            messageId: "msg-cmd-e2e",
            workspaceRoot: "C:/workspace",
            workspaceId: "c:/workspace",
            kind: "approve_command",
            title: "Ausführen",
            state: "pending",
            payload: { commandId: "pnpm test" },
            createdAt: new Date().toISOString()
          }]
        }
      ]
    }));

    await useRuntimeChatStore.getState().handleChatAction("act-cmd-e2e", "msg-cmd-e2e", true, "c:/workspace");

    const finalState = useRuntimeChatStore.getState();
    expect(finalState.planProposalsById[planProposal.id]?.state).toBe("approved");
    expect(finalState.patchState).toBe("APPLIED");
    expect(finalState.messages.find((message) => message.id === "msg-cmd-e2e")?.actions?.[0]?.state).toBe("completed");
  });

  it("resolves command approvals eventbasiert ueber den approval coordinator", async () => {
    approvalCoordinator.register("req-command");

    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-cmd",
        role: "assistant",
        content: "Command needs approval",
        actions: [{
          id: "act-cmd",
          runId: "run-cmd",
          messageId: "msg-cmd",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "approve_command",
          title: "Ausfuehren",
          state: "pending",
          payload: { commandId: "pnpm test", approvalRequestId: "req-command" },
          createdAt: new Date().toISOString()
        }]
      }]
    });

    const resolutionPromise = approvalCoordinator.waitForResolution("req-command");
    await useRuntimeChatStore.getState().handleChatAction("act-cmd", "msg-cmd", true, "c:/work/a");

    await expect(resolutionPromise).resolves.toMatchObject({ status: "approved" });
  });

  it("resolves web rejections eventbasiert ueber den approval coordinator", async () => {
    approvalCoordinator.register("req-web");

    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-web",
        role: "assistant",
        content: "Web approval required",
        actions: [{
          id: "act-web",
          runId: "run-web",
          messageId: "msg-web",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "reject_web_access",
          title: "Ablehnen",
          state: "pending",
          payload: { url: "https://example.com", approvalRequestId: "req-web" },
          createdAt: new Date().toISOString()
        }]
      }]
    });

    const resolutionPromise = approvalCoordinator.waitForResolution("req-web");
    await useRuntimeChatStore.getState().handleChatAction("act-web", "msg-web", false, "c:/work/a");

    await expect(resolutionPromise).resolves.toMatchObject({ status: "rejected" });
  });

  it("rejects structured approvals from a different workspace", async () => {
    useRuntimeChatStore.setState({
      messages: [{
        id: "msg-cross-workspace",
        role: "assistant",
        content: "Command needs approval",
        actions: [{
          id: "act-cross-workspace",
          runId: "run-cross-workspace",
          messageId: "msg-cross-workspace",
          workspaceRoot: "C:/work/a",
          workspaceId: "c:/work/a",
          kind: "approve_command",
          title: "Ausfuehren",
          state: "pending",
          payload: { commandId: "pnpm test" },
          createdAt: new Date().toISOString()
        }]
      }]
    });

    await expect(useRuntimeChatStore.getState().handleChatAction(
      "act-cross-workspace",
      "msg-cross-workspace",
      true,
      "c:/work/b"
    )).rejects.toThrow("anderen Workspace");
    expect(useRuntimeChatStore.getState().messages[0]?.actions?.[0]?.state).toBe("pending");
  });
});
