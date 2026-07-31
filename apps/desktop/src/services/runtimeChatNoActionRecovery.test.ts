import { describe, expect, it } from "vitest";
import {
  analyzeNoActionRecoveryOutput,
  buildNoActionRecoveryPrompt
} from "@/services/runtimeChatNoActionRecovery";

describe("runtimeChatNoActionRecovery", () => {
  it("erkennt Diff- und Dateihinweise aus einer nicht ausgefuehrten Antwort", () => {
    const analysis = analyzeNoActionRecoveryOutput([
      "Datei: `src/app.ts`",
      "```diff",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "```"
    ].join("\n"));

    expect(analysis.hasRecoverableOutput).toBe(true);
    expect(analysis.signals.map((signal) => signal.kind)).toEqual(expect.arrayContaining(["diff", "file_hint"]));
    expect(analysis.summary).toContain("Erkannt:");
  });

  it("erkennt typische Projektbefehle ohne sie auszufuehren", () => {
    const analysis = analyzeNoActionRecoveryOutput("Bitte danach ausfuehren:\n```bash\npnpm test\n```");

    expect(analysis.hasRecoverableOutput).toBe(true);
    expect(analysis.signals[0]).toMatchObject({ kind: "command", label: "Terminal-Befehl" });
  });

  it("baut einen Recovery-Prompt mit Originalauftrag und Evidenz", () => {
    const analysis = analyzeNoActionRecoveryOutput("```ts\nexport const ok = true;\n```");
    const prompt = buildNoActionRecoveryPrompt({
      originalUserPrompt: "Fixe die App.",
      analysis
    });

    expect(prompt).toContain("Urspruenglicher Auftrag: Fixe die App.");
    expect(prompt).toContain("Wandle das jetzt in eine sichere CODEE-Aktion um.");
    expect(prompt).toContain("Code-Block");
  });
});
