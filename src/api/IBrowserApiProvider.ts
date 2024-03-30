export interface IBrowserAlarmAPI {
  create(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): Promise<void>;
  clear(name: string): Promise<void>;
  onAlarm: chrome.alarms.AlarmEvent;
}

export interface IBrowserExtensionActionAPI {
  setBadgeBackgroundColor(
    details: chrome.action.BadgeColorDetails,
  ): Promise<void>;
  setBadgeText(details: chrome.action.BadgeTextDetails): Promise<void>;
  setBadgeTextColor(details: chrome.action.BadgeColorDetails): Promise<void>;
  setIcon(details: chrome.action.TabIconDetails): Promise<void>;
  setTitle(details: chrome.action.TitleDetails): Promise<void>;
}

export interface IBrowserRuntimeAPI {
  getLastError: () => chrome.runtime.LastError | undefined;
  onInstalled: chrome.runtime.RuntimeInstalledEvent;
  onMessage: chrome.runtime.ExtensionMessageEvent;
  onStartup: chrome.runtime.RuntimeEvent;
  sendMessage<M = unknown, R = unknown>(message: M): Promise<R>;
}

export interface IBrowserStorageAPI {
  clear(): Promise<void>;
  get<T>(keys?: T): Promise<T>;
  onChanged: chrome.storage.StorageChangedEvent;
  remove(keys: string | string[]): Promise<void>;
  set(items: object): Promise<void>;
}

export interface IBrowserTabAPI {
  create(
    createProperties: chrome.tabs.CreateProperties,
  ): Promise<chrome.tabs.Tab>;
  get(tabId: number): Promise<chrome.tabs.Tab>;
  onActivated: chrome.tabs.TabActivatedEvent;
  onCreated: chrome.tabs.TabCreatedEvent;
  onRemoved: chrome.tabs.TabRemovedEvent;
  query(
    queryInfo: chrome.tabs.QueryInfo,
  ): Promise<ReadonlyArray<chrome.tabs.Tab>>;
  remove(tabId: number): Promise<void>;
}

export interface IBrowserApiProvider {
  action: IBrowserExtensionActionAPI;
  alarm: IBrowserAlarmAPI;
  localStorage: IBrowserStorageAPI;
  runtime: IBrowserRuntimeAPI;
  sessionStorage: IBrowserStorageAPI;
  syncStorage: IBrowserStorageAPI;
  tab: IBrowserTabAPI;
}
