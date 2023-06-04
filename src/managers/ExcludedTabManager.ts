import { TabId } from '../types';
import { IExtensionActionManager } from './IExtensionActionManager';
import { IExcludedTabManager } from './IExcludedTabManager';
import { IBrowserStorageAPI } from '../api/IBrowserStorageAPI';
import { CachedValue } from '../helpers/CachedValue';

export class ExcludedTabManager implements IExcludedTabManager {
  private static readonly StorageKey = 'excludedTabs';
  private readonly _excludedTabs: CachedValue<ReadonlyArray<TabId>>;

  constructor(private readonly _browserStorageAPI: IBrowserStorageAPI, private readonly _extensionIconService: IExtensionActionManager) {
    this._excludedTabs = new CachedValue<ReadonlyArray<TabId>>(this._browserStorageAPI, ExcludedTabManager.StorageKey, []);
  }

  public async isExcluded(tabId: number): Promise<boolean> {
    const excludedTabs = await this._excludedTabs.get();
    return excludedTabs.includes(tabId);
  }

  public async exclude(tabId: number): Promise<void> {
    const excludedTabs = new Set(await this._excludedTabs.get());
    excludedTabs.add(tabId);
    await this._excludedTabs.put(Array.from(excludedTabs));
    await this._extensionIconService.disableExtensionIcon(tabId);
  }

  public async include(tabId: number): Promise<void> {
    const excludedTabs = new Set(await this._excludedTabs.get());
    excludedTabs.delete(tabId);
    await this._excludedTabs.put(Array.from(excludedTabs));
    await this._extensionIconService.enableExtensionIcon(tabId);
  }

  public async toggle(tabId: number): Promise<void> {
    if (await this.isExcluded(tabId)) {
      await this.include(tabId);
    } else {
      await this.exclude(tabId);
    }
  }
}
