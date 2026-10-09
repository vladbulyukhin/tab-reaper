import type { BrowserContext, Page } from "@playwright/test";
import { sendExtensionMessage } from "./helpers/extensionMessages";
import { expect, test } from "./helpers/fixtures";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/OptionsPage";
import { TestHelperExtensionPage } from "./pages/TestHelperExtensionPage";

const waitFor = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const normalizeUrl = (url: string) => new URL(url).href;

const isWebUrl = (url: string) => /^https?:\/\//.test(url);

const webPageUrls = (context: BrowserContext) =>
  context
    .pages()
    .map((p) => p.url())
    .filter(isWebUrl);

const webPageCount = (context: BrowserContext) => webPageUrls(context).length;

const webPageCountByUrl = (context: BrowserContext, url: string) => {
  const expectedUrl = normalizeUrl(url);
  return webPageUrls(context).filter((pageUrl) => pageUrl === expectedUrl)
    .length;
};

const expectWebPageCount = async (
  context: BrowserContext,
  count: number,
  timeout = 30_000,
) => {
  await expect.poll(() => webPageCount(context), { timeout }).toBe(count);
};

const expectWebPageCountByUrl = async (
  context: BrowserContext,
  url: string,
  count: number,
  timeout = 30_000,
) => {
  await expect
    .poll(() => webPageCountByUrl(context, url), { timeout })
    .toBe(count);
};

const isTabAudible = (page: Page, url: string) =>
  page.evaluate(
    (targetUrl) =>
      new Promise<boolean>((resolve, reject) => {
        chrome.tabs.query({}, (tabs) => {
          const error = chrome.runtime.lastError;
          if (error) return reject(new Error(error.message));
          resolve(
            tabs.some((tab) => tab.url === targetUrl && Boolean(tab.audible)),
          );
        });
      }),
    normalizeUrl(url),
  );

test("should close idle tabs after specified inactivity time", async ({
  page,
  context,
  extensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);

  const example1 = await context.newPage();
  await example1.goto("https://www.example.com");

  const example2 = await context.newPage();
  await example2.goto("https://www.example.com");

  await page.bringToFront();

  await expectWebPageCount(context, 0);
});

test("should restart existing countdowns when the timeout changes", async ({
  page,
  context,
  extensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);
  await optionsPage.goto();
  await optionsPage.setIdlePeriod(1);

  const firstTab = await context.newPage();
  await firstTab.goto("https://www.example.com/?timer=first");
  const secondTab = await context.newPage();
  await secondTab.goto("https://www.example.org/?timer=second");
  await page.bringToFront();
  await waitFor(3_000);

  await optionsPage.setIdlePeriod(0.2);
  await waitFor(8_000);
  expect(webPageCount(context)).toBe(2);
  await expectWebPageCount(context, 0, 15_000);
});

test("should keep pinned and grouped tabs based on user settings", async ({
  page,
  context,
  extensionId,
  helperExtensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);

  const helperPage = new TestHelperExtensionPage(
    await context.newPage(),
    helperExtensionId,
  );

  await helperPage.goto();
  await helperPage.createPinnedTab();
  await helperPage.createPinnedTab();
  await helperPage.createGroupedTabs();
  await helperPage.createGroupedTabs();

  await page.bringToFront();

  await waitFor(15_000);

  expect(webPageCount(context)).toBe(6);
});

test("should keep an audible tab while reaping a regular tab", async ({
  page,
  context,
  extensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);
  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);
  await optionsPage.setAudibleTabs(true);

  const audibleUrl = "https://www.example.com/?audible=true";
  const audibleTab = await context.newPage();
  await audibleTab.goto(audibleUrl);
  await audibleTab.locator("body").click();
  await audibleTab.evaluate(async () => {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    gain.gain.value = 0.1;
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    await audioContext.resume();
  });
  await expect.poll(() => isTabAudible(page, audibleUrl)).toBe(true);

  const regularTab = await context.newPage();
  await regularTab.goto("https://www.example.org/?audible=false");
  await page.bringToFront();

  await expectWebPageCount(context, 1);
  await expectWebPageCountByUrl(context, audibleUrl, 1);
});

test("should close duplicate tabs regardless of the safety threshold", async ({
  page,
  context,
  extensionId,
  helperExtensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setPinnedTabs(false);
  await optionsPage.setAudibleTabs(false);
  await optionsPage.setGroupedTabs(false);
  await optionsPage.setSafetyThreshold(100);
  await optionsPage.setRemoveExactDuplicates(true);
  await expect
    .poll(async () => {
      const config = await sendExtensionMessage<{
        removeExactDuplicates: boolean;
      }>(page, "getConfig", undefined);
      return config.removeExactDuplicates;
    })
    .toBe(true);

  const helperPage = new TestHelperExtensionPage(
    await context.newPage(),
    helperExtensionId,
  );

  await helperPage.goto();
  await helperPage.createNewTab("https://www.example.com");
  await helperPage.createNewTab("https://www.example.com");
  await helperPage.createNewTab("https://www.example.org");
  await helperPage.createNewTab("https://www.example.org");

  await expectWebPageCount(context, 2);
  await expectWebPageCountByUrl(context, "https://www.example.com", 1);
  await expectWebPageCountByUrl(context, "https://www.example.org", 1);

  const history = await sendExtensionMessage<{
    tabs: Array<{ reason: string; url?: string }>;
  }>(page, "getRecentlyClosedTabs", undefined);
  expect(history.tabs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        reason: "duplicate",
        url: expect.stringMatching(/^https:\/\/www\.example\.(com|org)\/$/),
      }),
    ]),
  );

  const homePage = new HomePage(page, extensionId);
  await homePage.goto();
  const firstClosed = history.tabs.find(
    (tab): tab is { reason: string; url: string } =>
      tab.reason === "duplicate" && typeof tab.url === "string",
  );
  expect(firstClosed).toBeDefined();
  const [reopenedPage] = await Promise.all([
    context.waitForEvent("page"),
    page.locator('a[target="_blank"]').first().click(),
  ]);
  await expect
    .poll(() => reopenedPage.url())
    .toBe(normalizeUrl(firstClosed.url));
});

test("should keep recently closed controls compact until expanded", async ({
  page,
  extensionId,
}) => {
  const homePage = new HomePage(page, extensionId);

  await homePage.goto();
  await homePage.seedRecentlyClosedTabs();
  await page.reload();

  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeVisible();
  await expect(page.getByText("Recently reaped tabs")).toBeVisible();
  await expect(page.getByText("5 saved")).toBeVisible();
  await expect(homePage.getRecentlyClosedSearch()).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Alpha documentation/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Delta inbox/ })).toHaveCount(0);

  await homePage.getRecentlyClosedExpandButton().click();

  await expect(homePage.getRecentlyClosedSearch()).toBeVisible();
  const unsafeRow = page
    .locator("a")
    .filter({ hasText: "Unsafe legacy entry" });
  await expect(unsafeRow).toContainText("Closed");
  await expect(unsafeRow).not.toHaveAttribute("href", /.+/);

  await page.getByTestId("recentlyClosedReason-duplicate").click();
  await expect(page.getByText("Beta dashboard")).toBeVisible();
  await expect(page.getByText("Alpha documentation")).toHaveCount(0);
  await expect(page.getByText("Unsafe legacy entry")).toHaveCount(0);

  await page.getByTestId("recentlyClosedReason-idle").click();
  await expect(page.getByText("Alpha documentation")).toBeVisible();
  await expect(page.getByText("Delta inbox")).toBeVisible();
  await expect(page.getByText("Beta dashboard")).toHaveCount(0);

  await page.getByTestId("recentlyClosedReason-all").click();
  await homePage.getRecentlyClosedSearch().fill("alpha");
  await expect(
    page.getByRole("link", { name: /Alpha documentation/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Delta inbox/ })).toHaveCount(0);
  await homePage.getRecentlyClosedSearch().fill("no matching saved tab");
  await expect(
    page.getByText("No matches for the current search and filters."),
  ).toBeVisible();

  await homePage.getRecentlyClosedExpandButton().click();
  await homePage.getRecentlyClosedExpandButton().click();

  await expect(homePage.getRecentlyClosedSearch()).toBeVisible();
  await expect(homePage.getRecentlyClosedSearch()).toHaveValue("");
  await expect(page.getByRole("link", { name: /Delta inbox/ })).toBeVisible();
});

test("should display a supplied saved favicon", async ({
  page,
  extensionId,
}) => {
  const homePage = new HomePage(page, extensionId);
  const faviconUrl = `chrome-extension://${extensionId}/icons/icon-active-16.png`;

  await homePage.goto();
  await page.evaluate(async (favIconUrl) => {
    await chrome.storage.session.set({
      recentlyRemovedTabs: JSON.stringify({
        capacity: 50,
        elements: [
          {
            id: 301,
            title: "Saved tab with icon",
            url: "https://example.com/saved",
            favIconUrl,
            reason: "idle",
            removedAt: new Date().toISOString(),
          },
        ],
      }),
    });
  }, faviconUrl);
  await page.reload();

  const favicon = page.locator(`img[src="${faviconUrl}"]`);
  await expect(favicon).toBeVisible();
  await expect
    .poll(() =>
      favicon.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
});

test("should use initials for missing or failed saved favicons without deriving network URLs", async ({
  page,
  extensionId,
}) => {
  const homePage = new HomePage(page, extensionId);
  const derivedFaviconUrls = new Set([
    "https://missing.example/favicon.ico",
    "https://failed.example/favicon.ico",
  ]);

  await page.addInitScript(() => {
    const observedWindow = window as typeof window & {
      __observedImageSources?: string[];
    };
    observedWindow.__observedImageSources = [];

    const recordImages = (node: Node) => {
      if (node instanceof HTMLImageElement) {
        observedWindow.__observedImageSources?.push(node.src);
      }
      if (node instanceof Element) {
        for (const image of node.querySelectorAll("img")) {
          observedWindow.__observedImageSources?.push(image.src);
        }
      }
    };

    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          recordImages(node);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.route("**/favicon.ico", (route) => route.abort());

  await homePage.goto();
  await homePage.seedRecentlyClosedTabsWithFaviconFallbacks();
  await page.reload();

  await expect(page.locator('[title="missing.example"]')).toHaveText("M");
  await expect(page.locator('[title="failed.example"]')).toHaveText("F");
  const observedImageSources = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __observedImageSources?: string[];
        }
      ).__observedImageSources ?? [],
  );
  expect(
    observedImageSources.filter((src) => derivedFaviconUrls.has(src)),
  ).toEqual([]);
});

test("should persist updated cleanup settings", async ({
  page,
  extensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(7);
  await optionsPage.setSafetyThreshold(5);

  await page.reload();

  await expect(page.getByTestId("tabRemovalDelayMin")).toHaveValue("7");
  await expect(page.getByTestId("tabCountThreshold")).toHaveValue("5");
});

test("should keep protected sites during idle cleanup", async ({
  page,
  context,
  extensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);
  await optionsPage.addProtectedSite("example.com");

  const protectedTab = await context.newPage();
  await protectedTab.goto("https://www.example.com");

  const regularTab = await context.newPage();
  await regularTab.goto("https://www.example.org");

  await page.bringToFront();

  await expectWebPageCount(context, 1);
  await expectWebPageCountByUrl(context, "https://www.example.com", 1);
});

test("should keep the current tab when cleanup is disabled for it", async ({
  page,
  context,
  extensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);
  const homePage = new HomePage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);
  await homePage.goto();

  const excludedTab = await context.newPage();
  await excludedTab.goto("https://www.example.com");

  const regularTab = await context.newPage();
  await regularTab.goto("https://www.example.org");

  await excludedTab.bringToFront();
  await page.reload();
  await expect(homePage.getCurrentTabKeepToggle()).not.toBeChecked();
  await homePage.getCurrentTabKeepToggle().click();
  await expect(homePage.getCurrentTabKeepToggle()).toBeChecked();

  await page.bringToFront();

  await expectWebPageCount(context, 1);
  await expectWebPageCountByUrl(context, "https://www.example.com", 1);
});

test("should protect the active tab site when adding the current protected site", async ({
  page,
  context,
  extensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);
  const homePage = new HomePage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);
  await homePage.goto();

  const protectedTab = await context.newPage();
  await protectedTab.goto("https://www.example.com");

  const regularTab = await context.newPage();
  await regularTab.goto("https://www.example.org");

  await protectedTab.bringToFront();
  await page.reload();
  await expect(homePage.getCurrentSiteProtectToggle()).not.toBeChecked();
  await homePage.getCurrentSiteProtectToggle().click();
  await expect(homePage.getCurrentSiteProtectToggle()).toBeChecked();

  await page.bringToFront();

  await expectWebPageCount(context, 1);
  await expectWebPageCountByUrl(context, "https://www.example.com", 1);
});

test("should pause cleanup while snoozed and resume when cleared", async ({
  page,
  context,
  extensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);
  const homePage = new HomePage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);

  await homePage.goto();
  await homePage.snooze30m();
  await expect(homePage.getPauseCleanupToggle()).toBeFocused();
  await expect(homePage.getCurrentTabStatus()).toHaveText("Tab eligible");

  const example1 = await context.newPage();
  await example1.goto("https://www.example.com");

  const example2 = await context.newPage();
  await example2.goto("https://www.example.org");

  await page.bringToFront();
  await waitFor(14_000);
  expect(webPageCount(context)).toBe(2);

  await homePage.resumeCleanup();
  await expect(homePage.getPauseCleanupToggle()).toBeFocused();

  await expectWebPageCount(context, 0);
});

test("should only reap tabs after the threshold is exceeded", async ({
  page,
  context,
  extensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);

  const firstTab = await context.newPage();
  await firstTab.goto("https://www.example.com");

  // The threshold counts all visible window tabs, including this test's popup
  // and helper extension. Set the floor to the actual starting count.
  const floor = await page.evaluate(
    async () => (await chrome.tabs.query({ currentWindow: true })).length,
  );
  await optionsPage.setSafetyThreshold(floor);

  await page.bringToFront();
  await waitFor(14_000);
  expect(webPageCount(context)).toBe(1);

  const secondTab = await context.newPage();
  await secondTab.goto("https://www.example.org");

  await page.bringToFront();

  await expectWebPageCount(context, 1);
});

test("should apply the safety threshold per window instead of globally", async ({
  page,
  context,
  extensionId,
  helperExtensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);
  const homePage = new HomePage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);
  await optionsPage.setSafetyThreshold(2);

  const helperPage = new TestHelperExtensionPage(
    await context.newPage(),
    helperExtensionId,
  );
  await helperPage.goto();

  const firstWindowId = await helperPage.createWindowWithTabs([
    "https://www.example.com/?window=one&tab=one",
    "https://www.example.org/?window=one&tab=two",
    "https://www.example.net/?window=one&tab=three",
  ]);
  const secondWindowId = await helperPage.createWindowWithTabs([
    "https://www.example.com/?window=two&tab=one",
    "https://www.example.org/?window=two&tab=two",
    "https://www.example.net/?window=two&tab=three",
  ]);

  await expect
    .poll(() =>
      Promise.all([
        homePage.getWebTabCountInWindow(firstWindowId),
        homePage.getWebTabCountInWindow(secondWindowId),
      ]),
    )
    .toEqual([3, 3]);

  await page.bringToFront();
  await expect
    .poll(
      () =>
        Promise.all([
          homePage.getWebTabCountInWindow(firstWindowId),
          homePage.getWebTabCountInWindow(secondWindowId),
        ]),
      { timeout: 30_000 },
    )
    .toEqual([2, 2]);
  expect(webPageCount(context)).toBe(4);
});
