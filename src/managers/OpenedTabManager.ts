import { IBrowserRuntimeAPI } from '../api/IBrowserRuntimeAPI';
import { IBrowserTabAPI } from '../api/IBrowserTabAPI';
import { Tab, TabActiveInfo, TabId, WindowId } from '../types';
import { IOpenedTabManager } from './IOpenedTabManager';
import { IExcludedTabManager } from './IExcludedTabManager';
import { ITabAlarmManager } from './ITabAlarmManager';
import { IConfigurationManager } from './IConfigurationManager';

export class OpenedTabManager implements IOpenedTabManager {
  private static TimeoutDurationMin = 15;
  private previousActiveTabInWindow: Map<WindowId, TabId> = new Map();

  constructor(
    private readonly browserRuntimeAPI: IBrowserRuntimeAPI,
    private readonly browserTabAPI: IBrowserTabAPI,
    private readonly tabAlarmManager: ITabAlarmManager,
    private readonly excludedTabManager: IExcludedTabManager,
    private readonly configurationManager: IConfigurationManager
  ) {
    this.watchAllTabs = this.watchAllTabs.bind(this);
    this.onTabActivated = this.onTabActivated.bind(this);
    this.onTabCreated = this.onTabCreated.bind(this);
    this.onTabRemoved = this.onTabRemoved.bind(this);
  }

  public async watchAllTabs(): Promise<void> {
    const tabs = await this.browserTabAPI.query({ active: false });

    for (const { id } of tabs) {
      await this.planTabRemoval(id);
    }
  }

  public onTabCreated(tab: Tab): void {
    this.planTabRemoval(tab.id);
  }

  public onTabActivated(activeInfo: TabActiveInfo): void {
    const { windowId, tabId } = activeInfo;
    this.tabAlarmManager.clearAlarm(tabId);

    const previousActiveId = this.previousActiveTabInWindow.get(windowId);
    this.planTabRemoval(previousActiveId);

    this.previousActiveTabInWindow.set(windowId, tabId);
  }

  public onTabRemoved(tabId: TabId): void {
    this.tabAlarmManager.clearAlarm(tabId);
  }

  private async removeTab(tabId: TabId): Promise<void> {
    const tab = await this.browserTabAPI.get(tabId);

    if (await this.canRemoveTab(tab)) {
      await this.browserTabAPI.remove(tabId);
    } else if (!tab.active) {
      await this.planTabRemoval(tabId);
    }
  }

  private async planTabRemoval(tabId: TabId | undefined): Promise<void> {
    if (!tabId || this.excludedTabManager.isExcluded(tabId)) {
      return;
    }

    const removeAfterMinutes = (await this.configurationManager.get()).tabRemovalDelayMin ?? OpenedTabManager.TimeoutDurationMin;

    await this.tabAlarmManager.setAlarm(tabId, removeAfterMinutes, () => {
      this.removeTab(tabId);
    });
  }

  private async canRemoveTab(tab: Tab): Promise<boolean> {
    if (!tab || !tab.id) return false;

    const configuration = await this.configurationManager.get();

    const errorOccurred = this.browserRuntimeAPI.getLastError();
    const isExcluded = this.excludedTabManager.isExcluded(tab.id);
    const isActive = tab.active;
    const makesSound = configuration.keepAudibleTabs && tab.audible;
    const isInGroup = configuration.keepGroupedTabs && tab.groupId != -1;
    const isPinned = configuration.keepPinnedTabs && tab.pinned;

    return !errorOccurred && !isExcluded && !isPinned && !isActive && !makesSound && !isInGroup;
  }
}
