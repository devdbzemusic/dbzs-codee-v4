import { expect, test } from "@playwright/test";
import { installTestBridge, openRuntimeChatPanel, runtimeChatComposer } from "./helpers/test-bridge";

test("realer Context-Aufbau erreicht den finalen Runtime-Request ohne doppelte Quellen", async ({ page }) => {
  await installTestBridge(page, { chatResponse: "Kontext wurde verarbeitet." });
  await openRuntimeChatPanel(page);
  await runtimeChatComposer(page).fill("Pruefe subtract in src/calculator.ts und den zugehoerigen Test");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect
    .poll(async () => {
      const hooks = await page.evaluate(() => {
        return (window as unknown as { __dbzsE2E: { chatCalls: Array<{ messages: Array<{ content?: string }> }> } }).__dbzsE2E;
      });
      return hooks.chatCalls.length;
    }, { timeout: 30_000 })
    .toBeGreaterThan(0);

  const messages = await page.evaluate(() => {
    const hooks = (window as unknown as { __dbzsE2E: { chatCalls: Array<{ messages: Array<{ content?: string }> }> } }).__dbzsE2E;
    return hooks.chatCalls.at(-1)?.messages ?? [];
  });
  const serialized = messages.map((message) => message.content ?? "").join("\n\n");
  expect(serialized).toContain("src/calculator.ts");
  expect(serialized).toContain("[Code Index]");

  const sourceRefs = [...serialized.matchAll(/Source: ([^\n]+)/g)].map((match) => match[1]);
  if (sourceRefs.length > 0) {
    expect(new Set(sourceRefs).size).toBe(sourceRefs.length);
  }

  const sampledFileRefs = [...serialized.matchAll(/^### ([^\n]+) \(/gm)].map((match) => match[1]);
  expect(new Set(sampledFileRefs).size).toBe(sampledFileRefs.length);
});
