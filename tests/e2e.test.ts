import { expect, test } from "./helpers/fixtures";
import { SettingsPage } from "./pages/OptionsPage";
import { TestHelperExtensionPage } from "./pages/TestHelperExtensionPage";

const waitFor = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

test("should close idle tabs after specified inactivity time", async ({
  page,
  context,
  extensionId,
}) => {
  const optionsPage = new SettingsPage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);
  await waitFor(1_000);

  const example1 = await context.newPage();
  await example1.goto("https://www.example.com");

  const example2 = await context.newPage();
  await example2.goto("https://www.example.com");

  await page.bringToFront();

  await expect
    .poll(() => context.pages().length, {
      timeout: 30_000,
    })
    .toBe(2); // initial tab + options tab
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
  await waitFor(1_000);

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
  const finalPageCount = (await context.pages()).length;

  expect(finalPageCount).toBe(8);
});

test("[EXPERIMENTAL] should close duplicate tabs based on user settings", async ({
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
  await optionsPage.setRemoveExactDuplicates(true);
  await waitFor(1_000);

  const helperPage = new TestHelperExtensionPage(
    await context.newPage(),
    helperExtensionId,
  );

  await helperPage.goto();
  await helperPage.createNewTab("https://www.example.com");
  await helperPage.createNewTab("https://www.example.com");
  await helperPage.createNewTab("https://www.example.org");
  await helperPage.createNewTab("https://www.example.org");

  await waitFor(5_000);
  const pages = await context.pages();
  const finalPageCount = (await context.pages()).length;

  expect(finalPageCount).toBe(4); // main extension + helper extension + example.com + example.org
});
