export type Tab = chrome.tabs.Tab;

export type TabId = number;

export type WindowId = number;

export type TimeoutId = ReturnType<typeof setTimeout>;

export type TabQueryInfo = chrome.tabs.QueryInfo;

export type TabActiveInfo = chrome.tabs.TabActiveInfo;

export type BrowserClickedEvent = chrome.action.BrowserClickedEvent;

export type BrowserLastError = chrome.runtime.LastError;

export type BrowserStorageChangedEvent = chrome.storage.StorageChangedEvent;

export type ExtensionInstalledEvent = chrome.runtime.RuntimeInstalledEvent;

export type ExtensionStartupEvent = chrome.runtime.RuntimeEvent;

export type TabCreatedEvent = chrome.tabs.TabCreatedEvent;

export type TabActivatedEvent = chrome.tabs.TabActivatedEvent;

export type TabRemovedEvent = chrome.tabs.TabRemovedEvent;
