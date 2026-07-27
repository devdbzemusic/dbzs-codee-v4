import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import {
  classifyUserExecutionIntent,
  isExplicitExplainOnly,
  isToolRequiredExecutionIntent
} from "@/services/executionIntent";

const PROFILE_STORAGE_KEY = "dbzs-runtime-chat-tool-profile";

export function loadToolProfile(): AgentToolProfile {
  if (typeof localStorage === "undefined") {
    return "agent";
  }
  const value = localStorage.getItem(PROFILE_STORAGE_KEY);
  if (value === "ask" || value === "agent" || value === "full") {
    return value;
  }
  return "agent";
}

export function saveToolProfile(profile: AgentToolProfile): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PROFILE_STORAGE_KEY, profile);
  }
}

export function isTrivialConversationMessage(text: string): boolean {
  const cleaned = text.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").trim();
  if (!cleaned) return true;

  const patterns = [
    /^(hallo|hi|hey|hello|moin|servus)$/,
    /^(guten\s+(morgen|tag|abend|besserung))$/,
    /^(wie\s+geht\s+es?\s*(dir|euch)?)$/,
    /^(bist\s+du\s+(da|bereit|online))$/,
    /^(are\s+you\s+(there|ready|online))$/,
    /^(how\s+are\s+you)$/,
    /^(danke|thanks|vielen\s+dank)$/,
    /^test$/
  ];

  return patterns.some(regex => regex.test(cleaned));
}

export function hasCodingOrToolIntent(text: string): boolean {
  if (isTrivialConversationMessage(text)) {
    return false;
  }
  if (isExplicitExplainOnly(text)) {
    return false;
  }
  if (isToolRequiredExecutionIntent(classifyUserExecutionIntent(text))) {
    return true;
  }
  const cleaned = text.toLowerCase();
  const technicalTerms = [
    "code", "datei", "file", "folder", "ordner", "function", "klasse", "class", "method", "test", "run", "git",
    "fehler", "bug", "error", "refactor", "aendere", "import", "export", "build", "cmd", "terminal", "command",
    "script", "skript", "patch", "change", "diff", "apply", "analyse", "plan", "review",
    "baue", "einbauen", "integrier", "implementier", "electron", "npm", "pnpm", "yarn", "vite", "package.json"
  ];
  return technicalTerms.some(term => cleaned.includes(term));
}

export function shouldUseAgentTurnLoop(
  toolsEnabled: boolean,
  profile: AgentToolProfile,
  targetAgent: string,
  agentModePrefix?: boolean,
  userMessage?: string
): boolean {
  if (agentModePrefix === true || targetAgent === "coder" || targetAgent === "debugger") {
    return true;
  }
  if (!toolsEnabled) {
    return false;
  }
  if (profile === "ask") {
    return false;
  }
  const messageText = userMessage || "";
  if (isTrivialConversationMessage(messageText)) {
    return false;
  }
  if (profile === "agent" || profile === "full") {
    return hasCodingOrToolIntent(messageText);
  }
  return false;
}
