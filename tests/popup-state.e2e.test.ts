import { expect, test } from "./helpers/fixtures";

test("keeps header controls aligned when pause expands and closes it on navigation", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  const settings = page.getByRole("button", { name: "Open settings" });
  const before = await settings.boundingBox();
  expect(before).not.toBeNull();

  await page.getByTestId("pause-cleanup-toggle").click();
  await expect(page.getByTestId("snooze-30m")).toBeVisible();
  const after = await settings.boundingBox();
  expect(after?.y).toBe(before?.y);
  await settings.click();
  await expect(page.getByTestId("snooze-30m")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Return to main" }),
  ).toBeVisible();
});

test("loads current protection with explicit failure, retry, and unsupported-site feedback", async ({
  page,
  extensionId,
}) => {
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    const state = window as typeof window & { allowProtectionRead?: boolean };
    state.allowProtectionRead = false;
    Object.defineProperty(chrome.runtime, "sendMessage", {
      value: (
        message: { type?: string },
        callback?: (value: unknown) => void,
      ) => {
        let response: unknown;
        if (message.type === "getCurrentTabKeepState") {
          response = {
            status: state.allowProtectionRead ? "ok" : "error",
            kept: false,
            uncertain: false,
          };
        } else if (message.type === "isCurrentSiteProtected") {
          response = { supported: false, protected: false, hostname: null };
        } else {
          return callback ? send(message, callback) : send(message);
        }
        callback?.(response);
        return Promise.resolve(response);
      },
    });
  });

  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await expect(page.getByTestId("current-tab-status")).toHaveText(
    "Status unavailable",
  );
  await expect(page.getByTestId("currentTabKeepToggle")).toBeDisabled();
  await page.evaluate(() => {
    (
      window as typeof window & { allowProtectionRead?: boolean }
    ).allowProtectionRead = true;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByTestId("current-tab-status")).toHaveText(
    "Tab eligible",
  );
  await expect(
    page.getByRole("heading", { name: "Not a website tab" }),
  ).toBeVisible();
  await expect(page.getByTestId("currentSiteProtectToggle")).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("ignores a history read from an unmounted screen after a newer snapshot is loaded", async ({
  page,
  extensionId,
}) => {
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let reads = 0;
    Object.defineProperty(chrome.runtime, "sendMessage", {
      value: (
        message: { type?: string },
        callback?: (value: unknown) => void,
      ) => {
        if (message.type !== "getRecentlyClosedTabs")
          return callback ? send(message, callback) : send(message);
        const first = ++reads === 1;
        const response = {
          activityToken: 0,
          tabs: [
            {
              id: first ? 1 : 2,
              title: first ? "Stale snapshot" : "Latest snapshot",
              url: "https://example.com",
              reason: "idle",
              removedAt: new Date().toISOString(),
            },
          ],
        };
        return new Promise((resolve) => {
          setTimeout(
            () => {
              callback?.(response);
              resolve(response);
            },
            first ? 800 : 0,
          );
        });
      },
    });
  });

  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Return to main" }).click();
  await expect(
    page.getByRole("link", { name: /Latest snapshot/ }),
  ).toBeVisible();
  // Let the superseded request arrive; it must not replace the visible snapshot.
  await page.waitForTimeout(1000);
  await expect(
    page.getByRole("link", { name: /Latest snapshot/ }),
  ).toBeVisible();
  await expect(page.getByText("Stale snapshot")).toHaveCount(0);
});
