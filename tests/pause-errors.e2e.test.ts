import { expect, test } from "./helpers/fixtures";

for (const [operation, failure] of [
  ["setSnooze", "response"],
  ["clearSnooze", "response"],
  ["setSnooze", "rejection"],
  ["clearSnooze", "rejection"],
] as const) {
  test(`shows a failed ${operation} (${failure}) and supports retry`, async ({
    page,
    extensionId,
  }) => {
    await page.addInitScript(
      ({ failedOperation, failureMode }) => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        let failOnce = true;
        Object.defineProperty(chrome.runtime, "sendMessage", {
          value: (
            message: { type?: string },
            callback?: (value: unknown) => void,
          ) => {
            if (message.type === failedOperation && failOnce) {
              failOnce = false;
              if (failureMode === "rejection")
                return Promise.reject(new Error("Background unavailable"));
              const response = { status: "error" };
              callback?.(response);
              return Promise.resolve(response);
            }
            return callback ? send(message, callback) : send(message);
          },
        });
      },
      { failedOperation: operation, failureMode: failure },
    );
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.getByTestId("pause-cleanup-toggle").click();
    await page.getByTestId("snooze-30m").click();
    if (operation === "clearSnooze") {
      await expect(page.getByTestId("pause-cleanup-toggle")).toContainText(
        "30m",
      );
      await page.getByTestId("pause-cleanup-toggle").click();
      await page.getByTestId("snooze-resume").click();
    }
    await expect(page.getByRole("alert")).toContainText("Could not confirm");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByTestId("pause-cleanup-toggle")).toContainText(
      operation === "setSnooze" ? "30m" : "Pause",
    );
  });
}
