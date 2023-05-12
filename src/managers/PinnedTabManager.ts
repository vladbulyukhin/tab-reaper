import { TabId } from '../types';
import { IExtensionActionManager } from './IExtensionActionManager';
import { IPinnedTabManager } from './IPinnedTabManager';

export class PinnedTabManager implements IPinnedTabManager {
  // TODO: save to local storage
  private pinnedTabs: Set<TabId> = new Set();

  constructor(private readonly extensionIconService: IExtensionActionManager) {}

  public isPinned(tabId: number): boolean {
    return this.pinnedTabs.has(tabId);
  }

  public async pin(tabId: number): Promise<void> {
    this.pinnedTabs.add(tabId);
    await this.extensionIconService.disableExtensionIcon(tabId);
  }

  public async unpin(tabId: number): Promise<void> {
    this.pinnedTabs.delete(tabId);
    await this.extensionIconService.enableExtensionIcon(tabId);
  }

  public async toggle(tabId: number): Promise<void> {
    if (this.isPinned(tabId)) {
      await this.unpin(tabId);
    } else {
      await this.pin(tabId);
    }
  }
}
