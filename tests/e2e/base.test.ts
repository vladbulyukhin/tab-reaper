import { test, expect } from './fixtures';

test('options page', async ({ page, context, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);

  const input = page.locator('#inactivity-minutes');
  await input.fill('0.1');
  await input.blur();
  await page.locator('#save').click();

  const example1 = await context.newPage();
  await example1.goto('https://www.example.com');

  const example2 = await context.newPage();
  await example2.goto('https://www.example.com');

  await page.bringToFront();

  await expect
    .poll(
      () => {
        const pages = context.pages();
        return pages.length;
      },
      {
        timeout: 30_000,
      }
    )
    .toBe(2); // initial tab + options tab
});
