import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { SequentialTaskQueue } from "../utils/SequentialTaskQueue";

export type IdleAlarmName = `idle:${string}:${number}`;

export interface ITabAlarmManager {
  clearLegacyAlarms(): Promise<void>;
  setIdleAlarm(recordId: string, when: number, revision: number): Promise<void>;
  clearIdleAlarm(recordId: string, revision?: number): Promise<void>;
  getAlarms(): Promise<ReadonlyArray<chrome.alarms.Alarm>>;
  onIdleAlarm(
    callback: (
      recordId: string,
      revision: number,
      scheduledTime: number,
    ) => void,
  ): void;
}

export class TabAlarmManager implements ITabAlarmManager {
  // One queue per record while it has pending work; dropped once idle so a
  // long-lived background does not keep a queue for every record ever seen.
  private readonly idleMutationQueues = new Map<
    string,
    { queue: SequentialTaskQueue; pending: number }
  >();

  constructor(
    private readonly browserApiProvider: Pick<IBrowserApiProvider, "alarm">,
  ) {}

  public async clearLegacyAlarms(): Promise<void> {
    const alarms = await this.browserApiProvider.alarm.getAll();
    await Promise.all(
      alarms
        .filter((alarm) => /^tab:\d+(?::\d+)?$/.test(alarm.name))
        .map((alarm) => this.browserApiProvider.alarm.clear(alarm.name)),
    );
  }

  public async setIdleAlarm(
    recordId: string,
    when: number,
    revision: number,
  ): Promise<void> {
    await this.runIdleMutation(recordId, async () => {
      const alarmName = TabAlarmManager.getIdleAlarmName(recordId, revision);
      await this.clearIdleAlarmRaw(recordId);
      await this.browserApiProvider.alarm.create(alarmName, { when });
    });
  }

  public async clearIdleAlarm(
    recordId: string,
    revision?: number,
  ): Promise<void> {
    await this.runIdleMutation(recordId, () =>
      this.clearIdleAlarmRaw(recordId, revision),
    );
  }

  public async getAlarms(): Promise<ReadonlyArray<chrome.alarms.Alarm>> {
    return await this.browserApiProvider.alarm.getAll();
  }

  private async clearIdleAlarmRaw(
    recordId: string,
    revision?: number,
  ): Promise<void> {
    if (typeof revision === "number") {
      await this.browserApiProvider.alarm.clear(
        TabAlarmManager.getIdleAlarmName(recordId, revision),
      );
      return;
    }

    const alarms = await this.browserApiProvider.alarm.getAll();
    await Promise.all(
      (Array.isArray(alarms) ? alarms : [])
        .map((alarm) => alarm.name)
        .filter(
          (name) =>
            TabAlarmManager.parseIdleAlarmName(name)?.recordId === recordId,
        )
        .map((name) => this.browserApiProvider.alarm.clear(name)),
    );
  }

  private async runIdleMutation(
    recordId: string,
    task: () => Promise<void>,
  ): Promise<void> {
    let entry = this.idleMutationQueues.get(recordId);
    if (!entry) {
      entry = { queue: new SequentialTaskQueue(), pending: 0 };
      this.idleMutationQueues.set(recordId, entry);
    }
    entry.pending += 1;
    try {
      await entry.queue.addTask(task);
    } finally {
      entry.pending -= 1;
      if (
        entry.pending === 0 &&
        this.idleMutationQueues.get(recordId) === entry
      ) {
        this.idleMutationQueues.delete(recordId);
      }
    }
  }

  public onIdleAlarm(
    callback: (
      recordId: string,
      revision: number,
      scheduledTime: number,
    ) => void,
  ): void {
    this.browserApiProvider.alarm.onAlarm.addListener((alarm) => {
      const parsedAlarm = TabAlarmManager.parseIdleAlarmName(alarm.name);
      if (parsedAlarm) {
        callback(
          parsedAlarm.recordId,
          parsedAlarm.revision,
          alarm.scheduledTime,
        );
      }
    });
  }

  private static getIdleAlarmName(
    recordId: string,
    revision: number,
  ): IdleAlarmName {
    return `idle:${recordId}:${revision}`;
  }

  private static parseIdleAlarmName(
    alarmName: string,
  ): { recordId: string; revision: number } | null {
    const match = /^idle:([^:]+):(\d+)$/.exec(alarmName);
    if (!match) return null;
    return { recordId: match[1], revision: Number.parseInt(match[2], 10) };
  }
}
