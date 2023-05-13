import { IBrowserRuntimeAPI } from './IBrowserRuntimeAPI';

export const chromeRuntimeAPI: IBrowserRuntimeAPI = {
  lastError: chrome.runtime.lastError,
  onInstalled: chrome.runtime.onInstalled,
  onStartup: chrome.runtime.onStartup,
};
