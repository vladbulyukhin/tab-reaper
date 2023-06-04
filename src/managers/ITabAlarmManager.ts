import { TabId } from '../types';

export interface ITabAlarmManager {
  setAlarm(tabId: TabId, delayInMinutes: number): Promise<void>;
  clearAlarm(tabId: TabId): Promise<void>;
  onAlarm(callback: (tabId: TabId) => void): void;
}
