import { IBrowserStorageAPI } from './IBrowserStorageAPI';

export const chromeLocalStorageAPI: IBrowserStorageAPI = {
  onChanged: chrome.storage.local.onChanged,
  clear: chrome.storage.local.clear,
  get: chrome.storage.local.get,
  remove: chrome.storage.local.remove,
  set: chrome.storage.local.set,
};
