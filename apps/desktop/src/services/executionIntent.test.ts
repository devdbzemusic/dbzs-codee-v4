import { describe, expect, it } from "vitest";
import {
  classifyUserExecutionIntent,
  isToolRequiredExecutionIntent,
  taskTypeForExecutionIntent
} from "@/services/executionIntent";
import {
  detectUserDelegation,
  gateExecutionFinalAnswer,
  validateExecutionAnswer
} from "@/services/executionAnswerValidation";
import { shouldUseAgentTurnLoop } from "@/services/runtimeChatAgentConfig";
import { classifyTaskType } from "@/services/modelSelectionBroker";
import { evaluateTerminalCommandPolicy } from "@/runtime/tool/execPolicy";

describe("executionIntent", () => {
  it("maps explain / plan / implement examples from the hotfix", () => {
    expect(classifyUserExecutionIntent("Wie würde man Electron einbauen?")).toBe("explain_only");
    expect(classifyUserExecutionIntent("Erstelle einen Plan für Electron.")).toBe("plan_only");
    expect(classifyUserExecutionIntent("Erstelle einen klaren Implementierungsplan mit konkreten Schritten, Risiken und Tests.")).toBe("plan_only");
    expect(classifyUserExecutionIntent("Erstelle einen Umsetzungsplan für den Runtime-Chat.")).toBe("plan_only");
    expect(classifyUserExecutionIntent("Liefere einen Fix-Plan für den Bug.")).toBe("plan_only");
    expect(classifyUserExecutionIntent("Please provide a structured fix-plan.")).toBe("plan_only");
    expect(classifyUserExecutionIntent("Baue Electron ein.")).toBe("implement");
    expect(classifyUserExecutionIntent("Behebe den Fehler.")).toBe("fix");
    expect(classifyUserExecutionIntent("Mach einen kompletten Code Review.")).toBe("review");
  });

  it("marks implement/fix/refactor/test/build as tool-required", () => {
    for (const intent of ["implement", "fix_review_findings", "fix", "refactor", "test", "build"] as const) {
      expect(isToolRequiredExecutionIntent(intent)).toBe(true);
    }
    expect(isToolRequiredExecutionIntent("explain_only")).toBe(false);
    expect(isToolRequiredExecutionIntent("plan_only")).toBe(false);
  });

  it("erkennt Review-Remediation vor generischem Fix und lässt Debugging unverändert", () => {
    for (const message of [
      "fix findings",
      "Fix the findings",
      "Findings beheben",
      "Behebe die Review-Findings",
      "Alle P0/P1 fixen"
    ]) {
      expect(classifyUserExecutionIntent(message)).toBe("fix_review_findings");
      expect(taskTypeForExecutionIntent("fix_review_findings")).toBe("planning");
    }
    expect(classifyUserExecutionIntent("Debugge den fehlgeschlagenen Typecheck")).toBe("fix");
  });

  it("routes Baue Electron ein to a coding task type", () => {
    expect(classifyTaskType("Baue Electron ein.")).toBe("large_code_change");
    expect(taskTypeForExecutionIntent("implement")).toBe("large_code_change");
  });
});

describe("executionAnswerValidation", () => {
  it("detects terminal delegation phrases", () => {
    expect(detectUserDelegation("Öffne dein Terminal und führe npm install aus.")).toBe(true);
    expect(detectUserDelegation("Führe folgenden Befehl aus: npm init -y")).toBe(true);
    expect(detectUserDelegation("Ich habe package.json gelesen und einen Plan erstellt.")).toBe(false);
  });

  it("rejects implement answers that only instruct the user", () => {
    const validation = validateExecutionAnswer({
      executionIntent: "implement",
      finalAnswer: "Öffne dein Terminal und führe npm install -g electron aus.",
      toolCallsExecuted: 0
    });
    expect(validation.valid).toBe(false);
    expect(validation.delegatedToUser).toBe(true);
    expect(validation.reason).toBe("terminal_delegation_without_tools");
  });

  it("rejects implement answers with zero tools", () => {
    const validation = validateExecutionAnswer({
      executionIntent: "implement",
      finalAnswer: "Hier ist der Plan ohne Umsetzung.",
      toolCallsExecuted: 0
    });
    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe("no_tool_execution");
  });

  it("accepts implement answers after tools ran", () => {
    const validation = validateExecutionAnswer({
      executionIntent: "implement",
      finalAnswer: "Electron-Main angelegt und Scripts ergänzt.",
      toolCallsExecuted: 3,
      filesChanged: 2
    });
    expect(validation.valid).toBe(true);
  });

  it("gates environment blockers when workspace tools are missing", () => {
    const gate = gateExecutionFinalAnswer({
      userMessage: "Baue Electron ein.",
      executionIntent: "implement",
      finalAnswer: "Öffne dein Terminal.",
      toolCallsExecuted: 0,
      toolsEnabled: true,
      workspaceRoot: null
    });
    expect(gate.rejectAsInvalid).toBe(true);
    expect(gate.userMessage).toMatch(/Workspace ist nicht gebunden/i);
  });
});

describe("shouldUseAgentTurnLoop + execute intents", () => {
  it("forces tool loop for Baue Electron ein in Auto/agent profile", () => {
    expect(shouldUseAgentTurnLoop(true, "agent", "default", false, "Baue Electron ein.")).toBe(true);
  });

  it("does not force tool loop for pure explain questions", () => {
    expect(
      shouldUseAgentTurnLoop(true, "agent", "default", false, "Wie würde man Electron einbauen?")
    ).toBe(false);
  });
});

describe("execPolicy global installs", () => {
  it("forbids global package manager installs", () => {
    expect(evaluateTerminalCommandPolicy("npm install -g electron").decision).toBe("forbidden");
    expect(evaluateTerminalCommandPolicy("pnpm add -g typescript").decision).toBe("forbidden");
    expect(evaluateTerminalCommandPolicy("yarn global add electron").decision).toBe("forbidden");
  });

  it("prompts for local dependency installs", () => {
    expect(evaluateTerminalCommandPolicy("npm install --save-dev electron").decision).toBe("prompt");
    expect(evaluateTerminalCommandPolicy("pnpm add -D electron").decision).toBe("prompt");
  });
});
