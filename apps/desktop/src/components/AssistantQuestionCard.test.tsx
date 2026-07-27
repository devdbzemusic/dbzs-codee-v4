import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantAnswer, AssistantQuestion } from "@dbzs/shared";
import { AssistantQuestionCard } from "./AssistantQuestionCard";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeQuestion(overrides: Partial<AssistantQuestion> = {}): AssistantQuestion {
  return {
    id: "q1",
    questionType: "single_choice",
    prompt: "Welche Vorgehensweise?",
    toolCallId: "tc-1",
    options: [
      { id: "a", label: "Option A", recommended: true },
      { id: "b", label: "Option B" }
    ],
    defaultOptionId: "a",
    ...overrides
  };
}

function clickButton(container: HTMLElement, label: string): void {
  const button = [...container.querySelectorAll("button")].find((entry) => entry.textContent === label);
  expect(button).toBeTruthy();
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("AssistantQuestionCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("pre-selects and shows a badge for the recommended option", () => {
    act(() => {
      root.render(<AssistantQuestionCard busy={false} onSubmit={vi.fn()} question={makeQuestion()} />);
    });

    expect(container.textContent).toContain("Empfohlen");
    const radios = [...container.querySelectorAll("input[type=radio]")] as HTMLInputElement[];
    expect(radios.find((r) => r.checked)).toBeTruthy();
  });

  it("submits the selected option id for single_choice", () => {
    let submitted: AssistantAnswer | null = null;
    act(() => {
      root.render(
        <AssistantQuestionCard
          busy={false}
          onSubmit={(answer) => {
            submitted = answer;
          }}
          question={makeQuestion()}
        />
      );
    });

    clickButton(container, "Antworten");

    expect(submitted).not.toBeNull();
    expect(submitted!.optionIds).toEqual(["a"]);
  });

  it("submits all checked options for multi_choice", () => {
    let submitted: AssistantAnswer | null = null;
    act(() => {
      root.render(
        <AssistantQuestionCard
          busy={false}
          onSubmit={(answer) => {
            submitted = answer;
          }}
          question={makeQuestion({
            questionType: "multi_choice",
            options: [
              { id: "a", label: "Option A" },
              { id: "b", label: "Option B" }
            ],
            defaultOptionId: undefined
          })}
        />
      );
    });

    const checkboxes = [...container.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[];
    act(() => {
      checkboxes[0].click();
      checkboxes[1].click();
    });

    clickButton(container, "Antworten");

    expect(submitted).not.toBeNull();
    expect(submitted!.optionIds).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("shows the free-text toggle when allowFreeText is set and submits typed text", () => {
    let submitted: AssistantAnswer | null = null;
    act(() => {
      root.render(
        <AssistantQuestionCard
          busy={false}
          onSubmit={(answer) => {
            submitted = answer;
          }}
          question={makeQuestion({ allowFreeText: true })}
        />
      );
    });

    clickButton(container, "Eigene Antwort");

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(textarea, "meine eigene Antwort");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    clickButton(container, "Antworten");

    expect(submitted).not.toBeNull();
    expect(submitted!.freeText).toBe("meine eigene Antwort");
  });

  it("submits a skipped answer when cancelled", () => {
    let submitted: AssistantAnswer | null = null;
    act(() => {
      root.render(
        <AssistantQuestionCard
          busy={false}
          onSubmit={(answer) => {
            submitted = answer;
          }}
          question={makeQuestion()}
        />
      );
    });

    clickButton(container, "Abbrechen");

    expect(submitted).not.toBeNull();
    expect(submitted!.skipped).toBe(true);
  });

  it("submits the default option when the recommendation is accepted", () => {
    let submitted: AssistantAnswer | null = null;
    act(() => {
      root.render(
        <AssistantQuestionCard
          busy={false}
          onSubmit={(answer) => {
            submitted = answer;
          }}
          question={makeQuestion({ defaultOptionId: "b" })}
        />
      );
    });

    clickButton(container, "Empfehlung übernehmen");

    expect(submitted).not.toBeNull();
    expect(submitted!.optionIds).toEqual(["b"]);
  });

  it("disables the submit button while busy", () => {
    act(() => {
      root.render(<AssistantQuestionCard busy={true} onSubmit={vi.fn()} question={makeQuestion()} />);
    });

    const button = [...container.querySelectorAll("button")].find((entry) => entry.textContent === "Antworten");
    expect(button?.hasAttribute("disabled")).toBe(true);
  });
});
