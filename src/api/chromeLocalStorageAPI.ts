import { IBrowserStorageAPI } from './IBrowserStorageAPI';

export const chromeLocalStorageAPI: IBrowserStorageAPI = {
  onChanged: chrome.storage.local.onChanged,
  clear: chrome.storage.local.clear.bind(chrome.storage.local),
  get: chrome.storage.local.get.bind(chrome.storage.local),
  remove: chrome.storage.local.remove.bind(chrome.storage.local),
  set: chrome.storage.local.set.bind(chrome.storage.local),
};
