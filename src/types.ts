export type Tab = chrome.tabs.Tab;

export type TabId = number;

export type WindowId = number;

export type TabQueryInfo = chrome.tabs.QueryInfo;

export type TabActiveInfo = chrome.tabs.TabActiveInfo;

export type BrowserClickedEvent = chrome.action.BrowserClickedEvent;

export type BrowserLastError = chrome.runtime.LastError;

export type BrowserStorageChangedEvent = chrome.storage.StorageChangedEvent;

export type BrowserStorageChange = chrome.storage.StorageChange;

export type ExtensionInstalledEvent = chrome.runtime.RuntimeInstalledEvent;

export type ExtensionStartupEvent = chrome.runtime.RuntimeEvent;

export type TabCreatedEvent = chrome.tabs.TabCreatedEvent;

export type TabActivatedEvent = chrome.tabs.TabActivatedEvent;

export type TabRemovedEvent = chrome.tabs.TabRemovedEvent;

export type SimpleFunction = () => void;

export type Alarm = chrome.alarms.Alarm;

export type AlarmCreateInfo = chrome.alarms.AlarmCreateInfo;

export type AlarmEvent = chrome.alarms.AlarmEvent;
