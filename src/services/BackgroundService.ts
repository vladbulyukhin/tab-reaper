import { IBrowserExtensionActionAPI } from '../api/IBrowserExtensionActionAPI';
import { IBrowserRuntimeAPI } from '../api/IBrowserRuntimeAPI';
import { IBrowserTabAPI } from '../api/IBrowserTabAPI';
import { IOpenedTabManager } from '../managers/IOpenedTabManager';
import { IPinnedTabManager } from '../managers/IPinnedTabManager';
import { Tab } from '../types';
import { IBackgroundService } from './IBackgroundService';

export class BackgroundService implements IBackgroundService {
  constructor(
    private readonly browserRuntimeAPI: IBrowserRuntimeAPI,
    private readonly browserTabAPI: IBrowserTabAPI,
    private readonly browserActionAPI: IBrowserExtensionActionAPI,
    private readonly openedTabManager: IOpenedTabManager,
    private readonly pinnedTabManager: IPinnedTabManager
  ) {}

  public start(): void {
    this.addRuntimeEventListeners();
    this.addActionEventListeners();
    this.addTabEventListeners();
  }

  private addRuntimeEventListeners(): void {
    this.browserRuntimeAPI.onInstalled.addListener(this.openedTabManager.watchAllTabs);
    this.browserRuntimeAPI.onStartup.addListener(this.openedTabManager.watchAllTabs);
  }

  private addActionEventListeners(): void {
    this.browserActionAPI.onClicked.addListener((tab: Tab) => {
      if (!tab.id) return;
      this.pinnedTabManager.toggle(tab.id);
    });
  }

  private addTabEventListeners(): void {
    this.browserTabAPI.onCreated.addListener(this.openedTabManager.onTabCreated);
    this.browserTabAPI.onActivated.addListener(this.openedTabManager.onTabActivated);
    this.browserTabAPI.onRemoved.addListener(this.openedTabManager.onTabRemoved);
  }
}
