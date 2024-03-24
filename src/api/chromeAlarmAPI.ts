import type { IBrowserAlarmAPI } from "./IBrowserAlarmAPI";

export const chromeAlarmAPI: IBrowserAlarmAPI = {
  create: chrome.alarms.create,
  clear: chrome.alarms.clear,
  onAlarm: chrome.alarms.onAlarm,
};
