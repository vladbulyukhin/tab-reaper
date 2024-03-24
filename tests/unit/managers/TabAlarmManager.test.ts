import { beforeEach, describe, expect, it, vi } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { IBrowserAlarmAPI } from "../../../src/api/IBrowserAlarmAPI";
import type { ITabAlarmManager } from "../../../src/managers/ITabAlarmManager";
import { TabAlarmManager } from "../../../src/managers/TabAlarmManager";
import type { TabId } from "../../../src/types";

describe("TabAlarmManager", () => {
  let tabAlarmManager: ITabAlarmManager;
  let browserAlarmAPI: DeepMockProxy<IBrowserAlarmAPI>;

  beforeEach(() => {
    browserAlarmAPI = mockDeep<IBrowserAlarmAPI>();
    tabAlarmManager = new TabAlarmManager(browserAlarmAPI);
  });

  describe("setAlarm", () => {
    it("should set alarm", async () => {
      const tabId: TabId = 10;
      const delay = 5;

      await tabAlarmManager.setAlarm(tabId, delay);
      expect(browserAlarmAPI.create).toHaveBeenCalledWith(`tab:${tabId}`, {
        delayInMinutes: delay,
      });
    });

    it("should clear previously set alarm", async () => {
      const tabId: TabId = 10;
      const delay = 5;

      await tabAlarmManager.setAlarm(tabId, delay);
      browserAlarmAPI.clear.mockReset();

      await tabAlarmManager.setAlarm(tabId, delay);
      expect(browserAlarmAPI.clear).toHaveBeenCalledTimes(1);
      expect(browserAlarmAPI.clear).toHaveBeenLastCalledWith(`tab:${tabId}`);
    });
  });

  describe("onAlarm", () => {
    it("should add alarm listener", async () => {
      const tabId: TabId = 10;
      const spy = vi.fn();

      await tabAlarmManager.onAlarm(spy);

      browserAlarmAPI.onAlarm.addListener.mock.calls[0][0]({
        name: `tab:${tabId}`,
        scheduledTime: 0,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenLastCalledWith(tabId);
    });
  });
});
