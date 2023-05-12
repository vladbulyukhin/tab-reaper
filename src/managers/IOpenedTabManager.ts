import { Tab, TabActiveInfo, TabId } from '../types';

export interface IOpenedTabManager {
  watchAllTabs(): Promise<void>;
  onTabCreated(tab: Tab): void;
  onTabActivated(activeInfo: TabActiveInfo): void;
  onTabRemoved(tabId: TabId): void;
}
