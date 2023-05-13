import { IBrowserStorageAPI } from './IBrowserStorageAPI';

export const chromeSyncStorageAPI: IBrowserStorageAPI = {
  onChanged: chrome.storage.sync.onChanged,
  clear: chrome.storage.sync.clear.bind(chrome.storage.sync),
  get: chrome.storage.sync.get.bind(chrome.storage.sync),
  remove: chrome.storage.sync.remove.bind(chrome.storage.sync),
  set: chrome.storage.sync.set.bind(chrome.storage.sync),
};
