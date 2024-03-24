import type { Page } from "@playwright/test";

export class TestHelperExtensionPage {
  constructor(
    private readonly page: Page,
    private readonly extensionId: string,
  ) {}

  async goto() {
    await this.page.goto(`chrome-extension://${this.extensionId}/popup.html`);
  }

  async createPinnedTab() {
    await this.page.locator("#pinTabButton").click();
  }

  async createGroupedTabs() {
    await this.page.locator("#groupTabsButton").click();
  }
}
