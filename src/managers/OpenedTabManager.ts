import { IBrowserRuntimeAPI } from '../api/IBrowserRuntimeAPI';
import { IBrowserTabAPI } from '../api/IBrowserTabAPI';
import { Tab, TabActiveInfo, TabId, WindowId } from '../types';
import { IOpenedTabManager } from './IOpenedTabManager';
import { IExcludedTabManager } from './IExcludedTabManager';
import { ITabAlarmManager } from './ITabAlarmManager';
import { IConfigurationManager } from './IConfigurationManager';
import { logInfo } from '../helpers/log';
import { emptyConfiguration } from '../models/Configuration';
import { CachedValue } from '../helpers/CachedValue';
import { IBrowserStorageAPI } from '../api/IBrowserStorageAPI';

export class OpenedTabManager implements IOpenedTabManager {
  private static readonly StorageKey = 'previousActiveTabByWindow';
  private readonly _previousActiveTabByWindow: CachedValue<Record<WindowId, TabId>>;

  constructor(
    private readonly _browserRuntimeAPI: IBrowserRuntimeAPI,
    private readonly _browserTabAPI: IBrowserTabAPI,
    private readonly _browserStorageAPI: IBrowserStorageAPI,
    private readonly _tabAlarmManager: ITabAlarmManager,
    private readonly _excludedTabManager: IExcludedTabManager,
    private readonly _configurationManager: IConfigurationManager
  ) {
    this._previousActiveTabByWindow = new CachedValue<Record<WindowId, TabId>>(this._browserStorageAPI, OpenedTabManager.StorageKey, {});

    this.watchAllTabs = this.watchAllTabs.bind(this);
    this.onTabActivated = this.onTabActivated.bind(this);
    this.onTabCreated = this.onTabCreated.bind(this);
    this.onTabRemoved = this.onTabRemoved.bind(this);

    this._tabAlarmManager.onAlarm(this.removeTab.bind(this));
  }

  public async watchAllTabs(): Promise<void> {
    const tabs = await this._browserTabAPI.query({ active: false });

    for (const { id } of tabs) {
      await this.planTabRemoval(id);
    }
  }

  public async onTabCreated(tab: Tab): Promise<void> {
    await this.planTabRemoval(tab.id);
  }

  public async onTabActivated(activeInfo: TabActiveInfo): Promise<void> {
    const { windowId, tabId } = activeInfo;
    await this._tabAlarmManager.clearAlarm(tabId);

    const previousActiveIds = await this._previousActiveTabByWindow.get();
    await this.planTabRemoval(previousActiveIds[windowId]);

    await this._previousActiveTabByWindow.put({ ...previousActiveIds, [windowId]: tabId });
  }

  public async onTabRemoved(tabId: TabId): Promise<void> {
    await this._tabAlarmManager.clearAlarm(tabId);
  }

  private async removeTab(tabId: TabId): Promise<void> {
    if (!tabId) {
      return;
    }

    const tab = await this._browserTabAPI.get(tabId);

    if (await this.canRemoveTab(tab)) {
      await this._browserTabAPI.remove(tabId);
    } else if (!tab.active) {
      await this.planTabRemoval(tabId);
    }
  }

  private async planTabRemoval(tabId: TabId | undefined): Promise<void> {
    if (!tabId || (await this._excludedTabManager.isExcluded(tabId))) {
      return;
    }

    const removeAfterMinutes = ((await this._configurationManager.get()) || emptyConfiguration).tabRemovalDelayMin;
    await this._tabAlarmManager.setAlarm(tabId, removeAfterMinutes);
  }

  private async canRemoveTab(tab: Tab): Promise<boolean> {
    if (!tab || !tab.id) return false;

    // TODO: this is not the right approach, needs to be replaced with try/catch
    const lastError = this._browserRuntimeAPI.getLastError();
    if (lastError) {
      logInfo('OpenedTabManager: tab cannot be removed because of the error: ', lastError);
      return false;
    }

    if (tab.active) {
      return false;
    }

    if (await this._excludedTabManager.isExcluded(tab.id)) {
      return false;
    }

    const configuration = await this._configurationManager.get();
    const makesSound = configuration.keepAudibleTabs && tab.audible;
    const isInGroup = configuration.keepGroupedTabs && tab.groupId != -1;
    const isPinned = configuration.keepPinnedTabs && tab.pinned;

    return !isPinned && !makesSound && !isInGroup;
  }
}
