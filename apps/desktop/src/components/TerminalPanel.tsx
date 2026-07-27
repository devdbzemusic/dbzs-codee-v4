import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { parseStructuredCommandLine } from "@/services/structuredCommandParser";

interface TerminalLine {
  id: number;
  text: string;
  stream: "stdout" | "stderr" | "system";
}

let lineCounter = 0;

function makeSystemLine(text: string): TerminalLine {
  return { id: lineCounter++, text, stream: "system" };
}

const SESSION_ID = "dbzs-terminal-main";

export function TerminalPanel() {
  const { state } = useWorkspaceStore();
  const [lines, setLines] = useState<TerminalLine[]>([makeSystemLine("Terminal bereit. Befehl eingeben und Enter drücken.")]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const appendLines = useCallback((text: string, stream: "stdout" | "stderr" | "system") => {
    const newLines = text.split(/\r?\n/).map((t) => ({ id: lineCounter++, text: t, stream }));
    setLines((prev) => [...prev.slice(-500), ...newLines]);
  }, []);

  useEffect(() => {
    if (!window.dbzs.onTerminalOutput || !window.dbzs.onTerminalExit) {
      return;
    }

    const removeOutput = window.dbzs.onTerminalOutput((sessionId, data, stream) => {
      if (sessionId !== SESSION_ID) {
        return;
      }
      appendLines(data, stream);
    });

    const removeExit = window.dbzs.onTerminalExit((sessionId, code) => {
      if (sessionId !== SESSION_ID) {
        return;
      }
      setSessionActive(false);
      setRunning(false);
      appendLines(`\n[Prozess beendet mit Code ${code}]`, "system");
    });

    return () => {
      removeOutput();
      removeExit();
    };
  }, [appendLines]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  const startSession = async () => {
    if (!window.dbzs.terminalSessionStart) {
      appendLines("Terminal-Session-Bridge nicht verfügbar.", "system");
      return;
    }

    const cwd = state.projectPath ?? undefined;
    const result = await window.dbzs.terminalSessionStart(SESSION_ID, cwd);
    if (result.started) {
      setSessionActive(true);
      appendLines(`[Shell gestartet${cwd ? ` in ${cwd}` : ""}]`, "system");
    } else {
      appendLines(`[Session bereits aktiv: ${result.reason ?? "unknown"}]`, "system");
      setSessionActive(true);
    }
  };

  const killSession = async () => {
    if (!window.dbzs.terminalSessionKill) {
      return;
    }
    await window.dbzs.terminalSessionKill(SESSION_ID);
    setSessionActive(false);
    setRunning(false);
    appendLines("[Shell beendet]", "system");
  };

  const runCommand = async () => {
    const cmd = input.trim();
    if (!cmd) {
      return;
    }

    setInput("");
    appendLines(`\n> ${cmd}`, "system");

    if (sessionActive && window.dbzs.terminalSessionWrite) {
      await window.dbzs.terminalSessionWrite(SESSION_ID, `${cmd}\n`);
      return;
    }

    if (!window.dbzs.terminalExec) {
      appendLines("Terminal-Bridge nicht verfügbar.", "system");
      return;
    }

    setRunning(true);
    try {
      const cwd = state.projectPath;
      if (!cwd) {
        throw new Error("Kein aktiver Workspace.");
      }
      const result = await window.dbzs.terminalExec(parseStructuredCommandLine(cmd, cwd));
      if (result.stdout) {
        appendLines(result.stdout, "stdout");
      }
      if (result.stderr) {
        appendLines(result.stderr, "stderr");
      }
      appendLines(`[Beendet mit Code ${result.code}]`, "system");
    } catch (error) {
      appendLines(error instanceof Error ? error.message : "Unbekannter Fehler", "stderr");
    } finally {
      setRunning(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !running) {
      void runCommand();
    }
  };

  const clearOutput = () => {
    setLines([makeSystemLine("Ausgabe geleert.")]);
  };

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Terminal</h3>
        <div className="flex items-center gap-1">
          {!sessionActive ? (
            <button
              className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-0.5 text-[11px] text-dbzs-cyan hover:bg-dbzs-cyan/20"
              onClick={() => void startSession()}
              type="button"
            >
              Shell starten
            </button>
          ) : (
            <button
              className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-red hover:bg-dbzs-red/10"
              onClick={() => void killSession()}
              type="button"
            >
              Shell beenden
            </button>
          )}
          <button
            className="border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[11px] text-dbzs-muted hover:text-dbzs-text"
            onClick={clearOutput}
            type="button"
          >
            Löschen
          </button>
        </div>
      </div>

      <div
        ref={outputRef}
        className="mb-2 h-48 overflow-auto border border-dbzs-border bg-[#05080c] p-2 font-mono text-[10px] leading-relaxed"
      >
        {lines.map((line) => (
          <div
            className={
              line.stream === "stderr"
                ? "text-dbzs-red"
                : line.stream === "system"
                  ? "text-dbzs-muted"
                  : "text-dbzs-text"
            }
            key={line.id}
          >
            {line.text}
          </div>
        ))}
        {running ? <div className="animate-pulse text-dbzs-muted">...</div> : null}
      </div>

      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-[11px] text-dbzs-cyan">
          {sessionActive ? "$" : ">"}
        </span>
        <input
          ref={inputRef}
          className="min-w-0 flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 font-mono text-[11px] text-dbzs-text placeholder:text-dbzs-muted focus:outline-none focus:ring-1 focus:ring-dbzs-cyan/50 disabled:opacity-50"
          disabled={running}
          onKeyDown={handleKeyDown}
          onChange={(e) => setInput(e.target.value)}
          placeholder={sessionActive ? "Shell-Befehl eingeben..." : "Einmal-Befehl eingeben..."}
          spellCheck={false}
          type="text"
          value={input}
        />
        <button
          className="shrink-0 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text hover:bg-dbzs-panel disabled:opacity-50"
          disabled={running || !input.trim()}
          onClick={() => void runCommand()}
          type="button"
        >
          ↵
        </button>
      </div>

      <div className="mt-1 text-[10px] text-dbzs-muted">
        {sessionActive
          ? "Shell-Session aktiv — alle Eingaben direkt an den Prozess geleitet"
          : "Einzel-Befehle werden via one-shot exec ausgeführt. Shell starten für interaktive Session."}
      </div>
    </section>
  );
}
