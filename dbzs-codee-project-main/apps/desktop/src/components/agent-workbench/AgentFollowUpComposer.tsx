import { useState } from "react";

const QUICK_PROMPTS = [
  "Bitte zuerst Tests ausführen.",
  "Datei aus dem Plan ausschließen.",
  "Aktuellen Step überspringen.",
  "Plan neu bewerten."
];

export type AgentFollowUpComposerProps = {
  disabled: boolean;
  isMutating: boolean;
  onSubmit: (text: string) => void;
};

export function AgentFollowUpComposer({ disabled, isMutating, onSubmit }: AgentFollowUpComposerProps) {
  const [text, setText] = useState("");

  const submit = () => {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    onSubmit(normalized);
    setText("");
  };

  return (
    <section className="border border-dbzs-border bg-dbzs-panelSoft p-3">
      <h3 className="text-sm font-medium text-dbzs-text">Follow-up</h3>
      <p className="mt-1 text-[11px] text-dbzs-muted">
        Ergänzungen während des Runs — gebunden an den aktiven Run, nicht als freier Chat.
      </p>
      <textarea
        className="mt-2 h-20 w-full resize-y border border-dbzs-border bg-dbzs-bg p-2 text-xs text-dbzs-text disabled:opacity-40"
        disabled={disabled}
        onChange={(event) => setText(event.currentTarget.value)}
        placeholder="Priorität ändern, Datei ausschließen, Tests zuerst…"
        value={text}
      />
      <div className="mt-2 flex flex-wrap gap-1">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-muted hover:text-dbzs-text disabled:opacity-40"
            disabled={disabled}
            key={prompt}
            onClick={() => setText(prompt)}
            type="button"
          >
            {prompt}
          </button>
        ))}
      </div>
      <button
        className="mt-2 border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-3 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
        disabled={disabled || isMutating || !text.trim()}
        onClick={submit}
        type="button"
      >
        Follow-up senden
      </button>
    </section>
  );
}
