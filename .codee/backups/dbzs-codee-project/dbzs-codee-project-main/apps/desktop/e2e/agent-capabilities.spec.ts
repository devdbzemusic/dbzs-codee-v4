import { test, expect } from "@playwright/test";
import { getE2EScenarios, installScenarioBridge, installTestBridge, openRuntimeChatPanel, resolveSkillTitle, sendRuntimeChatPrompt } from "./helpers/test-bridge";
import { loadFixtureRecords } from "./helpers/fixture-workspace";

const fixture = loadFixtureRecords();
const chatScenarios = getE2EScenarios().filter(
  (scenario) =>
    scenario.prompt &&
    !scenario.runtimeState &&
    !scenario.expectJobEnqueue &&
    !scenario.expectSendFalse &&
    scenario.id !== "workspace-context"
);

test.describe("Coding Assistant — Katalog Use Cases (E2E)", () => {
  for (const scenario of chatScenarios) {
    test(`[${scenario.id}] ${scenario.title}`, async ({ page }) => {
      await installScenarioBridge(page, scenario);
      await openRuntimeChatPanel(page);

      await sendRuntimeChatPrompt(page, scenario.prompt!, {
        agentMode: scenario.agentMode,
        skillTitle: resolveSkillTitle(scenario.skillId as string | undefined)
      });

      await expect(page.getByText("Assistant").first()).toBeVisible({ timeout: 15_000 });

      for (const keyword of scenario.expectKeywords ?? []) {
        await expect.poll(async () => (await page.locator("body").innerText()).toLowerCase(), { timeout: 15_000 })
          .toContain(keyword.toLowerCase());
      }
      const bodyText = await page.locator("body").innerText();
      for (const forbidden of scenario.mustNotContain ?? []) {
        expect(bodyText).not.toContain(forbidden);
      }
    });
  }
});

test.describe("Coding Assistant — Infrastruktur Use Cases (E2E)", () => {
  test("workspace-context: Fixture im Chat sichtbar", async ({ page }) => {
    await installScenarioBridge(page, { id: "workspace-context", layers: ["e2e"] } as never);
    await openRuntimeChatPanel(page);
    await expect(page.getByText(fixture.name).first()).toBeVisible();
    await expect(page.getByText(/calculator\.ts|keine Datei/i).first()).toBeVisible();
  });

  test("runtime-offline: Composer deaktiviert", async ({ page }) => {
    await installScenarioBridge(page, {
      id: "runtime-offline",
      layers: ["e2e"],
      runtimeState: "stopped"
    } as never);
    await openRuntimeChatPanel(page);
    await expect(page.getByPlaceholder(/Runtime starten/i)).toBeVisible();
  });

  test("takeover-prose: Freitext erzeugt keine ungeprüfte Aktion", async ({ page }) => {
    const scenario = getE2EScenarios().find((entry) => entry.id === "takeover-prose");
    test.skip(!scenario, "takeover-prose nicht im Katalog");

    await installScenarioBridge(page, scenario!);
    await openRuntimeChatPanel(page);
    await sendRuntimeChatPrompt(page, "Schlage multiply vor");
    await expect(page.getByText("Assistant").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Umsetzen" })).toHaveCount(0);
  });

  test("takeover-patch: Patch-JSON erzeugt keinen Legacy-Takeover", async ({ page }) => {
    const scenario = getE2EScenarios().find((entry) => entry.id === "takeover-patch");
    test.skip(!scenario, "takeover-patch nicht im Katalog");

    await installScenarioBridge(page, scenario!);
    await openRuntimeChatPanel(page);
    await sendRuntimeChatPrompt(page, "Fix subtract");
    await expect(page.getByText("Assistant").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Umsetzen" })).toHaveCount(0);
  });

  test("fix-subtract: Patch-JSON ohne Parse-Fehler", async ({ page }) => {
    const scenario = getE2EScenarios().find((entry) => entry.id === "fix-subtract");
    test.skip(!scenario, "fix-subtract nicht im Katalog");

    await installScenarioBridge(page, scenario!);
    await openRuntimeChatPanel(page);
    await sendRuntimeChatPrompt(page, scenario!.prompt!, { agentMode: true });
    await expect(page.getByText(/Patch-Vorschlag konnte nicht angewendet werden/i)).toHaveCount(0);
    await expect(page.getByText("Assistant").first()).toBeVisible();
  });
});

test.describe("Coding Assistant — Agent Runner UI (E2E)", () => {
  test("Job Monitor laedt Mock-Jobs", async ({ page }) => {
    await installTestBridge(page, {
      jobs: [
        {
          id: "job-fix-subtract",
          title: "Fix subtract in test workspace",
          status: "completed",
          task_type: "analysis",
          priority: 2,
          assigned_agent_role: "coder",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    });
    await page.goto("/");
    await page.getByRole("tab", { name: "Jobs" }).click();
    const jobPanel = page.locator("section, div").filter({ hasText: /Job.*Spooler|Job Monitor/i }).first();
    await jobPanel.scrollIntoViewIfNeeded();
    await expect(jobPanel).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Fix subtract/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
