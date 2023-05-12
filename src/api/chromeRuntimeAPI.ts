import { IBrowserRuntimeAPI } from './IBrowserRuntimeAPI';

export const chromeRuntimeAPI: IBrowserRuntimeAPI = {
  onInstalled: chrome.runtime.onInstalled,
  onStartup: chrome.runtime.onStartup,
};
