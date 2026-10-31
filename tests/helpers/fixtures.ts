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
const pathToHelperExtension = path.join(__dirname, "./extension");
const pathToExtension = path.join(__dirname, "../../dist");
const shouldRunHeadless = process.env.PLAYWRIGHT_EXTENSION_HEADLESS !== "0";

const chromiumExecutable = (): string | undefined => {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }

  // Branded Chrome no longer supports loading unpacked extensions via the
  // command-line flags used below. Playwright's bundled Chrome for Testing
  // retains that support and is pinned by the lockfile.
  return chromium.executablePath();
};

const waitForServiceWorker = async (
  context: BrowserContext,
  matches: (worker: Worker) => boolean,
  label: string,
): Promise<Worker> => {
  const observedUrls = new Set<string>();
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      observedUrls.add(worker.url());
      if (matches(worker)) {
        return worker;
      }
    }

    try {
      const worker = await context.waitForEvent("serviceworker", {
        timeout: deadline - Date.now(),
      });
      observedUrls.add(worker.url());
      if (matches(worker)) {
        return worker;
      }
    } catch {
      break;
    }
  }

  const observed = [...observedUrls].join(", ") || "none";
  throw new Error(
    `Timed out waiting for ${label} service worker. Observed: ${observed}`,
  );
};

export const test = base.extend<{
  context: BrowserContext;
  backgroundPage: Worker;
  helperExtensionId: string;
  extensionId: string;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: This is required for playwright to work
  context: async ({}, use) => {
    const executablePath = chromiumExecutable();
    const context = await chromium.launchPersistentContext("", {
      executablePath,
      headless: false,
      args: [
        ...(shouldRunHeadless ? ["--headless=new"] : []),
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
    const background = await waitForServiceWorker(
      context,
      (worker) => worker.url().includes("service-worker-loader.js"),
      "Tab Reaper",
    );

    await use(background);
  },
  extensionId: async ({ backgroundPage }, use) => {
    const extensionId = backgroundPage.url().split("/")[2];
    await use(extensionId);
  },
  helperExtensionId: async ({ context }: { context: BrowserContext }, use) => {
    const background = await waitForServiceWorker(
      context,
      (worker) => worker.url().includes("helper"),
      "E2E helper",
    );

    const helperExtensionId = background.url().split("/")[2];
    await use(helperExtensionId);
  },
});

export const expect = test.expect;
