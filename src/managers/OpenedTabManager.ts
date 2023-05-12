import { IBrowserTabAPI } from '../api/IBrowserTabAPI';
import { ITabTimeoutManager } from './ITabTimeoutManager';
import { Tab, TabActiveInfo, TabId, WindowId } from '../types';
import { IOpenedTabManager } from './IOpenedTabManager';
import { IPinnedTabManager } from './IPinnedTabManager';

// TODO: move to synced storage
const TimeoutDuration = 15 * 60 * 1000;
// const TimeoutDuration = (1 / 2) * 60 * 1000; // (for test purposes)

export class OpenedTabManager implements IOpenedTabManager {
  private previousActiveTabInWindow: Map<WindowId, TabId> = new Map();

  constructor(
    private readonly browserTabAPI: IBrowserTabAPI,
    private readonly tabTimeoutManager: ITabTimeoutManager,
    private readonly pinnedTabManager: IPinnedTabManager
  ) {
    // TODO: test if necessary
    this.watchAllTabs = this.watchAllTabs.bind(this);
    this.onTabActivated = this.onTabActivated.bind(this);
    this.onTabCreated = this.onTabCreated.bind(this);
    this.onTabRemoved = this.onTabRemoved.bind(this);
  }

  public async watchAllTabs(): Promise<void> {
    const tabs = await this.browserTabAPI.query({ active: false });

    for (const { id } of tabs) {
      if (id && !this.pinnedTabManager.isPinned(id)) {
        this.planTabRemoval(id);
      }
    }
  }

  public onTabCreated(tab: Tab): void {
    const { id } = tab;
    if (id && !this.pinnedTabManager.isPinned(id)) {
      this.planTabRemoval(id);
    }
  }

  public onTabActivated(activeInfo: TabActiveInfo): void {
    const { windowId, tabId } = activeInfo;
    this.tabTimeoutManager.clearTimeout(tabId);

    const previousActiveId = this.previousActiveTabInWindow.get(windowId);
    if (previousActiveId && !this.pinnedTabManager.isPinned(previousActiveId)) {
      this.planTabRemoval(previousActiveId);
    }

    this.previousActiveTabInWindow.set(windowId, tabId);
  }

  public onTabRemoved(tabId: TabId): void {
    this.tabTimeoutManager.clearTimeout(tabId);
  }

  private async removeTab(tabId: number): Promise<void> {
    const tab = await this.browserTabAPI.get(tabId);

    if (this.canRemoveTab(tab)) {
      await this.browserTabAPI.remove(tabId);
    }
  }

  private planTabRemoval(tabId: TabId): void {
    this.tabTimeoutManager.setTimeout(tabId, TimeoutDuration, () => {
      this.removeTab(tabId);
    });
  }

  private canRemoveTab(tab: Tab): boolean {
    if (!tab || !tab.id) return false;

    const isPinned = this.pinnedTabManager.isPinned(tab.id);
    const errorOccurred = chrome.runtime.lastError; // TODO: replace with separate API
    const isActive = tab.active;
    const makesSound = tab.audible;

    return !errorOccurred && !isPinned && !isActive && !makesSound;
  }
}
