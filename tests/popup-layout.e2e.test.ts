import { expect, test } from "./helpers/fixtures";

test("fills the expanded iOS viewport while retaining desktop popup dimensions", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect
    .poll(() =>
      page.locator("#root").evaluate((root) => ({
        width: root.clientWidth,
        height: root.clientHeight,
      })),
    )
    .toEqual({ width: 412, height: 600 });
  await page.evaluate(() => {
    document.documentElement.dataset.popupPlatform = "ios";
  });
  for (const height of [400, 850, 500]) {
    await page.setViewportSize({ width: 390, height });
    await expect
      .poll(() =>
        page.locator("#root").evaluate((root) => ({
          width: root.clientWidth,
          height: root.clientHeight,
        })),
      )
      .toEqual({ width: 390, height });
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
  }
});
