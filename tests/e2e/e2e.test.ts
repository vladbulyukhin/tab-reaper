import { expect, test } from './helpers/fixtures';
import { OptionsPage } from './pages/OptionsPage';
import { TestHelperExtensionPage } from './pages/TestHelperExtensionPage';

test('should close idle tabs after specified inactivity time', async ({ page, context, extensionId }) => {
  const optionsPage = new OptionsPage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);
  await optionsPage.saveAndWaitForSuccess();

  const example1 = await context.newPage();
  await example1.goto('https://www.example.com');

  const example2 = await context.newPage();
  await example2.goto('https://www.example.com');

  await page.bringToFront();

  await expect
    .poll(() => context.pages().length, {
      timeout: 30_000,
    })
    .toBe(2); // initial tab + options tab
});

test('should keep pinned and grouped tabs based on user settings', async ({ page, context, extensionId, helperExtensionId }) => {
  const optionsPage = new OptionsPage(page, extensionId);

  await optionsPage.goto();
  await optionsPage.setIdlePeriod(0.2);
  await optionsPage.saveAndWaitForSuccess();

  const helperPage = new TestHelperExtensionPage(await context.newPage(), helperExtensionId);

  await helperPage.goto();
  await helperPage.createPinnedTab();
  await helperPage.createPinnedTab();
  await helperPage.createGroupedTabs();
  await helperPage.createGroupedTabs();

  await page.bringToFront();

  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const finalPageCount = await context.pages().length;

  expect(finalPageCount).toBe(8);
});
