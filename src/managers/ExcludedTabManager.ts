import { IBrowserStorageAPI } from '../api/IBrowserStorageAPI';
import { TabId } from '../types';
import { IExtensionActionManager } from './IExtensionActionManager';
import { IExcludedTabManager } from './IExcludedTabManager';

export class ExcludedTabManager implements IExcludedTabManager {
  // TODO: save to local storage
  private excludedTabs: Set<TabId> = new Set();

  constructor(
    private readonly browserStorageAPI: IBrowserStorageAPI,
    private readonly extensionIconService: IExtensionActionManager
  ) {
    this.loadExcludedTabs();
  }

  public isExcluded(tabId: number): boolean {
    return this.excludedTabs.has(tabId);
  }

  public async exclude(tabId: number): Promise<void> {
    this.excludedTabs.add(tabId);
    await this.extensionIconService.disableExtensionIcon(tabId);
    await this.browserStorageAPI.set({ excludedTabs: Array.from(this.excludedTabs) });
  }

  public async include(tabId: number): Promise<void> {
    // TODO: automatically unpin removed tabs
    this.excludedTabs.delete(tabId);
    await this.extensionIconService.enableExtensionIcon(tabId);
    await this.browserStorageAPI.set({ pinnedTabs: Array.from(this.excludedTabs) });
  }

  public async toggle(tabId: number): Promise<void> {
    if (this.isExcluded(tabId)) {
      await this.include(tabId);
    } else {
      await this.exclude(tabId);
    }
  }

  private async loadExcludedTabs(): Promise<void> {
    // TODO: doesn't work as expected, restore tab is not pinned
    const storage: any = await this.browserStorageAPI.get({ excludedTabs: [] });
    this.excludedTabs = new Set(storage.excludedTabs);

    for (const tabId of this.excludedTabs) {
      this.extensionIconService.disableExtensionIcon(tabId);
    }
  }
}
