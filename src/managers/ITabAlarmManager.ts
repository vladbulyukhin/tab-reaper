import { TabId } from '../types';

export interface ITabAlarmManager {
  setAlarm(tabId: TabId, delayInMinutes: number, callback: () => void): Promise<void>;
  clearAlarm(tabId: TabId): Promise<void>;
}
