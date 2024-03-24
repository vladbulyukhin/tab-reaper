import type { IBrowserRuntimeAPI } from "./IBrowserRuntimeAPI";

export const chromeRuntimeAPI: IBrowserRuntimeAPI = {
  getLastError: () => chrome.runtime.lastError,
  onInstalled: chrome.runtime.onInstalled,
  onStartup: chrome.runtime.onStartup,
};
