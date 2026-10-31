import type { Page } from "@playwright/test";

const waitMs = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class TestHelperExtensionPage {
  constructor(
    private readonly page: Page,
    private readonly extensionId: string,
  ) {}

  async goto() {
    await this.page.goto(`chrome-extension://${this.extensionId}/popup.html`);
  }

  async createNewTab(url: string) {
    await this.page.locator("#tabUrl").fill(url);
    await this.page.locator("#createTabButton").click();
    await waitMs(1000);
  }

  async createPinnedTab() {
    await this.page.locator("#pinTabButton").click();
    await waitMs(1000);
  }

  async createGroupedTabs() {
    await this.page.locator("#groupTabsButton").click();
    await waitMs(1000);
  }

  async createWindowWithTabs(urls: string[]): Promise<number> {
    const windowId = await this.page.evaluate(async (windowUrls) => {
      const [firstUrl, ...additionalUrls] = windowUrls;
      if (!firstUrl) return null;

      const createdWindow = await new Promise<chrome.windows.Window>(
        (resolve, reject) => {
          chrome.windows.create(
            { url: firstUrl, focused: false },
            (browserWindow) => {
              const error = chrome.runtime.lastError;
              if (error || !browserWindow?.id) {
                reject(new Error(error?.message ?? "Window was not created"));
                return;
              }

              resolve(browserWindow);
            },
          );
        },
      );

      await Promise.all(
        additionalUrls.map(
          (url) =>
            new Promise<void>((resolve, reject) => {
              chrome.tabs.create(
                {
                  windowId: createdWindow.id,
                  url,
                  active: false,
                },
                () => {
                  const error = chrome.runtime.lastError;
                  if (error) {
                    reject(new Error(error.message));
                    return;
                  }

                  resolve();
                },
              );
            }),
        ),
      );

      return createdWindow.id ?? null;
    }, urls);
    if (typeof windowId !== "number") {
      throw new Error("Window was not created");
    }
    await waitMs(1000);
    return windowId;
  }
}
