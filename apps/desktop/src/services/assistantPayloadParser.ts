import type { AgentPlanProposal, AgentReasoningSummary, AgentToolCall, ParsedAssistantPayload } from "@dbzs/shared";

const CODING_INTENT_KEYWORDS = [
  "ändere",
  "implementiere",
  "repariere",
  "fixe",
  "korrigiere",
  "ergänze",
  "entferne",
  "benenne um",
  "refaktoriere",
  "update",
  "modify",
  "implement",
  "repair",
  "fix",
  "change",
  "refactor",
  "baue",
  "einbauen",
  "integriere",
  "umsetzen",
  "setup",
  "richte ein"
];

export function detectCodingIntent(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();
  return CODING_INTENT_KEYWORDS.some((kw) => lower.includes(kw));
}

const SECRET_REG = /(api[-_]?key|password|secret|auth|token|private[-_]?key)(["'\s]*:?["'\s]*)([a-zA-Z0-9_\-]{8,})/gi;

function redact(str: string): string {
  return str.replace(SECRET_REG, "$1$2[REDACTED]");
}

function parsePlanProposal(raw: string, fallbackId: string): AgentPlanProposal | null {
  const normalized = raw.trim();
  const candidate = normalized
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const maybePlan = parsed as Record<string, unknown>;
    const isValidPlan = maybePlan.type === "agent_plan_proposal" && maybePlan.version === 1;
    if (!isValidPlan) {
      return null;
    }
    const rawSteps = Array.isArray(maybePlan.steps) ? maybePlan.steps : [];
    return {
      type: "agent_plan_proposal",
      version: 1,
      id: typeof maybePlan.id === "string" ? maybePlan.id : fallbackId,
      runId: typeof maybePlan.runId === "string" ? maybePlan.runId : "",
      title: typeof maybePlan.title === "string" ? maybePlan.title : "Geplanter Ablauf",
      summary: typeof maybePlan.summary === "string" ? maybePlan.summary : "",
      steps: rawSteps
        .filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === "object")
        .map((step, index) => ({
          id: typeof step.id === "string" ? step.id : `step-${index + 1}`,
          title: typeof step.title === "string" ? step.title : `Schritt ${index + 1}`,
          description: typeof step.description === "string" ? step.description : "",
          riskLevel: step.riskLevel === "low" || step.riskLevel === "medium" || step.riskLevel === "high"
            ? step.riskLevel
            : undefined
        })),
      createdAt: typeof maybePlan.createdAt === "string" ? maybePlan.createdAt : new Date().toISOString(),
      state: maybePlan.state === "approved" || maybePlan.state === "rejected" || maybePlan.state === "edited" || maybePlan.state === "failed"
        ? maybePlan.state
        : "proposed"
    };
  } catch {
    return null;
  }
}

function extractPlanProposal(content: string): { planProposal?: AgentPlanProposal; visibleText: string } {
  const visibleText = content;
  const tagPattern = /<plan>([\s\S]*?)<\/plan>/i;
  const tagMatch = visibleText.match(tagPattern);
  if (tagMatch) {
    const rawPlan = tagMatch[1].trim();
    const planProposal = parsePlanProposal(rawPlan, `plan-${Math.random().toString(36).substring(7)}`);
    if (planProposal) {
      return {
        planProposal,
        visibleText: visibleText.replace(tagPattern, "")
      };
    }
  }

  const fencePattern = /```(?:json)?\s*([\s\S]*?)(?:```|$)/i;
  const fenceMatch = visibleText.match(fencePattern);
  if (fenceMatch) {
    const fenceBody = fenceMatch[1].trim().replace(/^```(?:json)?\s*/i, "");
    try {
      const parsed = JSON.parse(fenceBody);
      if (parsed && typeof parsed === "object") {
        const planProposal = parsePlanProposal(JSON.stringify(parsed), `plan-${Math.random().toString(36).substring(7)}`);
        if (planProposal) {
          return {
            planProposal,
            visibleText: visibleText.replace(fencePattern, "")
          };
        }
      }
    } catch {
      const partialPlan = fenceBody.match(/^\s*\{\s*(?:"type"\s*:\s*"([^"]+)"[\s\S]*?"id"\s*:\s*"([^"]+)"|"id"\s*:\s*"([^"]+)"[\s\S]*?"title"\s*:\s*"([^"]+)"|"type"\s*:\s*"([^"]+)"[\s\S]*?"title"\s*:\s*"([^"]+)" )/im);
      if (partialPlan) {
        const idFromBody = partialPlan[2] ?? partialPlan[3] ?? undefined;
        const fallbackId = idFromBody ?? `plan-${Math.random().toString(36).substring(7)}`;
        const partialProposal = parsePlanProposal(JSON.stringify({
          type: "agent_plan_proposal",
          version: 1,
          id: fallbackId,
          title: partialPlan[4] ?? partialPlan[6] ?? "Geplanter Ablauf",
          summary: "Plan wird weiter aufgebaut...",
          steps: []
        }), fallbackId);
        if (partialProposal) {
          return {
            planProposal: partialProposal,
            visibleText: visibleText.replace(fencePattern, "")
          };
        }
      }
    }
  }

  const inlineJsonPattern = /\{\s*"id"\s*:\s*"[^"]+"[\s\S]*?"title"\s*:\s*"[^"]+"(?:[\s\S]*?(?:"runId"|"summary"|"steps"))[\s\S]*?\}/m;
  const inlineMatch = visibleText.match(inlineJsonPattern);

  const loosePlanPattern = /"id"\s*:\s*"([^"]+)"[\s\S]*?"title"\s*:\s*"([^"]+)"(?:[\s\S]*?(?:"runId"|"summary"|"steps"))/im;
  const planKeywordPattern = /(plan|schritte|implementation plan|implementierungsplan|next steps|nächste schritte)/i;
  if ((!tagMatch && !fenceMatch && !inlineMatch) || visibleText.match(planKeywordPattern)) {
    const loosePlanMatch = visibleText.match(loosePlanPattern);
    if (loosePlanMatch) {
      const looseProposal = parsePlanProposal(JSON.stringify({
        id: loosePlanMatch[1],
        title: loosePlanMatch[2],
        summary: "Plan wird weiter aufgebaut...",
        steps: []
      }), `plan-${Math.random().toString(36).substring(7)}`);
      if (looseProposal) {
        return {
          planProposal: looseProposal,
          visibleText
        };
      }
    }
  }
  if (inlineMatch) {
    try {
      const parsed = JSON.parse(inlineMatch[0]);
      if (parsed && typeof parsed === "object") {
        const planProposal = parsePlanProposal(JSON.stringify(parsed), `plan-${Math.random().toString(36).substring(7)}`);
        if (planProposal) {
          return {
            planProposal,
            visibleText: visibleText.replace(inlineJsonPattern, "")
          };
        }
      }
    } catch {
      // Ignore non-plan inline JSON.
    }
  }

  return { visibleText };
}

export function parseAssistantPayload(content: string): ParsedAssistantPayload {
  const warnings: string[] = [];
  const toolCalls: AgentToolCall[] = [];
  let reasoningSummary: AgentReasoningSummary | undefined = undefined;
  let planProposal: AgentPlanProposal | undefined = undefined;
  let visibleText = content;

  // 1. Unbekannte Tags scannen & Warnungen generieren
  // Match any tag <tag> or </tag>
  const tagReg = /<(\/?)([a-zA-Z0-9_\-]+)([^>]*)>/g;
  const knownTags = ["reasoning-summary", "tool-call", "function-call", "plan", "thought"];
  
  let tagMatch;
  while ((tagMatch = tagReg.exec(content)) !== null) {
    const tagName = tagMatch[2].toLowerCase();
    if (!knownTags.includes(tagName)) {
      const warn = `Unbekannter Tag erkannt: <${tagName}>`;
      if (!warnings.includes(warn)) {
        warnings.push(warn);
      }
    }
  }

  // 2. Extract reasoning-summary
  const reasoningMatch = visibleText.match(/<reasoning-summary>([\s\S]*?)<\/reasoning-summary>/);
  if (reasoningMatch) {
    const rawJson = reasoningMatch[1].trim();
    visibleText = visibleText.replace(/<reasoning-summary>[\s\S]*?<\/reasoning-summary>/, "");
    
    try {
      const data = JSON.parse(redact(rawJson));
      reasoningSummary = {
        id: data.id ?? `reasoning-${Math.random().toString(36).substring(7)}`,
        runId: data.runId ?? "",
        title: data.title ?? "Reasoning Summary",
        summary: data.summary ?? "",
        steps: Array.isArray(data.steps)
          ? (data.steps as unknown[]).filter((step): step is string => typeof step === "string").map((s: string) => redact(s))
          : [],
        assumptions: Array.isArray(data.assumptions)
          ? (data.assumptions as unknown[]).filter((step): step is string => typeof step === "string").map((s: string) => redact(s))
          : [],
        risks: Array.isArray(data.risks)
          ? (data.risks as unknown[]).filter((step): step is string => typeof step === "string").map((s: string) => redact(s))
          : [],
        nextAction: typeof data.nextAction === "string" ? redact(data.nextAction) : undefined,
        createdAt: data.createdAt ?? new Date().toISOString()
      };
    } catch {
      reasoningSummary = {
        id: "reasoning-text",
        runId: "",
        title: "Reasoning Summary",
        summary: redact(rawJson),
        createdAt: new Date().toISOString()
      };
    }
  } else {
    // Check for streaming reasoning-summary
    const openIndex = visibleText.indexOf("<reasoning-summary>");
    if (openIndex !== -1) {
      const partialRaw = visibleText.slice(openIndex + "<reasoning-summary>".length).trim();
      visibleText = visibleText.slice(0, openIndex);
      reasoningSummary = {
        id: "streaming-reasoning",
        runId: "",
        title: "Begründung wird geladen...",
        summary: redact(partialRaw),
        createdAt: new Date().toISOString()
      };
    }
  }

  // 3. Extract plan proposal tags or JSON snippets
  const extractedPlan = extractPlanProposal(visibleText);
  visibleText = extractedPlan.visibleText;
  planProposal = extractedPlan.planProposal;

  // 4. Extract tool-call & function-call tags
  const callTags = ["tool-call", "function-call"];
  for (const tag of callTags) {
    const reg = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
    let match;
    while ((match = reg.exec(visibleText)) !== null) {
      const inner = match[1].trim();
      try {
        const parsed = JSON.parse(redact(inner));
        const name = parsed.tool ?? parsed.name ?? "";
        const args = parsed.input ?? parsed.arguments ?? {};
        if (name) {
          toolCalls.push({
            name: String(name),
            arguments: typeof args === "object" && args !== null ? args : {}
          });
        }
      } catch {
        warnings.push(`Ungültiger JSON-Inhalt in <${tag}>.`);
      }
    }
    // Strip complete tags
    visibleText = visibleText.replace(reg, "");
    
    // Strip incomplete tags
    const openTag = `<${tag}>`;
    const openIdx = visibleText.indexOf(openTag);
    if (openIdx !== -1) {
      const partial = visibleText.slice(openIdx + openTag.length).trim();
      visibleText = visibleText.slice(0, openIdx);
      try {
        const parsed = JSON.parse(redact(partial + "}")); // try completing JSON
        const name = parsed.tool ?? parsed.name ?? "";
        const args = parsed.input ?? parsed.arguments ?? {};
        if (name) {
          toolCalls.push({
            name: String(name),
            arguments: typeof args === "object" && args !== null ? args : {}
          });
        }
      } catch {
        // robustly ignore partial JSON parsing failures
      }
    }
  }

  // Strip unknown tags or mismatched tags from visible text to keep UI clean
  visibleText = visibleText.replace(/<\/?[a-zA-Z0-9_\-]+[^>]*>/g, (tagStr) => {
    const cleanTag = tagStr.replace(/[<\/>]/g, "").split(" ")[0].toLowerCase();
    if (cleanTag === "thought") {
      return tagStr; // Keep thought tags for standard extraction if needed
    }
    return ""; // Strip from visible text
  });

  return {
    visibleText: visibleText.trim(),
    reasoningSummary,
    planProposal,
    toolCalls,
    warnings
  };
}
