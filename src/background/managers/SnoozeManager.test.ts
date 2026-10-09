import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { logInfo } from "../utils/log";
import { type ISnoozeManager, SnoozeManager } from "./SnoozeManager";

vi.mock("../utils/log", () => ({
  logInfo: vi.fn(),
}));

describe("SnoozeManager", () => {
  const now = new Date("2026-06-18T10:00:00.000Z");

  let browserApiProvider: Pick<IBrowserApiProvider, "localStorage" | "alarm">;
  let storage: Record<string, unknown>;
  let snoozeManager: ISnoozeManager;
  let alarmListener: ((alarm: chrome.alarms.Alarm) => void) | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    storage = {};
    alarmListener = null;
    vi.mocked(logInfo).mockClear();
    browserApiProvider = {
      localStorage: {
        clear: vi.fn(async () => {
          storage = {};
        }),
        get: vi.fn(async (defaults?: Record<string, unknown>) => ({
          ...(defaults ?? {}),
          ...storage,
        })) as IBrowserApiProvider["localStorage"]["get"],
        onChanged: {
          addListener: vi.fn(),
          hasListener: vi.fn(),
          hasListeners: vi.fn(),
          removeListener: vi.fn(),
        } as unknown as chrome.storage.StorageChangedEvent,
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storage[key];
          }
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          storage = { ...storage, ...items };
        }) as IBrowserApiProvider["localStorage"]["set"],
      },
      alarm: {
        clear: vi.fn(
          async () => undefined,
        ) as IBrowserApiProvider["alarm"]["clear"],
        create: vi.fn(
          async () => undefined,
        ) as IBrowserApiProvider["alarm"]["create"],
        getAll: vi.fn(async () => []) as IBrowserApiProvider["alarm"]["getAll"],
        onAlarm: {
          addListener: vi.fn(
            (listener: (alarm: chrome.alarms.Alarm) => void) => {
              alarmListener = listener;
            },
          ),
          hasListener: vi.fn(),
          hasListeners: vi.fn(),
          removeListener: vi.fn(),
        } as unknown as chrome.alarms.AlarmEvent,
      },
    };

    snoozeManager = new SnoozeManager(browserApiProvider);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const persistSnooze = (until: string | null) => {
    storage.snooze = JSON.stringify({ until });
  };

  const createDeferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
      resolve = promiseResolve;
    });
    return { promise, resolve };
  };

  const trackAlarmState = (initialUntil: number, firstClear: Promise<void>) => {
    const mutations: ({ type: "clear" } | { type: "create"; until: number })[] =
      [];
    let scheduledUntil: number | null = initialUntil;
    const clear = browserApiProvider.alarm.clear as ReturnType<typeof vi.fn>;
    clear.mockReset();
    clear
      .mockImplementationOnce(async () => {
        await firstClear;
        scheduledUntil = null;
        mutations.push({ type: "clear" });
      })
      .mockImplementation(async () => {
        scheduledUntil = null;
        mutations.push({ type: "clear" });
      });
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    create.mockReset();
    create.mockImplementation(
      async (_name: string, alarmInfo: chrome.alarms.AlarmCreateInfo) => {
        const until =
          alarmInfo.when ??
          Date.now() + (alarmInfo.delayInMinutes ?? 0) * 60_000;
        scheduledUntil = until;
        mutations.push({ type: "create", until });
      },
    );

    return {
      mutations,
      scheduledUntil: () => scheduledUntil,
    };
  };

  it("reports active snooze state with remaining minutes", async () => {
    const until = new Date(now.getTime() + 5 * 60_000).toISOString();
    persistSnooze(until);

    await expect(snoozeManager.getStatus()).resolves.toEqual({
      snoozed: true,
      until,
      remainingMinutes: 5,
    });
    await expect(snoozeManager.isSnoozed()).resolves.toBe(true);
  });

  it("propagates an unavailable snooze-state read instead of allowing cleanup", async () => {
    const get = browserApiProvider.localStorage.get as ReturnType<typeof vi.fn>;
    get.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(snoozeManager.isSnoozed()).rejects.toThrow(
      "storage unavailable",
    );
  });

  it("clears expired snooze state", async () => {
    persistSnooze(new Date(now.getTime() - 60_000).toISOString());

    await expect(snoozeManager.getStatus()).resolves.toEqual({
      snoozed: false,
      until: null,
      remainingMinutes: null,
    });

    expect(storage.snooze).toBe(JSON.stringify({ until: null }));
    expect(browserApiProvider.alarm.clear).toHaveBeenCalledWith("snooze:end");
  });

  it("notifies once when startup reconciliation discovers an expired snooze", async () => {
    persistSnooze(new Date(now.getTime() - 60_000).toISOString());
    const onEnded = vi.fn();
    snoozeManager.onEnded(onEnded);

    await snoozeManager.ensureAlarmScheduled();
    await snoozeManager.getStatus();

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(storage.snooze).toBe(JSON.stringify({ until: null }));
  });

  it("clears invalid snooze state", async () => {
    persistSnooze("not-a-date");

    await expect(snoozeManager.getStatus()).resolves.toEqual({
      snoozed: false,
      until: null,
      remainingMinutes: null,
    });

    expect(storage.snooze).toBe(JSON.stringify({ until: null }));
    expect(browserApiProvider.alarm.clear).toHaveBeenCalledWith("snooze:end");
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["a primitive payload", JSON.stringify(42)],
    ["an object missing until", JSON.stringify({})],
    ["an object with a non-string until", JSON.stringify({ until: 42 })],
  ])("normalizes %s to persisted inactive state", async (_label, rawValue) => {
    storage.snooze = rawValue;

    await expect(snoozeManager.getStatus()).resolves.toEqual({
      snoozed: false,
      until: null,
      remainingMinutes: null,
    });

    expect(storage.snooze).toBe(JSON.stringify({ until: null }));
  });

  it("does not persist a default when snooze state is missing", async () => {
    await expect(snoozeManager.getStatus()).resolves.toEqual({
      snoozed: false,
      until: null,
      remainingMinutes: null,
    });

    expect(storage).not.toHaveProperty("snooze");
    expect(browserApiProvider.localStorage.set).not.toHaveBeenCalled();
  });

  it("falls back from absolute alarm scheduling to delayInMinutes", async () => {
    const until = new Date(now.getTime() + 5 * 60_000).toISOString();
    persistSnooze(until);
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    create
      .mockRejectedValueOnce(new Error("when unsupported"))
      .mockResolvedValueOnce(undefined);

    await snoozeManager.ensureAlarmScheduled();

    expect(browserApiProvider.alarm.clear).toHaveBeenCalledTimes(2);
    expect(browserApiProvider.alarm.create).toHaveBeenNthCalledWith(
      1,
      "snooze:end",
      { when: Date.parse(until) },
    );
    expect(browserApiProvider.alarm.create).toHaveBeenNthCalledWith(
      2,
      "snooze:end",
      { delayInMinutes: 5 },
    );
  });

  it("ignores alarm clear failures and still tries absolute then relative creation", async () => {
    const until = new Date(now.getTime() + 5 * 60_000).toISOString();
    persistSnooze(until);
    const clear = browserApiProvider.alarm.clear as ReturnType<typeof vi.fn>;
    clear.mockRejectedValue(new Error("clear unavailable"));
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    create
      .mockRejectedValueOnce(new Error("when unsupported"))
      .mockResolvedValueOnce(undefined);

    await snoozeManager.ensureAlarmScheduled();

    expect(create).toHaveBeenNthCalledWith(1, "snooze:end", {
      when: Date.parse(until),
    });
    expect(create).toHaveBeenNthCalledWith(2, "snooze:end", {
      delayInMinutes: 5,
    });
  });

  it("returns persisted protection after scheduling fails and retries on status", async () => {
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    create.mockRejectedValue(new Error("alarms unavailable"));

    await expect(snoozeManager.setSnooze(30)).resolves.toMatchObject({
      snoozed: true,
      remainingMinutes: 30,
    });
    expect(create).toHaveBeenCalledTimes(2);

    create.mockResolvedValue(undefined);
    await expect(snoozeManager.getStatus()).resolves.toMatchObject({
      snoozed: true,
      remainingMinutes: 30,
    });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("replaces the deadline and treats non-positive or invalid input as manual resume", async () => {
    await snoozeManager.setSnooze(30);
    await snoozeManager.setSnooze(60);

    await expect(snoozeManager.getStatus()).resolves.toEqual({
      snoozed: true,
      until: "2026-06-18T11:00:00.000Z",
      remainingMinutes: 60,
    });

    await snoozeManager.setSnooze(1440);
    await expect(snoozeManager.getStatus()).resolves.toEqual({
      snoozed: true,
      until: "2026-06-19T10:00:00.000Z",
      remainingMinutes: 1440,
    });

    await expect(snoozeManager.setSnooze(0)).resolves.toEqual({
      snoozed: false,
      until: null,
      remainingMinutes: null,
    });

    await snoozeManager.setSnooze(30);
    await expect(snoozeManager.setSnooze(-1)).resolves.toEqual({
      snoozed: false,
      until: null,
      remainingMinutes: null,
    });

    await snoozeManager.setSnooze(30);
    await expect(snoozeManager.setSnooze(Number.NaN)).resolves.toEqual({
      snoozed: false,
      until: null,
      remainingMinutes: null,
    });
  });

  it("leaves an existing snooze unchanged when its replacement cannot persist", async () => {
    const existingUntil = new Date(now.getTime() + 30 * 60_000).toISOString();
    persistSnooze(existingUntil);
    await snoozeManager.getStatus();
    const set = browserApiProvider.localStorage.set as ReturnType<typeof vi.fn>;
    set.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(snoozeManager.setSnooze(60)).rejects.toThrow(
      "storage unavailable",
    );
    await expect(snoozeManager.getStatus()).resolves.toEqual({
      snoozed: true,
      until: existingUntil,
      remainingMinutes: 30,
    });
  });

  it("resumes even if clearing a stale alarm fails", async () => {
    await snoozeManager.setSnooze(30);
    const clear = browserApiProvider.alarm.clear as ReturnType<typeof vi.fn>;
    clear.mockRejectedValueOnce(new Error("alarm clear unavailable"));

    await expect(snoozeManager.clearSnooze()).resolves.toEqual({
      snoozed: false,
      until: null,
      remainingMinutes: null,
    });
    expect(storage.snooze).toBe(JSON.stringify({ until: null }));
  });

  it("clears snooze and can resume a persisted snooze alarm", async () => {
    await snoozeManager.setSnooze(10);
    const persistedSnooze = storage.snooze;

    await expect(snoozeManager.clearSnooze()).resolves.toEqual({
      snoozed: false,
      until: null,
      remainingMinutes: null,
    });
    expect(storage.snooze).toBe(JSON.stringify({ until: null }));

    storage.snooze = persistedSnooze;
    const clear = browserApiProvider.alarm.clear as ReturnType<typeof vi.fn>;
    clear.mockClear();
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    create.mockClear();

    const resumedManager = new SnoozeManager(browserApiProvider);
    await resumedManager.ensureAlarmScheduled();

    expect(browserApiProvider.alarm.clear).toHaveBeenCalledWith("snooze:end");
    expect(browserApiProvider.alarm.create).toHaveBeenCalledWith("snooze:end", {
      when: Date.parse(JSON.parse(persistedSnooze as string).until),
    });
  });

  it("ignores a late alarm after manual resume", async () => {
    const onEnded = vi.fn();
    snoozeManager.onEnded(onEnded);

    await snoozeManager.setSnooze(10);
    await snoozeManager.clearSnooze();
    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime() + 10 * 60_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("notifies listeners only once when the ending alarm is delivered twice", async () => {
    const onEnded = vi.fn();
    snoozeManager.onEnded(onEnded);

    await snoozeManager.setSnooze(1);
    vi.setSystemTime(new Date(now.getTime() + 60_000));
    const scheduledTime = now.getTime() + 60_000;
    alarmListener?.({ name: "snooze:end", scheduledTime });
    alarmListener?.({ name: "snooze:end", scheduledTime });

    await vi.waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
  });

  it("expires a replacement when an older alarm arrives after its deadline", async () => {
    const onEnded = vi.fn();
    snoozeManager.onEnded(onEnded);

    await snoozeManager.setSnooze(10);
    await snoozeManager.setSnooze(20);
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    create.mockClear();
    vi.setSystemTime(new Date(now.getTime() + 20 * 60_000));
    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime() + 10 * 60_000,
    });

    await vi.waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
    expect(storage.snooze).toBe(JSON.stringify({ until: null }));
    expect(create).not.toHaveBeenCalled();

    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime() + 10 * 60_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("does not finish an expired transition after a replacement is persisted", async () => {
    const onEnded = vi.fn();
    snoozeManager.onEnded(onEnded);
    await snoozeManager.setSnooze(1);
    vi.setSystemTime(new Date(now.getTime() + 60_000));
    const staleClear = createDeferred<void>();
    const clear = browserApiProvider.alarm.clear as ReturnType<typeof vi.fn>;
    clear.mockImplementationOnce(() => staleClear.promise);

    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime() + 60_000,
    });
    await vi.waitFor(() =>
      expect(storage.snooze).toBe(JSON.stringify({ until: null })),
    );

    const replacementUntil = Date.now() + 30 * 60_000;
    const replacement = snoozeManager.setSnooze(30);
    await vi.waitFor(() =>
      expect(storage.snooze).toBe(
        JSON.stringify({
          until: new Date(replacementUntil).toISOString(),
        }),
      ),
    );
    staleClear.resolve();
    await replacement;
    await vi.advanceTimersByTimeAsync(0);

    expect(onEnded).not.toHaveBeenCalled();
    await expect(snoozeManager.getStatus()).resolves.toMatchObject({
      snoozed: true,
      remainingMinutes: 30,
    });
  });

  it("returns the replacement status when it wins an expiry race", async () => {
    persistSnooze(new Date(now.getTime() - 60_000).toISOString());
    const staleClear = createDeferred<void>();
    const clear = browserApiProvider.alarm.clear as ReturnType<typeof vi.fn>;
    clear.mockImplementationOnce(() => staleClear.promise);

    const staleStatus = snoozeManager.getStatus();
    await vi.waitFor(() =>
      expect(storage.snooze).toBe(JSON.stringify({ until: null })),
    );
    const replacementUntil = Date.now() + 30 * 60_000;
    const replacement = snoozeManager.setSnooze(30);
    await vi.waitFor(() =>
      expect(storage.snooze).toBe(
        JSON.stringify({
          until: new Date(replacementUntil).toISOString(),
        }),
      ),
    );
    staleClear.resolve();
    await replacement;

    await expect(staleStatus).resolves.toMatchObject({
      snoozed: true,
      remainingMinutes: 30,
    });
  });

  it("lets a replacement alarm win after an older early reschedule unblocks", async () => {
    const initialStatus = await snoozeManager.setSnooze(10);
    const earlyClear = createDeferred<void>();
    const alarmState = trackAlarmState(
      Date.parse(initialStatus.until as string),
      earlyClear.promise,
    );

    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime(),
    });
    await vi.waitFor(() =>
      expect(browserApiProvider.alarm.clear).toHaveBeenCalledTimes(1),
    );

    const replacementUntil = Date.now() + 5 * 60_000;
    const replacement = snoozeManager.setSnooze(5);
    await vi.waitFor(() =>
      expect(storage.snooze).toBe(
        JSON.stringify({
          until: new Date(replacementUntil).toISOString(),
        }),
      ),
    );

    earlyClear.resolve();
    await replacement;
    await vi.advanceTimersByTimeAsync(0);

    expect(alarmState.scheduledUntil()).toBe(replacementUntil);
    expect(alarmState.mutations.at(-1)).toEqual({
      type: "create",
      until: replacementUntil,
    });
    expect(storage.snooze).toBe(
      JSON.stringify({
        until: new Date(replacementUntil).toISOString(),
      }),
    );
  });

  it("lets a replacement alarm win after an expired-state clear unblocks", async () => {
    const initialStatus = await snoozeManager.setSnooze(1);
    vi.setSystemTime(new Date(now.getTime() + 60_000));
    const expiredClear = createDeferred<void>();
    const alarmState = trackAlarmState(
      Date.parse(initialStatus.until as string),
      expiredClear.promise,
    );

    const expiredStatus = snoozeManager.getStatus();
    await vi.waitFor(() =>
      expect(storage.snooze).toBe(JSON.stringify({ until: null })),
    );

    const replacementUntil = Date.now() + 5 * 60_000;
    const replacement = snoozeManager.setSnooze(5);
    await vi.waitFor(() =>
      expect(storage.snooze).toBe(
        JSON.stringify({
          until: new Date(replacementUntil).toISOString(),
        }),
      ),
    );

    expiredClear.resolve();
    await replacement;
    await expiredStatus;

    expect(alarmState.scheduledUntil()).toBe(replacementUntil);
    expect(alarmState.mutations.at(-1)).toEqual({
      type: "create",
      until: replacementUntil,
    });
    expect(storage.snooze).toBe(
      JSON.stringify({
        until: new Date(replacementUntil).toISOString(),
      }),
    );
  });

  it("lets manual resume clear an older early reschedule after it unblocks", async () => {
    const initialStatus = await snoozeManager.setSnooze(10);
    const earlyClear = createDeferred<void>();
    const alarmState = trackAlarmState(
      Date.parse(initialStatus.until as string),
      earlyClear.promise,
    );

    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime(),
    });
    await vi.waitFor(() =>
      expect(browserApiProvider.alarm.clear).toHaveBeenCalledTimes(1),
    );

    const resume = snoozeManager.clearSnooze();
    await vi.waitFor(() =>
      expect(storage.snooze).toBe(JSON.stringify({ until: null })),
    );

    earlyClear.resolve();
    await resume;
    await vi.advanceTimersByTimeAsync(0);

    expect(alarmState.scheduledUntil()).toBeNull();
    expect(alarmState.mutations.at(-1)).toEqual({ type: "clear" });
    expect(storage.snooze).toBe(JSON.stringify({ until: null }));
  });

  it("does not notify listeners when an alarm fires before the deadline", async () => {
    const onEnded = vi.fn();
    snoozeManager.onEnded(onEnded);

    await snoozeManager.setSnooze(10);
    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime() + 10 * 60_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onEnded).not.toHaveBeenCalled();
    await expect(snoozeManager.isSnoozed()).resolves.toBe(true);
  });

  it("recreates the wake alarm when a one-shot alarm fires early", async () => {
    const onEnded = vi.fn();
    snoozeManager.onEnded(onEnded);
    await snoozeManager.setSnooze(10);
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    create.mockClear();

    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime(),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(create).toHaveBeenCalledWith("snooze:end", {
      when: now.getTime() + 10 * 60_000,
    });
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("coalesces concurrent early deliveries for one future deadline", async () => {
    await snoozeManager.setSnooze(10);
    const clear = browserApiProvider.alarm.clear as ReturnType<typeof vi.fn>;
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    clear.mockClear();
    create.mockClear();
    const firstClear = createDeferred<void>();
    clear
      .mockImplementationOnce(() => firstClear.promise)
      .mockResolvedValue(undefined);
    const earlyAlarm = {
      name: "snooze:end",
      scheduledTime: now.getTime(),
    };

    alarmListener?.(earlyAlarm);
    alarmListener?.(earlyAlarm);
    await vi.waitFor(() => expect(clear).toHaveBeenCalled());
    firstClear.resolve();
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(0);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("ignores a duplicate early delivery after a successful reschedule", async () => {
    await snoozeManager.setSnooze(10);
    const clear = browserApiProvider.alarm.clear as ReturnType<typeof vi.fn>;
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    clear.mockClear();
    create.mockClear();
    const earlyAlarm = {
      name: "snooze:end",
      scheduledTime: now.getTime(),
    };

    alarmListener?.(earlyAlarm);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    alarmListener?.(earlyAlarm);
    await vi.advanceTimersByTimeAsync(0);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("retries an early reschedule after both creation attempts fail", async () => {
    await snoozeManager.setSnooze(10);
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    create.mockClear();
    create.mockRejectedValue(new Error("alarms unavailable"));
    const earlyAlarm = {
      name: "snooze:end",
      scheduledTime: now.getTime(),
    };

    alarmListener?.(earlyAlarm);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));

    create.mockResolvedValue(undefined);
    alarmListener?.(earlyAlarm);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3));
  });

  it("allows the real deadline alarm after an early reschedule", async () => {
    const onEnded = vi.fn();
    snoozeManager.onEnded(onEnded);
    await snoozeManager.setSnooze(10);
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    create.mockClear();

    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime(),
    });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    vi.setSystemTime(new Date(now.getTime() + 10 * 60_000));
    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime() + 10 * 60_000,
    });

    await vi.waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
    expect(storage.snooze).toBe(JSON.stringify({ until: null }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("resets early-delivery deduplication for a new deadline", async () => {
    await snoozeManager.setSnooze(10);
    const create = browserApiProvider.alarm.create as ReturnType<typeof vi.fn>;
    create.mockClear();
    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime(),
    });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    const replacementStartedAt = Date.now();
    await snoozeManager.setSnooze(20);
    create.mockClear();
    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime() + 10 * 60_000,
    });

    await vi.waitFor(() =>
      expect(create).toHaveBeenCalledWith("snooze:end", {
        when: replacementStartedAt + 20 * 60_000,
      }),
    );
  });

  it("logs a rejected fire-and-forget alarm handler", async () => {
    const error = new Error("storage unavailable");
    const get = browserApiProvider.localStorage.get as ReturnType<typeof vi.fn>;
    get.mockRejectedValueOnce(error);

    alarmListener?.({ name: "snooze:end", scheduledTime: now.getTime() });

    await vi.waitFor(() =>
      expect(logInfo).toHaveBeenCalledWith(
        "Failed to handle snooze alarm",
        error,
      ),
    );
  });

  it("calls onEnded callbacks when a known snooze expires", async () => {
    const onEnded = vi.fn();
    snoozeManager.onEnded(onEnded);

    await snoozeManager.setSnooze(1);
    vi.setSystemTime(new Date(now.getTime() + 60_000));
    alarmListener?.({
      name: "snooze:end",
      scheduledTime: now.getTime() + 60_000,
    });

    await vi.waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
  });
});
