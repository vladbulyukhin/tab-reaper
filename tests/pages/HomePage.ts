import type { Page } from "@playwright/test";

export class HomePage {
  constructor(
    private readonly page: Page,
    private readonly extensionId: string,
  ) {}

  async goto() {
    await this.page.goto(
      `chrome-extension://${this.extensionId}/src/popup/index.html#/`,
    );
  }

  async snooze30m() {
    await this.page.getByTestId("pause-cleanup-toggle").click();
    await this.page.getByTestId("snooze-30m").click();
  }

  async resumeCleanup() {
    await this.page.getByTestId("pause-cleanup-toggle").click();
    await this.page.getByTestId("snooze-resume").click();
  }

  async seedRecentlyClosedTabs() {
    await this.page.evaluate(async () => {
      const now = Date.now();
      // Persisted queue order is oldest -> newest; the popup receives it reversed.
      const tabs = [
        {
          id: 105,
          title: "Unsafe legacy entry",
          url: "javascript:alert('history')",
          favIconUrl: "",
          removedAt: new Date(now - 300_000).toISOString(),
        },
        {
          id: 104,
          title: "Delta inbox",
          url: "https://delta.example/inbox",
          favIconUrl: "",
          reason: "idle",
          removedAt: new Date(now - 240_000).toISOString(),
        },
        {
          id: 103,
          title: "Gamma article",
          url: "https://gamma.example/article",
          favIconUrl: "",
          reason: "idle",
          removedAt: new Date(now - 180_000).toISOString(),
        },
        {
          id: 102,
          title: "Beta dashboard",
          url: "https://beta.example/dashboard",
          favIconUrl: "",
          reason: "duplicate",
          removedAt: new Date(now - 120_000).toISOString(),
        },
        {
          id: 101,
          title: "Alpha documentation",
          url: "https://alpha.example/docs",
          favIconUrl: "",
          reason: "idle",
          removedAt: new Date(now - 60_000).toISOString(),
        },
      ];

      await chrome.storage.session.set({
        recentlyRemovedTabs: JSON.stringify({ capacity: 50, elements: tabs }),
      });
    });
  }

  async seedRecentlyClosedTabsWithFaviconFallbacks() {
    await this.page.evaluate(async () => {
      const now = Date.now();
      const tabs = [
        {
          id: 202,
          title: "Missing favicon",
          url: "https://missing.example/article",
          favIconUrl: "",
          reason: "idle",
          removedAt: new Date(now - 120_000).toISOString(),
        },
        {
          id: 201,
          title: "Failed favicon",
          url: "https://failed.example/dashboard",
          favIconUrl: chrome.runtime.getURL("missing-favicon.png"),
          reason: "duplicate",
          removedAt: new Date(now - 60_000).toISOString(),
        },
      ];

      await chrome.storage.session.set({
        recentlyRemovedTabs: JSON.stringify({ capacity: 50, elements: tabs }),
      });
    });
  }

  getRecentlyClosedSearch() {
    return this.page.getByTestId("recentlyClosedSearch");
  }

  getRecentlyClosedExpandButton() {
    return this.page.getByTestId("recentlyClosedExpand");
  }

  getCurrentTabKeepToggle() {
    return this.page.getByRole("switch", { name: "Keep this tab" });
  }

  getCurrentSiteProtectToggle() {
    return this.page.getByRole("switch", {
      name: "Always protect this site",
    });
  }

  getPauseCleanupToggle() {
    return this.page.getByTestId("pause-cleanup-toggle");
  }

  getCurrentTabStatus() {
    return this.page.getByTestId("current-tab-status");
  }

  async getWebTabCountInWindow(windowId: number): Promise<number> {
    return this.page.evaluate(
      (targetWindowId) =>
        new Promise<number>((resolve, reject) => {
          chrome.tabs.query({ windowId: targetWindowId }, (tabs) => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }

            resolve(
              tabs.filter((tab) => /^https?:\/\//.test(tab.url ?? "")).length,
            );
          });
        }),
      windowId,
    );
  }
}
