import { Tab, TabActivatedEvent, TabCreatedEvent, TabId, TabQueryInfo, TabRemovedEvent } from '../types';

export interface IBrowserTabAPI {
  get(tabId: TabId): Promise<Tab>;
  query(queryInfo: TabQueryInfo): Promise<ReadonlyArray<Tab>>;
  remove(tabId: TabId): Promise<void>;
  onActivated: TabActivatedEvent;
  onCreated: TabCreatedEvent;
  onRemoved: TabRemovedEvent;
}
