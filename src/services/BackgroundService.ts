import { IBrowserExtensionActionAPI } from '../api/IBrowserExtensionActionAPI';
import { IBrowserRuntimeAPI } from '../api/IBrowserRuntimeAPI';
import { IBrowserTabAPI } from '../api/IBrowserTabAPI';
import { IOpenedTabManager } from '../managers/IOpenedTabManager';
import { IExcludedTabManager } from '../managers/IExcludedTabManager';
import { Tab } from '../types';
import { IBackgroundService } from './IBackgroundService';

export class BackgroundService implements IBackgroundService {
  constructor(
    private readonly _browserRuntimeAPI: IBrowserRuntimeAPI,
    private readonly _browserTabAPI: IBrowserTabAPI,
    private readonly _browserActionAPI: IBrowserExtensionActionAPI,
    private readonly _openedTabManager: IOpenedTabManager,
    private readonly _excludedTabManager: IExcludedTabManager
  ) {}

  public start(): void {
    this.addRuntimeEventListeners();
    this.addActionEventListeners();
    this.addTabEventListeners();
  }

  private addRuntimeEventListeners(): void {
    this._browserRuntimeAPI.onInstalled.addListener(this._openedTabManager.watchAllTabs);
    this._browserRuntimeAPI.onStartup.addListener(this._openedTabManager.watchAllTabs);
  }

  private addActionEventListeners(): void {
    this._browserActionAPI.onClicked.addListener((tab: Tab) => {
      if (!tab.id) return;
      this._excludedTabManager.toggle(tab.id);
    });
  }

  private addTabEventListeners(): void {
    this._browserTabAPI.onCreated.addListener(this._openedTabManager.onTabCreated);
    this._browserTabAPI.onActivated.addListener(this._openedTabManager.onTabActivated);
    this._browserTabAPI.onRemoved.addListener(this._openedTabManager.onTabRemoved);
  }
}
