import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { logInfo } from "../../common/utils/log";
import { PersistedValue } from "../utils/PersistedValue";
import { SequentialTaskQueue } from "../utils/SequentialTaskQueue";

export type SnoozeStatus = {
  snoozed: boolean;
  until: string | null;
  remainingMinutes: number | null;
};

type SnoozeState = {
  until: string | null;
};

const emptySnoozeState: SnoozeState = { until: null };

const SNOOZE_ALARM_NAME = "snooze:end";

const isSnoozeState = (value: unknown): value is SnoozeState => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const until = (value as { until?: unknown }).until;
  return (
    until === null ||
    (typeof until === "string" && Number.isFinite(Date.parse(until)))
  );
};

export interface ISnoozeManager {
  getStatus(): Promise<SnoozeStatus>;
  isSnoozed(): Promise<boolean>;
  setSnooze(minutes: number): Promise<SnoozeStatus>;
  clearSnooze(): Promise<SnoozeStatus>;
  ensureAlarmScheduled(): Promise<void>;
  onEnded(callback: () => void): void;
}

export class SnoozeManager implements ISnoozeManager {
  private readonly snooze: PersistedValue<SnoozeState>;
  private readonly endListeners = new Set<() => void>();
  private readonly alarmMutationQueue = new SequentialTaskQueue();
  private activeUntil: string | null = null;
  private endedUntil: string | null = null;
  private alarmRetryUntil: string | null = null;
  private earlyRescheduledUntil: string | null = null;
  private earlyRescheduleInFlight: {
    until: string;
    promise: Promise<boolean>;
  } | null = null;
  private stateRevision = 0;

  constructor(
    private readonly browserApiProvider: Pick<
      IBrowserApiProvider,
      "localStorage" | "alarm"
    >,
  ) {
    this.snooze = new PersistedValue<SnoozeState>(
      this.browserApiProvider.localStorage,
      "snooze",
      emptySnoozeState,
    );

    this.browserApiProvider.alarm.onAlarm.addListener((alarm) => {
      if (alarm?.name !== SNOOZE_ALARM_NAME) return;
      void this.handleSnoozeEnd().catch((error) => {
        logInfo("Failed to handle snooze alarm", error);
      });
    });
  }

  public onEnded(callback: () => void): void {
    this.endListeners.add(callback);
  }

  public async ensureAlarmScheduled(): Promise<void> {
    const status = await this.reconcileStatus(false);
    if (!status.snoozed || !status.until) return;

    await this.scheduleAlarm(status.until);
  }

  private scheduleAlarm(until: string): Promise<boolean> {
    return this.alarmMutationQueue.addTask(() => this.scheduleAlarmNow(until));
  }

  private async scheduleAlarmNow(until: string): Promise<boolean> {
    const untilMs = Date.parse(until);
    if (untilMs <= Date.now()) return false;

    const remainingMs = untilMs - Date.now();
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));

    await this.tryClearAlarmNow();
    if (untilMs <= Date.now()) return false;

    try {
      await this.browserApiProvider.alarm.create(SNOOZE_ALARM_NAME, {
        when: untilMs,
      });
      if (this.activeUntil === until) {
        this.alarmRetryUntil = null;
      }
      return true;
    } catch {}

    await this.tryClearAlarmNow();
    if (untilMs <= Date.now()) return false;

    try {
      await this.browserApiProvider.alarm.create(SNOOZE_ALARM_NAME, {
        delayInMinutes: remainingMinutes,
      });
      if (this.activeUntil === until) {
        this.alarmRetryUntil = null;
      }
      return true;
    } catch (error) {
      if (this.activeUntil === until) {
        this.alarmRetryUntil = until;
      }
      logInfo("Failed to schedule snooze alarm", error);
      return false;
    }
  }

  private clearAlarm(): Promise<void> {
    return this.alarmMutationQueue.addTask(() => this.tryClearAlarmNow());
  }

  private async tryClearAlarmNow(): Promise<void> {
    try {
      await this.browserApiProvider.alarm.clear(SNOOZE_ALARM_NAME);
    } catch (error) {
      logInfo("Failed to clear snooze alarm", error);
    }
  }

  public async getStatus(): Promise<SnoozeStatus> {
    return this.reconcileStatus(true);
  }

  private async reconcileStatus(
    retryAlarmScheduling: boolean,
  ): Promise<SnoozeStatus> {
    const state = await this.readSnoozeState();
    if (!state || state.until === null) {
      return { snoozed: false, until: null, remainingMinutes: null };
    }
    const until = state.until;
    const untilMs = Date.parse(until);
    const remainingMs = untilMs - Date.now();
    if (remainingMs <= 0) {
      const revision = this.stateRevision;
      const cleared = await this.clearPersistedSnooze(until);
      if (!cleared || revision !== this.stateRevision) {
        return this.reconcileStatus(retryAlarmScheduling);
      }
      this.notifySnoozeEnded(until);
      return { snoozed: false, until: null, remainingMinutes: null };
    }

    this.activeUntil = until;
    const status = {
      snoozed: true,
      until,
      remainingMinutes: Math.ceil(remainingMs / 60_000),
    };
    if (retryAlarmScheduling && this.alarmRetryUntil === until) {
      await this.scheduleAlarm(until);
    }
    return status;
  }

  private async readSnoozeState(): Promise<SnoozeState | null> {
    const result = await this.snooze.read();
    if (!result.hasStoredValue) return null;
    if (result.isValid && isSnoozeState(result.value)) {
      return result.value;
    }

    const normalized = await this.snooze.update((current) =>
      isSnoozeState(current) ? current : emptySnoozeState,
    );
    if (normalized.until === null) {
      await this.clearAlarm();
    }
    return normalized;
  }

  public async isSnoozed(): Promise<boolean> {
    const status = await this.getStatus();
    return status.snoozed;
  }

  public async setSnooze(minutes: number): Promise<SnoozeStatus> {
    const normalized = Number.isFinite(minutes) ? Math.round(minutes) : 0;
    if (normalized <= 0) {
      return this.clearSnooze();
    }

    const until = new Date(Date.now() + normalized * 60_000).toISOString();
    await this.snooze.update(() => ({ until }));
    this.stateRevision++;
    this.activeUntil = until;
    this.endedUntil = null;
    this.alarmRetryUntil = null;
    this.earlyRescheduledUntil = null;
    this.earlyRescheduleInFlight = null;
    await this.scheduleAlarm(until);
    return this.reconcileStatus(false);
  }

  public async clearSnooze(): Promise<SnoozeStatus> {
    await this.clearPersistedSnooze();
    this.stateRevision++;
    this.activeUntil = null;
    this.alarmRetryUntil = null;
    this.earlyRescheduledUntil = null;
    this.earlyRescheduleInFlight = null;
    return { snoozed: false, until: null, remainingMinutes: null };
  }

  private async clearPersistedSnooze(expectedUntil?: string): Promise<boolean> {
    let cleared = true;
    await this.snooze.update((current) => {
      if (
        expectedUntil !== undefined &&
        (!isSnoozeState(current) || current.until !== expectedUntil)
      ) {
        cleared = false;
        return current;
      }
      return emptySnoozeState;
    });
    if (!cleared) return false;

    await this.clearAlarm();
    return true;
  }

  private async handleSnoozeEnd(): Promise<void> {
    const state = await this.readSnoozeState();
    if (!state || state.until === null) return;

    const until = state.until;
    const untilMs = Date.parse(until);
    this.activeUntil = until;
    if (untilMs > Date.now()) {
      await this.rescheduleEarlyAlarm(until);
      return;
    }

    const status = await this.reconcileStatus(false);
    if (status.snoozed && status.until) {
      await this.scheduleAlarm(status.until);
    }
  }

  private async rescheduleEarlyAlarm(until: string): Promise<void> {
    if (this.earlyRescheduledUntil === until) return;

    const current = this.earlyRescheduleInFlight;
    if (current?.until === until) {
      await current.promise;
      return;
    }

    const scheduling = {
      until,
      promise: this.scheduleAlarm(until),
    };
    this.earlyRescheduleInFlight = scheduling;
    try {
      const scheduled = await scheduling.promise;
      if (
        scheduled &&
        this.activeUntil === until &&
        Date.parse(until) > Date.now()
      ) {
        this.earlyRescheduledUntil = until;
      }
    } finally {
      if (this.earlyRescheduleInFlight === scheduling) {
        this.earlyRescheduleInFlight = null;
      }
    }
  }

  private notifySnoozeEnded(until: string): void {
    if (this.endedUntil === until) return;

    this.activeUntil = null;
    this.endedUntil = until;
    if (this.earlyRescheduledUntil === until) {
      this.earlyRescheduledUntil = null;
    }

    logInfo("Snooze ended");

    for (const cb of this.endListeners) {
      try {
        cb();
      } catch {}
    }
  }
}
