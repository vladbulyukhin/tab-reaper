import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type BrowserContext, chromium, expect, test } from "@playwright/test";
import { sendExtensionMessage } from "./helpers/extensionMessages";

test("retains history and unread badge across a full browser restart, then acknowledges visible history", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "tab-reaper-history-"));
  const extension = path.resolve("dist");
  let context: BrowserContext | undefined;
  const launch = async () => {
    context = await chromium.launchPersistentContext(profile, {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? chromium.executablePath(),
      headless: false,
      args: [
        ...(process.env.PLAYWRIGHT_EXTENSION_HEADLESS !== "0"
          ? ["--headless=new"]
          : []),
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = worker.url().split("/")[2];
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/src/popup/index.html#/settings`);
    return { page, id };
  };
  try {
    let { page, id } = await launch();
    const config = await sendExtensionMessage<Record<string, unknown>>(
      page,
      "getConfig",
      undefined,
    );
    await sendExtensionMessage(page, "setConfig", {
      ...config,
      removeExactDuplicates: false,
      tabCountThreshold: 0,
      tabRemovalDelayMin: 0.02,
      rememberRecentlyClosedTabs: true,
    });
    await page.evaluate(() =>
      chrome.tabs.create({
        url: "https://example.com/?history-restart",
        active: false,
      }),
    );
    await expect
      .poll(async () => {
        const history = await sendExtensionMessage<{ tabs: unknown[] }>(
          page,
          "getRecentlyClosedTabs",
          undefined,
        );
        return history.tabs.length;
      })
      .toBe(1);
    const badge = () => page.evaluate(() => chrome.action.getBadgeText({}));
    await expect.poll(badge).toBe("1");
    await context?.close();
    ({ page, id } = await launch());
    await expect.poll(badge).toBe("1");
    const restored = await sendExtensionMessage<{
      tabs: Array<{ url?: string }>;
    }>(page, "getRecentlyClosedTabs", undefined);
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0].url).toContain("history-restart");
    await page.goto(`chrome-extension://${id}/src/popup/index.html`);
    await page.locator('a[href*="history-restart"]').scrollIntoViewIfNeeded();
    await expect.poll(badge).toBe("");
    expect(
      (
        await sendExtensionMessage<{ tabs: unknown[] }>(
          page,
          "getRecentlyClosedTabs",
          undefined,
        )
      ).tabs,
    ).toHaveLength(1);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
