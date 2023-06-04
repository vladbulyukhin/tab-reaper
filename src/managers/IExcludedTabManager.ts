import { TabId } from '../types';

export interface IExcludedTabManager {
  isExcluded(tabId: TabId): Promise<boolean>;
  exclude(tabId: TabId): Promise<void>;
  include(tabId: TabId): Promise<void>;
  toggle(tabId: TabId): Promise<void>;
}
