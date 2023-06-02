import { TabId } from '../types';
import { IExtensionActionManager } from './IExtensionActionManager';
import { IExcludedTabManager } from './IExcludedTabManager';

export class ExcludedTabManager implements IExcludedTabManager {
  private excludedTabs: Set<TabId> = new Set();

  constructor(private readonly extensionIconService: IExtensionActionManager) {}

  public isExcluded(tabId: number): boolean {
    return this.excludedTabs.has(tabId);
  }

  public async exclude(tabId: number): Promise<void> {
    this.excludedTabs.add(tabId);
    await this.extensionIconService.disableExtensionIcon(tabId);
  }

  public async include(tabId: number): Promise<void> {
    this.excludedTabs.delete(tabId);
    await this.extensionIconService.enableExtensionIcon(tabId);
  }

  public async toggle(tabId: number): Promise<void> {
    if (this.isExcluded(tabId)) {
      await this.include(tabId);
    } else {
      await this.exclude(tabId);
    }
  }
}
