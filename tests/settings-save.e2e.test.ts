import { expect, test } from "./helpers/fixtures";

test("keeps diagnostics hidden after a failed save and persists a successful retry", async ({
  page,
  extensionId,
}) => {
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let failOnce = true;
    Object.defineProperty(chrome.runtime, "sendMessage", {
      value: (
        message: { type?: string },
        callback?: (value: unknown) => void,
      ) => {
        if (message.type === "setConfig" && failOnce) {
          failOnce = false;
          const response = { status: "error" };
          if (callback) callback(response);
          return Promise.resolve(response);
        }
        return callback ? send(message, callback) : send(message);
      },
    });
  });
  await page.goto(
    `chrome-extension://${extensionId}/src/popup/index.html#/settings`,
  );
  const toggle = page.getByTestId("diagnosticsEnabled");
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(page.getByRole("status")).toContainText(
    "Could not save settings",
  );
  await expect(page.getByTestId("cleanupDiagnostics")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await expect(page.getByTestId("cleanupDiagnostics")).toBeVisible();
  await page.reload();
  await expect(toggle).toBeChecked();
});

test("keeps a toggle click that ends a number edit", async ({
  page,
  extensionId,
}) => {
  await page.goto(
    `chrome-extension://${extensionId}/src/popup/index.html#/settings`,
  );
  const toggle = page.getByTestId("removeExactDuplicates");
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  // The click blurs the number field, which starts a save. The status line
  // must not shift the toggle away from the pointer mid-click.
  await page.getByTestId("tabCountThreshold").fill("8");
  await toggle.check();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(page.getByTestId("tabCountThreshold")).toHaveValue("8");
});
