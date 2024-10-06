import type {
  IBrowserAlarmAPI,
  IBrowserApiProvider,
  IBrowserExtensionActionAPI,
  IBrowserRuntimeAPI,
  IBrowserStorageAPI,
  IBrowserTabAPI,
} from "./IBrowserApiProvider";

const chromeActionAPI: IBrowserExtensionActionAPI = {
  setBadgeBackgroundColor: chrome.action?.setBadgeBackgroundColor,
  setBadgeText: chrome.action?.setBadgeText,
  setBadgeTextColor: chrome.action?.setBadgeTextColor,
  setIcon: chrome.action?.setIcon,
  setTitle: chrome.action?.setTitle,
};

const chromeAlarmAPI: IBrowserAlarmAPI = {
  clear: chrome.alarms.clear,
  create: chrome.alarms.create,
  onAlarm: chrome.alarms.onAlarm,
};

const chromeLocalStorageAPI: IBrowserStorageAPI = {
  clear: chrome.storage.local.clear.bind(chrome.storage.local),
  get: chrome.storage.local.get.bind(chrome.storage.local),
  onChanged: chrome.storage.local.onChanged,
  remove: chrome.storage.local.remove.bind(chrome.storage.local),
  set: chrome.storage.local.set.bind(chrome.storage.local),
};

const chromeSessionStorageAPI: IBrowserStorageAPI = {
  clear: chrome.storage.session.clear.bind(chrome.storage.session),
  get: chrome.storage.session.get.bind(chrome.storage.session),
  onChanged: chrome.storage.session.onChanged,
  remove: chrome.storage.session.remove.bind(chrome.storage.session),
  set: chrome.storage.session.set.bind(chrome.storage.session),
};

const chromeSyncStorageAPI: IBrowserStorageAPI = {
  clear: chrome.storage.sync.clear.bind(chrome.storage.sync),
  get: chrome.storage.sync.get.bind(chrome.storage.sync),
  onChanged: chrome.storage.sync.onChanged,
  remove: chrome.storage.sync.remove.bind(chrome.storage.sync),
  set: chrome.storage.sync.set.bind(chrome.storage.sync),
};

const chromeRuntimeAPI: IBrowserRuntimeAPI = {
  getLastError: () => chrome.runtime.lastError,
  onInstalled: chrome.runtime.onInstalled,
  onMessage: chrome.runtime.onMessage,
  onStartup: chrome.runtime.onStartup,
  sendMessage: chrome.runtime.sendMessage,
};

const chromeTabAPI: IBrowserTabAPI = {
  create: chrome.tabs.create,
  get: chrome.tabs.get,
  onActivated: chrome.tabs.onActivated,
  onCreated: chrome.tabs.onCreated,
  onUpdated: chrome.tabs.onUpdated,
  onRemoved: chrome.tabs.onRemoved,
  query: chrome.tabs.query,
  remove: chrome.tabs.remove,
};

export const chromeApiProvider: IBrowserApiProvider = {
  alarm: chromeAlarmAPI,
  action: chromeActionAPI,
  runtime: chromeRuntimeAPI,
  localStorage: chromeLocalStorageAPI,
  sessionStorage: chromeSessionStorageAPI,
  syncStorage: chromeSyncStorageAPI,
  tab: chromeTabAPI,
};
