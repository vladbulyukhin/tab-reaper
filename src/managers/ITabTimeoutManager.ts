import { TabId, TimeoutId } from '../types';

export interface ITabTimeoutManager {
  setTimeout(tabId: TabId, delay: number, callback: () => void): TimeoutId;
  clearTimeout(tabId: TabId): void;
}
