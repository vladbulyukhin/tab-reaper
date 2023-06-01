import { IBrowserRuntimeAPI } from '../api/IBrowserRuntimeAPI';
import { IBrowserTabAPI } from '../api/IBrowserTabAPI';
import { Tab, TabActiveInfo, TabId, WindowId } from '../types';
import { IOpenedTabManager } from './IOpenedTabManager';
import { IExcludedTabManager } from './IExcludedTabManager';
import { ITabTimeoutManager } from './ITabTimeoutManager';
import { IConfigurationManager } from './IConfigurationManager';

export class OpenedTabManager implements IOpenedTabManager {
  private static TimeoutDurationMin = 15;
  private previousActiveTabInWindow: Map<WindowId, TabId> = new Map();

  constructor(
    private readonly browserRuntimeAPI: IBrowserRuntimeAPI,
    private readonly browserTabAPI: IBrowserTabAPI,
    private readonly tabTimeoutManager: ITabTimeoutManager,
    private readonly excludedTabManager: IExcludedTabManager,
    private readonly configurationManager: IConfigurationManager
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

  private async planTabRemoval(tabId: TabId | undefined): Promise<void> {
    if (!tabId || this.excludedTabManager.isExcluded(tabId)) {
      return;
    }

    const timeoutDuration =
      (await this.configurationManager.get()).tabRemovalTimeoutMin ?? OpenedTabManager.TimeoutDurationMin;

    this.tabTimeoutManager.setTimeout(tabId, timeoutDuration * 60 * 1000, () => {
      this.removeTab(tabId);
    });
  }

  private canRemoveTab(tab: Tab): boolean {
    if (!tab || !tab.id) return false;

    const errorOccurred = this.browserRuntimeAPI.getLastError();
    const isExcluded = this.excludedTabManager.isExcluded(tab.id);
    const isPinned = tab.pinned;
    const isActive = tab.active;
    const makesSound = tab.audible;
    const isInGroup = tab.groupId != -1;

    return !errorOccurred && !isExcluded && !isPinned && !isActive && !makesSound && !isInGroup;
  }
}
