import type { Page } from "@playwright/test";

export class SettingsPage {
  constructor(
    private readonly page: Page,
    private readonly extensionId: string,
  ) {}

  async goto() {
    await this.page.goto(
      `chrome-extension://${this.extensionId}/src/popup/index.html#/settings`,
    );
  }

  async setPinnedTabs(enabled: boolean) {
    const input = this.page.getByTestId("keepPinnedTabs");

    if (enabled) {
      await input.check();
    } else {
      await input.uncheck();
    }
  }

  async setGroupedTabs(enabled: boolean) {
    const input = this.page.getByTestId("keepGroupedTabs");

    if (enabled) {
      await input.check();
    } else {
      await input.uncheck();
    }
  }

  async setAudibleTabs(enabled: boolean) {
    const input = this.page.getByTestId("keepAudibleTabs");

    if (enabled) {
      await input.check();
    } else {
      await input.uncheck();
    }
  }

  async setIdlePeriod(minutes: number) {
    const input = this.page.getByTestId("tabRemovalDelayMin");
    await input.fill(minutes.toString());
    await input.blur();
  }

  async setRemoveExactDuplicates(enabled: boolean) {
    const input = this.page.getByTestId("removeExactDuplicates");
    if (enabled) {
      await input.check();
    } else {
      await input.uncheck();
    }
  }
}
