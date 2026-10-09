import { beforeEach, describe, expect, it, vi } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { type ITabAlarmManager, TabAlarmManager } from "./TabAlarmManager";

describe("TabAlarmManager", () => {
  let tabAlarmManager: ITabAlarmManager;
  let browserApiProvider: DeepMockProxy<IBrowserApiProvider>;

  const createDeferred = <T>() => {
    let resolve: ((value: T) => void) | undefined;
    const promise = new Promise<T>((resolvePromise) => {
      resolve = resolvePromise;
    });
    return {
      promise,
      resolve: (value: T) => resolve?.(value),
    };
  };

  const mockAlarmClear = (
    implementation: (name: string) => Promise<void>,
  ): void => {
    const clear = browserApiProvider.alarm.clear as unknown as {
      mockImplementation: (fn: typeof implementation) => void;
    };
    clear.mockImplementation(implementation);
  };

  const mockAlarmCreate = (
    implementation: (
      name: string,
      alarmInfo: chrome.alarms.AlarmCreateInfo,
    ) => Promise<void>,
  ): void => {
    const create = browserApiProvider.alarm.create as unknown as {
      mockImplementation: (fn: typeof implementation) => void;
    };
    create.mockImplementation(implementation);
  };

  beforeEach(() => {
    browserApiProvider = mockDeep<IBrowserApiProvider>();
    browserApiProvider.alarm.getAll.mockResolvedValue([]);
    tabAlarmManager = new TabAlarmManager(browserApiProvider);
  });

  describe("idle scheduling", () => {
    it("sets an alarm at an absolute deadline", async () => {
      const tabId = "11";
      const when = 1_700_000_000_000;

      await (tabAlarmManager as TabAlarmManager).setIdleAlarm(tabId, when, 1);

      expect(browserApiProvider.alarm.create).toHaveBeenCalledWith(
        `idle:${tabId}:1`,
        { when },
      );
    });

    it("applies a later clear after an older set finishes", async () => {
      const tabId = "12";
      const firstClear = createDeferred<void>();
      const alarms = new Set<string>();
      let clearCalls = 0;
      mockAlarmClear(async (name) => {
        clearCalls += 1;
        if (clearCalls === 1) await firstClear.promise;
        alarms.delete(name);
      });
      mockAlarmCreate(async (name) => {
        alarms.add(name);
      });

      browserApiProvider.alarm.getAll.mockResolvedValue([
        { name: `idle:${tabId}:0`, scheduledTime: 0 },
      ]);
      const oldSet = tabAlarmManager.setIdleAlarm(tabId, 100, 1);
      await vi.waitFor(() =>
        expect(browserApiProvider.alarm.clear).toHaveBeenCalledTimes(1),
      );
      const laterClear = tabAlarmManager.clearIdleAlarm(tabId, 1);

      firstClear.resolve();
      await Promise.all([oldSet, laterClear]);

      expect(alarms.has(`idle:${tabId}:1`)).toBe(false);
    });

    it("lets a later clear and new set determine the final alarm", async () => {
      const tabId = "13";
      const firstClear = createDeferred<void>();
      const alarms = new Map<string, chrome.alarms.AlarmCreateInfo>();
      let clearCalls = 0;
      mockAlarmClear(async (name) => {
        clearCalls += 1;
        if (clearCalls === 1) await firstClear.promise;
        alarms.delete(name);
      });
      mockAlarmCreate(async (name, alarmInfo) => {
        alarms.set(name, alarmInfo);
      });

      browserApiProvider.alarm.getAll.mockResolvedValue([
        { name: `idle:${tabId}:0`, scheduledTime: 0 },
      ]);
      const oldSet = tabAlarmManager.setIdleAlarm(tabId, 100, 1);
      await vi.waitFor(() =>
        expect(browserApiProvider.alarm.clear).toHaveBeenCalledTimes(1),
      );
      const activationClear = tabAlarmManager.clearIdleAlarm(tabId, 1);
      const newSet = tabAlarmManager.setIdleAlarm(tabId, 200, 1);

      firstClear.resolve();
      await Promise.all([oldSet, activationClear, newSet]);

      expect(alarms.get(`idle:${tabId}:1`)).toEqual({ when: 200 });
    });
  });

  describe("idle ledger alarms", () => {
    it("schedules an absolute deadline under an opaque ledger record ID", async () => {
      await tabAlarmManager.setIdleAlarm("record-abc", 1_700_000_000_000, 4);

      expect(browserApiProvider.alarm.create).toHaveBeenCalledWith(
        "idle:record-abc:4",
        { when: 1_700_000_000_000 },
      );
    });

    it("dispatches only record-addressed idle alarms", async () => {
      const spy = vi.fn();
      tabAlarmManager.onIdleAlarm(spy);
      const addListener = browserApiProvider.alarm.onAlarm
        .addListener as unknown as {
        mock: { calls: [[(alarm: chrome.alarms.Alarm) => void]] };
      };
      const listener = addListener.mock.calls[0][0];

      listener({ name: "tab:127:0", scheduledTime: 42 });
      listener({ name: "idle:record-abc:4", scheduledTime: 43 });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("record-abc", 4, 43);
    });

    it("replaces every older revision for the same record", async () => {
      const alarms = new Map<string, chrome.alarms.AlarmCreateInfo>();
      browserApiProvider.alarm.getAll.mockImplementation(async () =>
        [...alarms.entries()].map(([name, alarmInfo]) => ({
          name,
          scheduledTime: alarmInfo.when as number,
        })),
      );
      mockAlarmClear(async (name) => {
        alarms.delete(name);
      });
      mockAlarmCreate(async (name, alarmInfo) => {
        alarms.set(name, alarmInfo);
      });

      await tabAlarmManager.setIdleAlarm("record-abc", 100, 1);
      await tabAlarmManager.setIdleAlarm("record-abc", 200, 2);

      expect(alarms).toEqual(new Map([["idle:record-abc:2", { when: 200 }]]));
    });
  });

  it("clears legacy alarms without touching ledger or snooze alarms", async () => {
    browserApiProvider.alarm.getAll.mockResolvedValue([
      { name: "tab:10", scheduledTime: 1 },
      { name: "tab:10:2", scheduledTime: 2 },
      { name: "idle:record:1", scheduledTime: 3 },
      { name: "snooze", scheduledTime: 4 },
    ]);
    await tabAlarmManager.clearLegacyAlarms();
    expect(browserApiProvider.alarm.clear.mock.calls).toEqual([
      ["tab:10"],
      ["tab:10:2"],
    ]);
  });

  it("returns the current tab alarms", async () => {
    const alarms: chrome.alarms.Alarm[] = [
      { name: "tab:12:7", scheduledTime: 42 },
    ];
    browserApiProvider.alarm.getAll.mockResolvedValue(alarms);

    await expect(tabAlarmManager.getAlarms()).resolves.toEqual(alarms);
  });
});
