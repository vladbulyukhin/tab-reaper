import { expect, test } from "./helpers/fixtures";

test("keeps diagnostics visible after a failed save and persists a successful retry", async ({
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
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.getByRole("status")).toContainText(
    "Could not save settings",
  );
  await expect(page.getByTestId("cleanupDiagnostics")).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await expect(page.getByTestId("cleanupDiagnostics")).toHaveCount(0);
  await page.reload();
  await expect(toggle).not.toBeChecked();
});
