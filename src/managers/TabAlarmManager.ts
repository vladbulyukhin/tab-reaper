import type { IBrowserAlarmAPI } from "../api/IBrowserAlarmAPI";
import type { TabId } from "../types";
import type { ITabAlarmManager } from "./ITabAlarmManager";

export type TabAlarmName = `tab:${TabId}`;

export class TabAlarmManager implements ITabAlarmManager {
  constructor(private readonly _browserAlarmAPI: IBrowserAlarmAPI) {}

  public async setAlarm(tabId: TabId, delayInMinutes: number): Promise<void> {
    const alarmName = TabAlarmManager.getAlarmName(tabId);
    await this._browserAlarmAPI.clear(alarmName);
    await this._browserAlarmAPI.create(alarmName, {
      delayInMinutes: delayInMinutes,
    });
  }

  public async clearAlarm(tabId: TabId): Promise<void> {
    const alarmName = TabAlarmManager.getAlarmName(tabId);
    await this._browserAlarmAPI.clear(alarmName);
  }

  public onAlarm(callback: (tabId: TabId) => void): void {
    this._browserAlarmAPI.onAlarm.addListener((alarm) => {
      if (TabAlarmManager.isTabAlarmName(alarm.name)) {
        const tabId = TabAlarmManager.getTabId(alarm.name);
        callback(tabId);
      }
    });
  }

  private static getAlarmName(tabId: TabId): TabAlarmName {
    return `tab:${tabId}`;
  }

  private static getTabId(alarmName: TabAlarmName): TabId {
    return Number.parseInt(alarmName.split(":")[1], 10);
  }

  private static isTabAlarmName(alarmName: string): alarmName is TabAlarmName {
    return alarmName.startsWith("tab:");
  }
}
