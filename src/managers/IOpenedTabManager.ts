import type { Tab, TabActiveInfo, TabId } from "../types";

export interface IOpenedTabManager {
  watchAllTabs(): Promise<void>;
  onTabCreated(tab: Tab): Promise<void>;
  onTabActivated(activeInfo: TabActiveInfo): Promise<void>;
  onTabRemoved(tabId: TabId): Promise<void>;
}
