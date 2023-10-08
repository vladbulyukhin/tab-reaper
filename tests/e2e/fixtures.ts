import { test as base, chromium, type BrowserContext, Worker } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const test = base.extend<{ context: BrowserContext; backgroundPage: Worker; extensionId: string }>({
  context: async ({}, use) => {
    const pathToExtension = path.join(__dirname, '../../dist');
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${pathToExtension}`, `--load-extension=${pathToExtension}`],
    });
    await use(context);
    await context.close();
  },
  backgroundPage: async ({ context }: { context: BrowserContext }, use: (bg: Worker) => Promise<void>) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }

    await use(background);
  },
  extensionId: async ({ backgroundPage }, use) => {
    const extensionId = backgroundPage.url().split('/')[2];
    await use(extensionId);
  },
});

export const expect = test.expect;
