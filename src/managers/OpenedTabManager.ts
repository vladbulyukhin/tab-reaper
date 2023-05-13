import { IBrowserRuntimeAPI } from '../api/IBrowserRuntimeAPI';
import { IBrowserTabAPI } from '../api/IBrowserTabAPI';
import { Tab, TabActiveInfo, TabId, WindowId } from '../types';
import { IOpenedTabManager } from './IOpenedTabManager';
import { IPinnedTabManager } from './IPinnedTabManager';
import { ITabTimeoutManager } from './ITabTimeoutManager';

// TODO: move to synced storage
const TimeoutDuration = 15 * 60 * 1000;
// const TimeoutDuration = (1 / 2) * 60 * 1000; // (for test purposes)

export class OpenedTabManager implements IOpenedTabManager {
  private previousActiveTabInWindow: Map<WindowId, TabId> = new Map();

  constructor(
    private readonly browserRuntimeAPI: IBrowserRuntimeAPI,
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
      this.planTabRemoval(id);
    }
  }

  public onTabCreated(tab: Tab): void {
    this.planTabRemoval(tab.id);
  }

  public onTabActivated(activeInfo: TabActiveInfo): void {
    const { windowId, tabId } = activeInfo;
    this.tabTimeoutManager.clearTimeout(tabId);

    const previousActiveId = this.previousActiveTabInWindow.get(windowId);
    this.planTabRemoval(previousActiveId);

    this.previousActiveTabInWindow.set(windowId, tabId);
  }

  public onTabRemoved(tabId: TabId): void {
    this.tabTimeoutManager.clearTimeout(tabId);
  }

  private async removeTab(tabId: number): Promise<void> {
    const tab = await this.browserTabAPI.get(tabId);

    if (this.canRemoveTab(tab)) {
      await this.browserTabAPI.remove(tabId);
      // TODO: add try/catch for cases when tab is already removed
    }
  }

  private planTabRemoval(tabId: TabId | undefined): void {
    if (!tabId || this.pinnedTabManager.isPinned(tabId)) {
      return;
    }

    this.tabTimeoutManager.setTimeout(tabId, TimeoutDuration, () => {
      this.removeTab(tabId);
    });
  }

  private canRemoveTab(tab: Tab): boolean {
    if (!tab || !tab.id) return false;

    const isPinned = this.pinnedTabManager.isPinned(tab.id);
    const errorOccurred = this.browserRuntimeAPI.lastError; // TODO: replace with separate API
    const isActive = tab.active;
    const makesSound = tab.audible;

    return !errorOccurred && !isPinned && !isActive && !makesSound;
  }
}
