import { TabId, TimeoutId } from '../types';
import { ITabTimeoutManager } from './ITabTimeoutManager';

export class TabTimeoutManager implements ITabTimeoutManager {
  private timeouts: Map<TabId, TimeoutId> = new Map();

  public setTimeout(tabId: TabId, delay: number, callback: () => void): TimeoutId {
    if (this.timeouts.has(tabId)) {
      this.clearTimeout(tabId);
    }

    const timeoutId = setTimeout(callback, delay);
    this.timeouts.set(tabId, timeoutId);
    return timeoutId;
  }

  public clearTimeout(tabId: TabId): void {
    const timeoutId = this.timeouts.get(tabId) ?? 0;
    this.timeouts.delete(tabId);
    clearTimeout(timeoutId);
  }
}
