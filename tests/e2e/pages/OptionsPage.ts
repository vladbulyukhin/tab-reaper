import { Page } from '@playwright/test';

export class OptionsPage {
  constructor(private readonly page: Page, private readonly extensionId: string) {}

  async goto() {
    await this.page.goto(`chrome-extension://${this.extensionId}/src/options.html`);
  }

  async setPinnedTabs(enabled: boolean) {
    const input = this.page.locator('#pinned-tabs');

    if (enabled) {
      await input.check();
    } else {
      await input.uncheck();
    }
  }

  async setGroupedTabs(enabled: boolean) {
    const input = this.page.locator('#grouped-tabs');

    if (enabled) {
      await input.check();
    } else {
      await input.uncheck();
    }
  }

  async setAudibleTabs(enabled: boolean) {
    const input = this.page.locator('#audible-tabs');

    if (enabled) {
      await input.check();
    } else {
      await input.uncheck();
    }
  }

  async setIdlePeriod(minutes: number) {
    const input = this.page.locator('#inactivity-minutes');
    await input.fill(minutes.toString());
    await input.blur();
  }

  async saveAndWaitForSuccess() {
    await this.page.locator('#save').click();
    await this.page.waitForSelector('#saved-message', { state: 'visible' });
  }
}
