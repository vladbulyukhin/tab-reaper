import { expect, test } from "./helpers/fixtures";

test("requires confirmation before forgetting saved Keeps and reports a failed recovery", async ({
  page,
  extensionId,
}) => {
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let cleared = false;
    let failOnce = true;
    Object.defineProperty(chrome.runtime, "sendMessage", {
      value: (
        message: { type?: string },
        callback?: (value: unknown) => void,
      ) => {
        let response: unknown;
        if (message.type === "getCurrentTabKeepState") {
          response = { status: "ok", kept: false, uncertain: !cleared };
        } else if (message.type === "forgetCurrentTabSavedKeeps") {
          response = {
            status: failOnce ? "error" : "ok",
            cleared: failOnce ? 0 : 1,
          };
          cleared = !failOnce;
          failOnce = false;
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
    "Safety hold",
  );
  await page.getByRole("button", { name: "Resolve old saved Keeps…" }).click();
  await expect(
    page.getByText(/This may remove protection from tabs in hidden groups/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByTestId("current-tab-status")).toHaveText(
    "Safety hold",
  );
  await page.getByRole("button", { name: "Resolve old saved Keeps…" }).click();
  await page
    .getByRole("button", { name: "Forget saved Keeps", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Could not forget");
  await page
    .getByRole("button", { name: "Forget saved Keeps", exact: true })
    .click();
  await expect(page.getByTestId("current-tab-status")).toHaveText(
    "Tab eligible",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});
