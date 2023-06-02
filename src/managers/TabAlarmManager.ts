import { IBrowserAlarmAPI } from '../api/IBrowserAlarmAPI';
import { Alarm, SimpleFunction, TabId } from '../types';
import { ITabAlarmManager } from './ITabAlarmManager';

export class TabAlarmManager implements ITabAlarmManager {
  private callbacks: Map<string, SimpleFunction> = new Map();

  constructor(private readonly browserAlarmAPI: IBrowserAlarmAPI) {
    this.browserAlarmAPI.onAlarm.addListener(this.handleAlarm.bind(this));
  }

  public async setAlarm(tabId: TabId, delayInMinutes: number, callback: () => void): Promise<void> {
    const alarmName = TabAlarmManager.getAlarmName(tabId);

    await this.browserAlarmAPI.clear(alarmName);
    await this.browserAlarmAPI.create(alarmName, { delayInMinutes: delayInMinutes });

    this.callbacks.set(alarmName, callback);
  }

  public async clearAlarm(tabId: TabId): Promise<void> {
    const alarmName = TabAlarmManager.getAlarmName(tabId);
    await this.browserAlarmAPI.clear(alarmName);
    this.callbacks.delete(alarmName);
  }

  private handleAlarm(alarm: Alarm): void {
    const callback = this.callbacks.get(alarm.name);
    if (typeof callback === 'function') {
      callback();
    }
  }

  private static getAlarmName(tabId: TabId) {
    return tabId.toString();
  }
}
