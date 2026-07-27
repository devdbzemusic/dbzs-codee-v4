import type { TerminalCommandRequest } from "@dbzs/shared";

const FORBIDDEN_META = /[|&;<>()$`]/;

/** Zerlegt eine Terminalzeile ohne Shell-Auswertung in ein strukturiertes argv. */
export function parseStructuredCommandLine(commandLine: string, cwd: string): TerminalCommandRequest {
  const input = commandLine.trim();
  if (!input || FORBIDDEN_META.test(input)) {
    throw new Error("[COMMAND_BLOCKED] Leerer Befehl oder Shell-Metazeichen.");
  }
  const argv: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (/\s/.test(char) && !quoted) {
      if (current) argv.push(current);
      current = "";
      continue;
    }
    if (char === "'") {
      throw new Error("[COMMAND_BLOCKED] Einfache Quotes sind nicht erlaubt.");
    }
    current += char;
  }
  if (quoted) throw new Error("[COMMAND_BLOCKED] Nicht geschlossenes Quote.");
  if (current) argv.push(current);
  const [command, ...args] = argv;
  if (!command) throw new Error("[COMMAND_BLOCKED] Leerer Befehl.");
  return { command, args, cwd, timeoutMs: 30_000 };
}
