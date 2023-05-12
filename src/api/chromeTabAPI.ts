import { IBrowserTabAPI } from './IBrowserTabAPI';

export const chromeTabAPI: IBrowserTabAPI = {
  get: chrome.tabs.get,
  query: chrome.tabs.query,
  remove: chrome.tabs.remove,
  onActivated: chrome.tabs.onActivated,
  onCreated: chrome.tabs.onCreated,
  onRemoved: chrome.tabs.onRemoved,
};
