import type { IBrowserApiProvider } from "../../../api/IBrowserApiProvider";
import type { TabId } from "../../../types";

export type TabAlarmName = `tab:${number}`;

export interface ITabAlarmManager {
  setAlarm(tabId: TabId, delayInMinutes: number): Promise<void>;
  clearAlarm(tabId: TabId): Promise<void>;
  onAlarm(callback: (tabId: TabId) => void): void;
}

export class TabAlarmManager implements ITabAlarmManager {
  constructor(
    private readonly browserApiProvider: Pick<IBrowserApiProvider, "alarm">
  ) {}

  public async setAlarm(tabId: TabId, delayInMinutes: number): Promise<void> {
    const alarmName = TabAlarmManager.getAlarmName(tabId);
    await this.browserApiProvider.alarm.clear(alarmName);
    await this.browserApiProvider.alarm.create(alarmName, { delayInMinutes });
  }

  public async clearAlarm(tabId: TabId): Promise<void> {
    const alarmName = TabAlarmManager.getAlarmName(tabId);
    await this.browserApiProvider.alarm.clear(alarmName);
  }

  public onAlarm(callback: (tabId: TabId) => void): void {
    this.browserApiProvider.alarm.onAlarm.addListener((alarm) => {
      if (TabAlarmManager.isTabAlarmName(alarm.name)) {
        const tabId = TabAlarmManager.getTabId(alarm.name);
        callback(tabId);
      }
    });
  }

  private static getAlarmName(tabId: TabId): TabAlarmName {
    return `tab:${tabId}`;
  }

  private static getTabId(alarmName: TabAlarmName): number {
    return Number.parseInt(alarmName.split(":")[1], 10);
  }

  private static isTabAlarmName(alarmName: string): alarmName is TabAlarmName {
    return alarmName.startsWith("tab:");
  }
}
