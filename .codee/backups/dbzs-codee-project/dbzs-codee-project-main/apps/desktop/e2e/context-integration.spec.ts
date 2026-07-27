import { expect, test } from "@playwright/test";
import { installTestBridge, openRuntimeChatPanel } from "./helpers/test-bridge";

test("realer Context-Aufbau erreicht den finalen Runtime-Request ohne doppelte Quellen", async ({ page }) => {
  await installTestBridge(page, { chatResponse: "Kontext wurde verarbeitet." });
  await openRuntimeChatPanel(page);
  await page.getByPlaceholder(/Analysiere, plane oder implementiere/i)
    .fill("Pruefe subtract in src/calculator.ts und den zugehoerigen Test");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(page.getByText("Kontext wurde verarbeitet.", { exact: false })).toBeVisible({ timeout: 30_000 });

  const messages = await page.evaluate(() => {
    const hooks = (window as unknown as { __dbzsE2E: { chatCalls: Array<{ messages: Array<{ content?: string }> }> } }).__dbzsE2E;
    return hooks.chatCalls.at(-1)?.messages ?? [];
  });
  const contextMessages = messages.filter((message) => message.content?.includes("Source:"));
  expect(contextMessages.some((message) => message.content?.includes("src/calculator.ts"))).toBe(true);
  const sources = contextMessages.flatMap((message) => [...(message.content ?? "").matchAll(/Source: ([^\n]+)/g)].map((match) => match[1]));
  expect(new Set(sources).size).toBe(sources.length);
});
