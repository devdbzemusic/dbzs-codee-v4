import { useState } from "react";
import type { AssistantAnswer, AssistantQuestion } from "@dbzs/shared";

function riskClass(riskLevel?: string): string {
  switch (riskLevel) {
    case "low":
      return "text-green-400 border-green-400/30 bg-green-400/10";
    case "high":
      return "text-red-400 border-red-400/30 bg-red-400/10";
    default:
      return "text-amber-400 border-amber-400/30 bg-amber-400/10";
  }
}

interface AssistantQuestionCardProps {
  question: AssistantQuestion;
  busy: boolean;
  onSubmit: (answer: AssistantAnswer) => void;
}

export function AssistantQuestionCard({ question, busy, onSubmit }: AssistantQuestionCardProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(
    question.defaultOptionId ? [question.defaultOptionId] : []
  );
  const [freeText, setFreeText] = useState("");
  const [showFreeText, setShowFreeText] = useState(question.questionType === "free_text");
  const [filePath, setFilePath] = useState("");

  const isChoice =
    question.questionType === "single_choice" ||
    question.questionType === "boolean" ||
    question.questionType === "confirm_risky_action";
  const isMultiChoice = question.questionType === "multi_choice";
  const isFileLike = question.questionType === "file_picker" || question.questionType === "folder_picker";

  function toggleOption(optionId: string) {
    if (isMultiChoice) {
      setSelectedIds((current) =>
        current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]
      );
    } else {
      setSelectedIds([optionId]);
    }
  }

  function buildAnswer(): AssistantAnswer {
    const answeredAt = new Date().toISOString();
    if (isFileLike) {
      return { questionId: question.id, answeredAt, filePath: filePath.trim() || undefined };
    }
    // Explicit "own answer" mode always wins over a stale pre-selected option.
    if (showFreeText) {
      return { questionId: question.id, answeredAt, freeText: freeText.trim() };
    }
    if (isChoice || isMultiChoice) {
      return { questionId: question.id, answeredAt, optionIds: selectedIds };
    }
    return { questionId: question.id, answeredAt, freeText: freeText.trim() };
  }

  const canSubmit = isFileLike
    ? filePath.trim().length > 0
    : showFreeText
      ? freeText.trim().length > 0
      : isChoice || isMultiChoice
        ? selectedIds.length > 0
        : freeText.trim().length > 0;

  return (
    <article
      className={`rounded border p-3 ${riskClass(question.riskLevel)}`}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.shiftKey || busy || !canSubmit) return;
        const target = event.target as HTMLElement | null;
        if (target?.tagName === "TEXTAREA") return;
        event.preventDefault();
        onSubmit(buildAnswer());
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em]">Rückfrage</div>
          <h4 className="mt-1 text-xs font-medium text-dbzs-text">{question.prompt}</h4>
        </div>
        {question.riskLevel === "high" ? (
          <span className="shrink-0 rounded border border-red-400/40 bg-red-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-red-400">
            Riskant
          </span>
        ) : null}
      </div>

      {question.context ? (
        <p className="mb-2 text-[11px] leading-5 text-dbzs-muted">Warum frage ich? {question.context}</p>
      ) : null}

      {(isChoice || isMultiChoice) && question.options ? (
        <div className="space-y-1.5" role="radiogroup" aria-label={question.prompt}>
          {question.options.map((option) => {
            const checked = selectedIds.includes(option.id);
            return (
              <label
                className={`flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 text-[11px] text-dbzs-text ${
                  checked
                    ? "border-dbzs-cyan/60 bg-dbzs-cyan/10"
                    : "border-dbzs-border bg-dbzs-bg hover:border-dbzs-cyan/40"
                }`}
                key={option.id}
              >
                <input
                  checked={checked}
                  className="mt-0.5"
                  disabled={busy}
                  name={`question-${question.id}`}
                  onChange={() => toggleOption(option.id)}
                  type={isMultiChoice ? "checkbox" : "radio"}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {option.label}
                    {option.recommended ? (
                      <span className="rounded border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-dbzs-cyan">
                        Empfohlen
                      </span>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="mt-0.5 block text-dbzs-muted">{option.description}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : null}

      {isFileLike ? (
        <input
          className="mt-2 w-full rounded border border-dbzs-border bg-dbzs-bg px-2 py-1.5 text-[11px] text-dbzs-text"
          disabled={busy}
          onChange={(event) => setFilePath(event.target.value)}
          placeholder={question.questionType === "file_picker" ? "workspace-relativer Dateipfad" : "workspace-relativer Ordnerpfad"}
          type="text"
          value={filePath}
        />
      ) : null}

      {question.allowFreeText && (isChoice || isMultiChoice) ? (
        <button
          className="mt-2 text-[10px] text-dbzs-cyan underline"
          onClick={() => setShowFreeText((value) => !value)}
          type="button"
        >
          {showFreeText ? "Auswahl statt Freitext verwenden" : "Eigene Antwort"}
        </button>
      ) : null}

      {showFreeText || question.questionType === "free_text" ? (
        <textarea
          className="mt-2 w-full rounded border border-dbzs-border bg-dbzs-bg px-2 py-1.5 text-[11px] text-dbzs-text"
          disabled={busy}
          onChange={(event) => setFreeText(event.target.value)}
          placeholder={question.freeTextPlaceholder ?? "Deine Antwort..."}
          rows={2}
          value={freeText}
        />
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          className="flex-1 rounded border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1.5 text-xs font-medium text-dbzs-cyan disabled:opacity-40 hover:bg-dbzs-cyan/20"
          disabled={busy || !canSubmit}
          onClick={() => onSubmit(buildAnswer())}
          type="button"
        >
          Antworten
        </button>
        {question.defaultOptionId ? (
          <button
            className="rounded border border-dbzs-border bg-dbzs-bg px-3 py-1.5 text-xs text-dbzs-muted disabled:opacity-40 hover:text-dbzs-text"
            disabled={busy}
            onClick={() =>
              onSubmit({
                questionId: question.id,
                answeredAt: new Date().toISOString(),
                optionIds: [question.defaultOptionId!]
              })
            }
            type="button"
          >
            Empfehlung übernehmen
          </button>
        ) : null}
        <button
          className="rounded border border-dbzs-border bg-dbzs-bg px-3 py-1.5 text-xs text-dbzs-muted disabled:opacity-40 hover:text-dbzs-text"
          disabled={busy}
          onClick={() => onSubmit({ questionId: question.id, answeredAt: new Date().toISOString(), skipped: true })}
          type="button"
        >
          Abbrechen
        </button>
      </div>
    </article>
  );
}
