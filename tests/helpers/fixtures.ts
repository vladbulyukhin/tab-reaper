import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BrowserContext,
  type Worker,
  test as base,
  chromium,
} from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const test = base.extend<{
  context: BrowserContext;
  backgroundPage: Worker;
  helperExtensionId: string;
  extensionId: string;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: This is required for playwright to work
  context: async ({}, use) => {
    const pathToHelperExtension = path.join(__dirname, "./extension");
    const pathToExtension = path.join(__dirname, "../../.output/chrome-mv3");
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        "--headless=new",
        `--disable-extensions-except=${pathToHelperExtension},${pathToExtension}`,
        `--load-extension=${pathToHelperExtension},${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  backgroundPage: async (
    { context }: { context: BrowserContext },
    use: (bg: Worker) => Promise<void>,
  ) => {
    const serviceWorkers = context.serviceWorkers();
    let background = serviceWorkers.find((w) =>
      w.url().includes("background.js"),
    );

    if (!background) {
      const serviceWorker = await context.waitForEvent("serviceworker");
      background = serviceWorker.url().includes("background.js")
        ? serviceWorker
        : await context.waitForEvent("serviceworker");
    }

    await use(background);
  },
  extensionId: async ({ backgroundPage }, use) => {
    const extensionId = backgroundPage.url().split("/")[2];
    await use(extensionId);
  },
  helperExtensionId: async ({ context }: { context: BrowserContext }, use) => {
    const serviceWorkers = context.serviceWorkers();

    let background = serviceWorkers.find((w) => w.url().includes("helper"));
    if (!background) {
      const serviceWorker = await context.waitForEvent("serviceworker");
      background = serviceWorker.url().includes("helper")
        ? serviceWorker
        : await context.waitForEvent("serviceworker");
    }

    const helperExtensionId = background.url().split("/")[2];
    await use(helperExtensionId);
  },
});

export const expect = test.expect;
