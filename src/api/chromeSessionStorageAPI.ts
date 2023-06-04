import { IBrowserStorageAPI } from './IBrowserStorageAPI';

export const chromeSessionStorageAPI: IBrowserStorageAPI = {
  onChanged: chrome.storage.session.onChanged,
  clear: chrome.storage.session.clear.bind(chrome.storage.session),
  get: chrome.storage.session.get.bind(chrome.storage.session),
  remove: chrome.storage.session.remove.bind(chrome.storage.session),
  set: chrome.storage.session.set.bind(chrome.storage.session),
};
