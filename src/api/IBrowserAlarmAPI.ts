import { AlarmCreateInfo, AlarmEvent } from '../types';

export interface IBrowserAlarmAPI {
  create(name: string, alarmInfo: AlarmCreateInfo): Promise<void>;
  clear(name: string): Promise<void>;
  onAlarm: AlarmEvent;
}
