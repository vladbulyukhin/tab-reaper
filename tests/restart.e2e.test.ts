import { type Server, createServer } from "node:http";
import type { BrowserContext, Page } from "@playwright/test";
import { sendExtensionMessage } from "./helpers/extensionMessages";
import { expect, test } from "./helpers/fixtures";
import { HomePage } from "./pages/HomePage";

type Diagnostics = {
  background: { instanceId: string };
  events: Array<{
    details?: { deadline?: number; tab?: { id?: number } };
    event: string;
  }>;
  queries: { allTabs: Array<{ id?: number; url?: string }> };
};

type LedgerRecord = {
  deadline?: number;
  id: string;
  kept: boolean;
  tabId?: number;
};

const diagnostics = (page: Page) =>
  sendExtensionMessage<Diagnostics>(page, "getCleanupDiagnostics", undefined);

const configureCleanup = async (page: Page, delayMinutes: number) => {
  const current = await sendExtensionMessage<Record<string, unknown>>(
    page,
    "getConfig",
    undefined,
  );
  await expect(
    sendExtensionMessage(page, "setConfig", {
      ...current,
      diagnosticsEnabled: true,
      removeExactDuplicates: false,
      tabCountThreshold: 0,
      tabRemovalDelayMin: delayMinutes,
    }),
  ).resolves.toMatchObject({ status: "ok" });
};

const queryTabsByUrl = (page: Page, url: string) =>
  page.evaluate(
    (targetUrl) =>
      new Promise<Array<{ id: number; url: string; windowId: number }>>(
        (resolve, reject) => {
          chrome.tabs.query({}, (tabs) => {
            const error = chrome.runtime.lastError;
            if (error) return reject(new Error(error.message));
            resolve(
              tabs
                .filter(
                  (
                    tab,
                  ): tab is chrome.tabs.Tab & {
                    id: number;
                    url: string;
                    windowId: number;
                  } => tab.id !== undefined && tab.url === targetUrl,
                )
                .map(({ id, url, windowId }) => ({ id, url, windowId })),
            );
          });
        },
      ),
    url,
  );

const createTab = (page: Page, url: string) =>
  page.evaluate(
    (tabUrl) =>
      new Promise<number>((resolve, reject) => {
        chrome.tabs.create({ url: tabUrl, active: false }, (tab) => {
          const error = chrome.runtime.lastError;
          if (error) return reject(new Error(error.message));
          if (tab.id === undefined) return reject(new Error("No tab ID"));
          resolve(tab.id);
        });
      }),
    url,
  );

const removeTabs = (page: Page, tabIds: number[]) =>
  page.evaluate(
    (ids) =>
      new Promise<void>((resolve, reject) => {
        chrome.tabs.remove(ids, () => {
          const error = chrome.runtime.lastError;
          error ? reject(new Error(error.message)) : resolve();
        });
      }),
    tabIds,
  );

const activateTab = (page: Page, tabId: number) =>
  page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        chrome.tabs.update(id, { active: true }, () => {
          const error = chrome.runtime.lastError;
          error ? reject(new Error(error.message)) : resolve();
        });
      }),
    tabId,
  );

const navigateTab = (page: Page, tabId: number, url: string) =>
  page.evaluate(
    ([id, targetUrl]) =>
      new Promise<void>((resolve, reject) => {
        chrome.tabs.update(id, { url: targetUrl }, () => {
          const error = chrome.runtime.lastError;
          error ? reject(new Error(error.message)) : resolve();
        });
      }),
    [tabId, url] as const,
  );

const scheduledDeadline = async (page: Page, url: string) => {
  const snapshot = await diagnostics(page);
  const tabId = snapshot.queries.allTabs.find((tab) => tab.url === url)?.id;
  return [...snapshot.events]
    .reverse()
    .find(
      (event) =>
        event.event === "schedule-alarm-set" &&
        event.details?.tab?.id === tabId,
    )?.details?.deadline;
};

const boundRecord = async (page: Page, url: string) => {
  const snapshot = await diagnostics(page);
  const tabId = snapshot.queries.allTabs.find((tab) => tab.url === url)?.id;
  const records = await page.evaluate(async () => {
    const stored = await chrome.storage.local.get("idleTabLedger");
    return (
      (stored.idleTabLedger as { records?: LedgerRecord[] } | undefined)
        ?.records ?? []
    );
  });
  return records.find((record) => record.tabId === tabId);
};

const readLedger = (page: Page) =>
  page.evaluate(
    async () => (await chrome.storage.local.get("idleTabLedger")).idleTabLedger,
  );

const storedRecordById = async (page: Page, recordId: string) => {
  const ledger = (await readLedger(page)) as { records?: LedgerRecord[] };
  return ledger.records?.find((record) => record.id === recordId);
};

const writeLedger = (page: Page, ledger: unknown) =>
  page.evaluate(
    (value) => chrome.storage.local.set({ idleTabLedger: value }),
    ledger,
  );

const restartWorker = async (
  context: BrowserContext,
  page: Page,
  extensionId: string,
  previousInstanceId: string,
) => {
  const session = await context.newCDPSession(page);
  const versionsPromise = new Promise<
    Array<{ scriptURL: string; versionId: string }>
  >((resolve) => {
    session.once("ServiceWorker.workerVersionUpdated", (event) =>
      resolve(event.versions),
    );
  });
  await session.send("ServiceWorker.enable");
  const versions = await versionsPromise;
  const worker = versions.find((version) =>
    version.scriptURL.startsWith(`chrome-extension://${extensionId}/`),
  );
  if (!worker) throw new Error("Tab Reaper service worker was not found");
  await session.send("ServiceWorker.stopWorker", {
    versionId: worker.versionId,
  });
  await expect
    .poll(async () => {
      try {
        return (await diagnostics(page)).background.instanceId;
      } catch {
        return previousInstanceId;
      }
    })
    .not.toBe(previousInstanceId);
  return page;
};

const startServer = async (): Promise<{ origin: string; server: Server }> => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<title>${request.url ?? "Tab"}</title>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server port");
  return { origin: `http://127.0.0.1:${address.port}`, server };
};

const withServer = async (run: (origin: string) => Promise<void>) => {
  const { origin, server } = await startServer();
  try {
    await run(origin);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};

test.describe("extension state across Chrome worker and tab restarts", () => {
  test("does not hold a fresh same-URL tab after a missed close notification", async ({
    page,
    extensionId,
  }) => {
    const homePage = new HomePage(page, extensionId);
    await homePage.goto();
    await configureCleanup(page, 1);
    await withServer(async (origin) => {
      const url = `${origin}/previously-kept`;
      const oldId = await createTab(page, url);
      await activateTab(page, oldId);
      await page.reload();
      await homePage.getCurrentTabKeepToggle().click();
      await expect(homePage.getCurrentTabKeepToggle()).toBeChecked();
      const saved = await page.evaluate(() =>
        chrome.storage.local.get(["idleTabLedger", "excludedTabs"]),
      );
      const recordId = (await boundRecord(page, url))?.id;
      expect(recordId).toBeDefined();
      await removeTabs(page, [oldId]);
      await expect
        .poll(() => storedRecordById(page, recordId as string))
        .toBeUndefined();
      // Restore the pre-close state to model a notification that never arrived.
      await page.evaluate((state) => chrome.storage.local.set(state), saved);
      const freshId = await createTab(page, url);
      expect(freshId).not.toBe(oldId);
      await activateTab(page, freshId);
      await expect
        .poll(() =>
          sendExtensionMessage(page, "getCurrentTabKeepState", undefined),
        )
        .toEqual({
          status: "ok",
          kept: false,
          uncertain: false,
          keepsReset: false,
        });
      await page.reload();
      await expect(homePage.getCurrentTabKeepToggle()).not.toBeChecked();
      await expect(page.getByText("Safety hold", { exact: true })).toHaveCount(
        0,
      );
      await removeTabs(page, [freshId]);
    });
  });

  test("restores the remaining snooze time and resumes cleanup after expiry", async ({
    context,
    page,
    extensionId,
  }) => {
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html#/`);
    await configureCleanup(page, 0.2);

    await withServer(async (origin) => {
      const targetUrl = `${origin}/snoozed`;
      const targetTabId = await createTab(page, targetUrl);
      await expect.poll(() => queryTabsByUrl(page, targetUrl)).toHaveLength(1);

      const started = await sendExtensionMessage<{
        status: string;
        until: string | null;
      }>(page, "setSnooze", { minutes: 30 });
      expect(started.status).toBe("ok");
      expect(started.until).not.toBeNull();

      // Move only the persisted deadline forward to model returning after
      // twenty minutes without making the test wait in real time.
      const tenMinutesLeft = new Date(Date.now() + 10 * 60_000).toISOString();
      await page.evaluate(
        (until) =>
          chrome.storage.local.set({ snooze: JSON.stringify({ until }) }),
        tenMinutesLeft,
      );
      let oldInstance = (await diagnostics(page)).background.instanceId;
      page = await restartWorker(context, page, extensionId, oldInstance);

      const resumed = await sendExtensionMessage<{
        snoozed: boolean;
        until: string | null;
        remainingMinutes: number | null;
      }>(page, "getSnoozeStatus", undefined);
      expect(resumed).toEqual({
        snoozed: true,
        until: tenMinutesLeft,
        remainingMinutes: 10,
      });
      await expect.poll(() => queryTabsByUrl(page, targetUrl)).toHaveLength(1);

      const alreadyExpired = new Date(Date.now() - 60_000).toISOString();
      await page.evaluate(
        (until) =>
          chrome.storage.local.set({ snooze: JSON.stringify({ until }) }),
        alreadyExpired,
      );
      oldInstance = (await diagnostics(page)).background.instanceId;
      page = await restartWorker(context, page, extensionId, oldInstance);

      await expect
        .poll(() => sendExtensionMessage(page, "getSnoozeStatus", undefined))
        .toEqual({ snoozed: false, until: null, remainingMinutes: null });
      await expect
        .poll(() => queryTabsByUrl(page, targetUrl), { timeout: 20_000 })
        .toHaveLength(0);
      await removeTabs(page, [targetTabId]).catch(() => undefined);
    });
  });

  test("persists disabled diagnostics across a worker restart and resumes on demand", async ({
    context,
    page,
    extensionId,
  }) => {
    await page.goto(
      `chrome-extension://${extensionId}/src/popup/index.html#/settings`,
    );
    const toggle = page.getByTestId("diagnosticsEnabled");
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(page.getByTestId("cleanupDiagnostics")).toBeVisible();

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId("cleanupDiagnostics")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await sendExtensionMessage<{ diagnosticsEnabled: boolean }>(
              page,
              "getConfig",
              undefined,
            )
          ).diagnosticsEnabled,
      )
      .toBe(false);
    const oldInstance = (await diagnostics(page)).background.instanceId;
    page = await restartWorker(context, page, extensionId, oldInstance);
    await page.reload();
    await expect(page.getByTestId("diagnosticsEnabled")).not.toBeChecked();

    const ignoredTabId = await createTab(
      page,
      "https://www.example.com/?diagnostics=off",
    );
    await page.waitForTimeout(500);
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await chrome.storage.local.get("cleanupDiagnosticsEvents"))
              .cleanupDiagnosticsEvents,
        ),
      )
      .toBeUndefined();
    await removeTabs(page, [ignoredTabId]);

    await page.getByTestId("diagnosticsEnabled").click();
    await expect(page.getByTestId("cleanupDiagnostics")).toBeVisible();
    const recordedTabId = await createTab(
      page,
      "https://www.example.org/?diagnostics=on",
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await chrome.storage.local.get("cleanupDiagnosticsEvents"))
              .cleanupDiagnosticsEvents,
        ),
      )
      .not.toBeUndefined();
    await removeTabs(page, [recordedTabId]);
  });

  test("restores the original idle deadline after tab recreation and worker restart", async ({
    context,
    page,
    extensionId,
  }) => {
    test.setTimeout(60_000);
    await page.goto(
      `chrome-extension://${extensionId}/src/popup/index.html#/settings`,
    );
    await configureCleanup(page, 0.25);

    await withServer(async (origin) => {
      const targetUrl = `${origin}/idle`;
      const activeUrl = `${origin}/active`;
      const oldTabId = await createTab(page, targetUrl);
      const activeTabId = await createTab(page, activeUrl);
      await expect.poll(() => queryTabsByUrl(page, targetUrl)).toHaveLength(1);
      await activateTab(page, activeTabId);
      await configureCleanup(page, 0.25);

      let deadline = 0;
      await expect
        .poll(async () => {
          deadline = (await scheduledDeadline(page, targetUrl)) ?? 0;
          return deadline;
        })
        .toBeGreaterThan(Date.now());
      let recordId: string | undefined;
      await expect
        .poll(async () => {
          recordId = (await boundRecord(page, targetUrl))?.id;
          return recordId;
        })
        .not.toBeUndefined();
      const oldInstance = (await diagnostics(page)).background.instanceId;
      const savedLedger = await readLedger(page);

      // A normal tab close deletes its ledger entry. Restore the saved bytes to
      // model a browser process disappearing before onRemoved can run.
      await removeTabs(page, [oldTabId, activeTabId]);
      const acceptedRecordId = recordId as string;
      await expect
        .poll(() => storedRecordById(page, acceptedRecordId))
        .toBeUndefined();
      await writeLedger(page, savedLedger);
      page = await restartWorker(context, page, extensionId, oldInstance);

      const newTabId = await createTab(page, targetUrl);
      const restoredActiveId = await createTab(page, activeUrl);
      await activateTab(page, restoredActiveId);
      await expect.poll(() => queryTabsByUrl(page, targetUrl)).toHaveLength(1);
      expect(newTabId).not.toBe(oldTabId);
      await expect
        .poll(() => scheduledDeadline(page, targetUrl))
        .toBe(deadline);
      await expect
        .poll(() => queryTabsByUrl(page, targetUrl), { timeout: 20_000 })
        .toHaveLength(0);
      await removeTabs(page, [restoredActiveId]).catch(() => undefined);
    });
  });

  test("restores Keep after redirect, tab recreation, and worker restart", async ({
    context,
    page,
    extensionId,
  }) => {
    test.setTimeout(60_000);
    await page.goto(
      `chrome-extension://${extensionId}/src/popup/index.html#/settings`,
    );
    await configureCleanup(page, 0.2);

    await withServer(async (origin) => {
      const initialUrl = `${origin}/keep-before`;
      const keptUrl = `${origin}/keep-after`;
      const activeUrl = `${origin}/active`;
      const oldTabId = await createTab(page, initialUrl);
      const activeTabId = await createTab(page, activeUrl);
      await expect.poll(() => queryTabsByUrl(page, initialUrl)).toHaveLength(1);
      await activateTab(page, activeTabId);
      await configureCleanup(page, 0.2);
      await expect
        .poll(() => scheduledDeadline(page, initialUrl))
        .not.toBeUndefined();
      await expect
        .poll(async () => boundRecord(page, initialUrl))
        .not.toBeUndefined();

      const homePage = new HomePage(page, extensionId);
      await homePage.goto();
      await activateTab(page, oldTabId);
      await page.reload();
      await homePage.getCurrentTabKeepToggle().click();
      await expect(homePage.getCurrentTabKeepToggle()).toBeChecked();
      await navigateTab(page, oldTabId, keptUrl);
      await expect.poll(() => queryTabsByUrl(page, keptUrl)).toHaveLength(1);
      await activateTab(page, activeTabId);
      await expect
        .poll(async () => (await boundRecord(page, keptUrl))?.kept)
        .toBe(true);
      const recordId = (await boundRecord(page, keptUrl))?.id;
      expect(recordId).toBeDefined();
      const oldInstance = (await diagnostics(page)).background.instanceId;
      const savedLedger = await readLedger(page);

      // Model the same abrupt-loss condition for a kept tab.
      await removeTabs(page, [oldTabId, activeTabId]);
      const acceptedRecordId = recordId as string;
      await expect
        .poll(() => storedRecordById(page, acceptedRecordId))
        .toBeUndefined();
      await writeLedger(page, savedLedger);
      page = await restartWorker(context, page, extensionId, oldInstance);

      const restoredKeptId = await createTab(page, keptUrl);
      const restoredActiveId = await createTab(page, activeUrl);
      await activateTab(page, restoredActiveId);
      const [restoredKept] = await queryTabsByUrl(page, keptUrl);
      expect(restoredKept.id).not.toBe(oldTabId);
      await new Promise((resolve) => setTimeout(resolve, 13_000));
      await expect.poll(() => queryTabsByUrl(page, keptUrl)).toHaveLength(1);
      await activateTab(page, restoredKept.id);
      await expect
        .poll(() =>
          sendExtensionMessage<boolean>(
            page,
            "isCurrentTabExcluded",
            undefined,
          ),
        )
        .toBe(true);
      await removeTabs(page, [restoredKeptId, restoredActiveId]);
    });
  });
});
