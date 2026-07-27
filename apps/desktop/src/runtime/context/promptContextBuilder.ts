import type { PromptContext } from "@/runtime/context/contextContracts";

export interface PromptContextBuildResult {
  systemBlock: string;
  contextBlock: string;
}

export class PromptContextBuilder {
  build(context: PromptContext): PromptContextBuildResult {
    const lines = context.signals.map((signal, index) => {
      return [
        `#${index + 1} [${signal.source}] ${signal.key}`,
        signal.value
      ].join("\n");
    });

    return {
      systemBlock: [
        "You are running inside Codee Runtime.",
        "Use tool calls through Tool Runtime only.",
        "Never assume direct filesystem/terminal/git/network access.",
        `Context summary: ${context.summary}`,
        `Token estimate: ${context.estimatedTokens}`
      ].join("\n"),
      contextBlock: lines.join("\n\n")
    };
  }
}
