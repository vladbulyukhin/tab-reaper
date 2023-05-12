import { TabId, TimeoutId } from '../types';
import { ITabTimeoutManager } from './ITabTimeoutManager';

export class TabTimeoutManager implements ITabTimeoutManager {
  private timeouts: Map<TabId, TimeoutId> = new Map();

  public setTimeout(tabId: number, delay: number, callback: () => void): number {
    if (this.timeouts.has(tabId)) {
      this.clearTimeout(tabId);
    }

    const timeoutId = setTimeout(callback, delay);
    this.timeouts.set(tabId, timeoutId);
    return timeoutId;
  }

  public clearTimeout(tabId: number): void {
    const timeoutId = this.timeouts.get(tabId) ?? 0;
    this.timeouts.delete(tabId);
    clearTimeout(timeoutId);
  }
}
