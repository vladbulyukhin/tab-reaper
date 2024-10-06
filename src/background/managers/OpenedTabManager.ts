import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { RecentlyClosedTabsBufferSize } from "../../common/constants";
import { emptyConfiguration } from "../../common/models/Configuration";
import type { RemovedTab } from "../../common/models/Tab";
import type { TabId, WindowId } from "../../types";
import { CircularQueue } from "../utils/CircularQueue";
import { PersistedValue } from "../utils/PersistedValue";
import { logInfo } from "../utils/log";
import type { IConfigurationManager } from "./ConfigurationManager";
import type { IExcludedTabManager } from "./ExcludedTabManager";
import type { IExtensionActionManager } from "./ExtensionActionManager";
import type { ITabAlarmManager } from "./TabAlarmManager";

export interface IOpenedTabManager {
  watchTabs(): Promise<void>;
  getRecentlyClosed(): Promise<RemovedTab[]>;
}

export class OpenedTabManager implements IOpenedTabManager {
  private readonly previousActiveTabByWindow: PersistedValue<
    Record<WindowId, TabId>
  >;

  private readonly recentlyRemovedTabs: PersistedValue<
    CircularQueue<RemovedTab>
  >;

  constructor(
    private readonly browserApiProvider: Pick<
      IBrowserApiProvider,
      "tab" | "sessionStorage" | "runtime"
    >,
    private readonly tabAlarmManager: ITabAlarmManager,
    private readonly excludedTabManager: IExcludedTabManager,
    private readonly configurationManager: IConfigurationManager,
    private readonly extensionActionManager: IExtensionActionManager,
  ) {
    this.previousActiveTabByWindow = new PersistedValue<
      Record<WindowId, TabId>
    >(this.browserApiProvider.sessionStorage, "previousActiveTabByWindow", {});

    this.recentlyRemovedTabs = new PersistedValue<CircularQueue<RemovedTab>>(
      this.browserApiProvider.sessionStorage,
      "recentlyRemovedTabs",
      new CircularQueue(RecentlyClosedTabsBufferSize),
      (data) => data.toJSON(),
      CircularQueue.fromJSON,
    );

    this.registerOpenTabs = this.registerOpenTabs.bind(this);
    this.onTabActivated = this.onTabActivated.bind(this);
    this.onTabCreated = this.onTabCreated.bind(this);
    this.onTabUpdated = this.onTabUpdated.bind(this);
    this.onTabRemoved = this.onTabRemoved.bind(this);

    this.tabAlarmManager.onAlarm(this.removeTab.bind(this));
  }

  public async getRecentlyClosed(): Promise<RemovedTab[]> {
    const queue = await this.recentlyRemovedTabs.get();
    return queue.toArray().reverse();
  }

  public async watchTabs(): Promise<void> {
    this.browserApiProvider.runtime.onInstalled.addListener(
      this.registerOpenTabs,
    );
    this.browserApiProvider.runtime.onStartup.addListener(
      this.registerOpenTabs,
    );

    this.browserApiProvider.tab.onActivated.addListener(this.onTabActivated);
    this.browserApiProvider.tab.onCreated.addListener(this.onTabCreated);
    this.browserApiProvider.tab.onUpdated.addListener(this.onTabUpdated);
    this.browserApiProvider.tab.onRemoved.addListener(this.onTabRemoved);
  }

  private async registerOpenTabs(): Promise<void> {
    const tabs = await this.browserApiProvider.tab.query({ active: false });
    await Promise.all(tabs.map((tab) => this.scheduleTabRemoval(tab.id)));
  }

  private async onTabCreated(tab: chrome.tabs.Tab): Promise<void> {
    await this.scheduleTabRemoval(tab.id);

    if (tab.id) {
      await this.removeDuplicatesIfNecessary(tab.id, tab.url ?? null);
    }
  }

  private async onTabUpdated(
    tabId: TabId,
    tabUpdateInfo: chrome.tabs.TabChangeInfo,
  ) {
    await this.removeDuplicatesIfNecessary(tabId, tabUpdateInfo.url ?? null);
  }

  private async removeDuplicatesIfNecessary(
    tabId: TabId,
    url: string | null,
  ): Promise<void> {
    if (!url) {
      return;
    }

    const config = await this.configurationManager.get();
    if (!config?.removeExactDuplicates) {
      return;
    }

    const duplicates = await this.browserApiProvider.tab.query({
      active: false,
      url,
    });

    for (const duplicate of duplicates) {
      // Do not remove the updated tab itself to avoid disrupting user's workflow
      if (duplicate.id && duplicate.id !== tabId) {
        await this.removeTab(duplicate.id);
      }
    }
  }

  private async onTabActivated(
    activeInfo: chrome.tabs.TabActiveInfo,
  ): Promise<void> {
    const { windowId, tabId } = activeInfo;

    await this.tabAlarmManager.clearAlarm(tabId);

    const previousActiveIds = await this.previousActiveTabByWindow.get();
    await this.scheduleTabRemoval(previousActiveIds[windowId]);

    await this.previousActiveTabByWindow.update((previousActiveIds) => ({
      ...previousActiveIds,
      [windowId]: tabId,
    }));
  }

  private async onTabRemoved(tabId: TabId): Promise<void> {
    await this.tabAlarmManager.clearAlarm(tabId);
  }

  private async removeTab(tabId: TabId): Promise<void> {
    if (!tabId) {
      return;
    }

    let tab: chrome.tabs.Tab;
    try {
      tab = await this.browserApiProvider.tab.get(tabId);
    } catch (e) {
      logInfo("Tab not found", tabId, e);
      return;
    }

    if (!tab) {
      return;
    }

    if (await this.canRemoveTab(tab)) {
      await this.browserApiProvider.tab.remove(tabId);
      await this.extensionActionManager.incrementBadgeCounter();
      await this.recentlyRemovedTabs.update((queue) => {
        queue.enqueue({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          favIconUrl: tab.favIconUrl,
          removedAt: new Date().toISOString(),
        });
        return queue;
      });
    } else if (!tab.active) {
      await this.scheduleTabRemoval(tabId);
    }
  }

  private async scheduleTabRemoval(tabId: TabId | undefined): Promise<void> {
    if (!tabId || (await this.excludedTabManager.isExcluded(tabId))) {
      return;
    }

    const removeAfterMinutes = (
      (await this.configurationManager.get()) || emptyConfiguration
    ).tabRemovalDelayMin;
    await this.tabAlarmManager.setAlarm(tabId, removeAfterMinutes);
  }

  private async canRemoveTab(tab: chrome.tabs.Tab): Promise<boolean> {
    if (!tab || !tab.id) return false;

    // TODO: this is not the right approach, needs to be replaced with try/catch
    const lastError = this.browserApiProvider.runtime.getLastError();
    if (lastError) {
      logInfo(
        "OpenedTabManager: tab cannot be removed because of the error: ",
        lastError,
      );
      return false;
    }

    if (tab.active) {
      return false;
    }

    if (await this.excludedTabManager.isExcluded(tab.id)) {
      return false;
    }

    const configuration = await this.configurationManager.get();
    const makesSound = configuration.keepAudibleTabs && tab.audible;
    const isInGroup = configuration.keepGroupedTabs && tab.groupId !== -1;
    const isPinned = configuration.keepPinnedTabs && tab.pinned;

    return !isPinned && !makesSound && !isInGroup;
  }
}
