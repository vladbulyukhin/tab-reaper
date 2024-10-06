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
}
