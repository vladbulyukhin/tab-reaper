import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { IBrowserApiProvider } from "../../../api/IBrowserApiProvider";
import type { TabId } from "../../../types";
import { type ITabAlarmManager, TabAlarmManager } from "./TabAlarmManager";

describe("TabAlarmManager", () => {
  let tabAlarmManager: ITabAlarmManager;
  let browserApiProvider: DeepMockProxy<IBrowserApiProvider>;

  beforeEach(() => {
    browserApiProvider = mockDeep<IBrowserApiProvider>();
    tabAlarmManager = new TabAlarmManager(browserApiProvider);
  });

  describe("setAlarm", () => {
    it("should set alarm", async () => {
      const tabId: TabId = 10;
      const delay = 5;

      await tabAlarmManager.setAlarm(tabId, delay);
      expect(browserApiProvider.alarm.create).toHaveBeenCalledWith(
        `tab:${tabId}`,
        {
          delayInMinutes: delay,
        }
      );
    });

    it("should clear previously set alarm", async () => {
      const tabId: TabId = 10;
      const delay = 5;

      await tabAlarmManager.setAlarm(tabId, delay);
      browserApiProvider.alarm.clear.mockReset();

      await tabAlarmManager.setAlarm(tabId, delay);
      expect(browserApiProvider.alarm.clear).toHaveBeenCalledTimes(1);
      expect(browserApiProvider.alarm.clear).toHaveBeenLastCalledWith(
        `tab:${tabId}`
      );
    });
  });

  describe("onAlarm", () => {
    it("should add alarm listener", async () => {
      const tabId: TabId = 10;
      const spy = vi.fn();

      await tabAlarmManager.onAlarm(spy);

      (browserApiProvider.alarm.onAlarm.addListener as Mock).mock.calls[0][0]({
        name: `tab:${tabId}`,
        scheduledTime: 0,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenLastCalledWith(tabId);
    });
  });
});
