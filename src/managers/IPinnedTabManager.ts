import { TabId } from '../types';

export interface IPinnedTabManager {
  isPinned(tabId: TabId): boolean;
  pin(tabId: TabId): Promise<void>;
  unpin(tabId: TabId): Promise<void>;
  toggle(tabId: TabId): Promise<void>;
}
