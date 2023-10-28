import { test as base, chromium, type BrowserContext, Worker } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// TODO: clear and improve
export const test = base.extend<{
  context: BrowserContext;
  backgroundPage: Worker;
  helperBackgroundPage: Worker;
  helperExtensionId: string;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const pathToHelperExtension = path.join(__dirname, './extension');
    const pathToExtension = path.join(__dirname, '../../../dist');
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToHelperExtension},${pathToExtension}`,
        `--load-extension=${pathToHelperExtension},${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  backgroundPage: async ({ context }: { context: BrowserContext }, use: (bg: Worker) => Promise<void>) => {
    const serviceWorkers = context.serviceWorkers();

    let background = serviceWorkers.find((w) => w.url().includes('service-worker-loader.js'));
    if (!background) {
      const serviceWorker = await context.waitForEvent('serviceworker');
      background = serviceWorker.url().includes('service-worker-loader.js') ? serviceWorker : await context.waitForEvent('serviceworker');
    }

    await use(background);
  },
  extensionId: async ({ backgroundPage }, use) => {
    const extensionId = backgroundPage.url().split('/')[2];
    await use(extensionId);
  },
  helperBackgroundPage: async ({ context }: { context: BrowserContext }, use: (bg: Worker) => Promise<void>) => {
    const serviceWorkers = context.serviceWorkers();

    let background = serviceWorkers.find((w) => w.url().includes('helper'));
    if (!background) {
      const serviceWorker = await context.waitForEvent('serviceworker');
      background = serviceWorker.url().includes('helper') ? serviceWorker : await context.waitForEvent('serviceworker');
    }

    await use(background);
  },
  helperExtensionId: async ({ helperBackgroundPage }, use) => {
    const extensionId = helperBackgroundPage.url().split('/')[2];
    await use(extensionId);
  },
});

export const expect = test.expect;
