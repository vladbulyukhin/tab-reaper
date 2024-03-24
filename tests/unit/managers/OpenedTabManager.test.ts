import { beforeEach, describe, expect, it } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { IBrowserRuntimeAPI } from "../../../src/api/IBrowserRuntimeAPI";
import type { IBrowserStorageAPI } from "../../../src/api/IBrowserStorageAPI";
import type { IBrowserTabAPI } from "../../../src/api/IBrowserTabAPI";
import type { IConfigurationManager } from "../../../src/managers/IConfigurationManager";
import type { IExcludedTabManager } from "../../../src/managers/IExcludedTabManager";
import type { IOpenedTabManager } from "../../../src/managers/IOpenedTabManager";
import type { ITabAlarmManager } from "../../../src/managers/ITabAlarmManager";
import { OpenedTabManager } from "../../../src/managers/OpenedTabManager";
import { emptyConfiguration } from "../../../src/models/Configuration";
import type { Tab, TabId, WindowId } from "../../../src/types";

describe("OpenedTabManager", () => {
  let openedTabManager: IOpenedTabManager;
  let browserRuntimeAPI: DeepMockProxy<IBrowserRuntimeAPI>;
  let browserTabAPI: DeepMockProxy<IBrowserTabAPI>;
  let browserStorageAPI: DeepMockProxy<IBrowserStorageAPI>;
  let tabAlarmManager: DeepMockProxy<ITabAlarmManager>;
  let excludedTabManager: DeepMockProxy<IExcludedTabManager>;
  let configurationManager: DeepMockProxy<IConfigurationManager>;

  beforeEach(() => {
    browserStorageAPI = mockDeep<IBrowserStorageAPI>();
    browserStorageAPI.get.mockReturnValue(
      Promise.resolve({ previousActiveTabByWindow: {} }),
    );

    browserRuntimeAPI = mockDeep<IBrowserRuntimeAPI>();
    browserTabAPI = mockDeep<IBrowserTabAPI>();
    tabAlarmManager = mockDeep<ITabAlarmManager>();
    excludedTabManager = mockDeep<IExcludedTabManager>();

    configurationManager = mockDeep<IConfigurationManager>();
    configurationManager.get.mockReturnValue(
      Promise.resolve(emptyConfiguration),
    );

    openedTabManager = new OpenedTabManager(
      browserRuntimeAPI,
      browserTabAPI,
      browserStorageAPI,
      tabAlarmManager,
      excludedTabManager,
      configurationManager,
    );
  });

  describe("onTabRemoved", () => {
    it("should clear existing timeouts", async () => {
      const tabId: TabId = 1;

      await openedTabManager.onTabRemoved(tabId);

      expect(tabAlarmManager.clearAlarm).toHaveBeenCalledWith(tabId);
    });
  });

  describe("onTabActivated", () => {
    it("should clear timeout for activated tab", async () => {
      const windowId: WindowId = 1;
      const tabId: TabId = 2;

      await openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabAlarmManager.clearAlarm).toHaveBeenCalledWith(tabId);
    });

    it("should plan removal of the previous tab", async () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      await openedTabManager.onTabActivated({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;

      await openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabAlarmManager.setAlarm).toHaveBeenCalledWith(
        initialTabId,
        emptyConfiguration.tabRemovalDelayMin,
      );
    });

    it("should not plan removal of the previous tab if it's pinned", async () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      await openedTabManager.onTabActivated({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;
      excludedTabManager.isExcluded.mockReturnValue(Promise.resolve(true));

      await openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabAlarmManager.setAlarm).not.toHaveBeenCalled();
    });
  });

  describe("onTabCreated", () => {
    it("should plan removal of created tab", async () => {
      const tab = createTestTab();

      await openedTabManager.onTabCreated(tab);

      expect(tabAlarmManager.setAlarm).toHaveBeenCalledWith(
        tab.id,
        expect.any(Number),
      );
    });

    it("should not plan removal of excluded tab", async () => {
      const tab = createTestTab();
      excludedTabManager.isExcluded.mockReturnValue(Promise.resolve(true));

      await openedTabManager.onTabCreated(tab);

      expect(tabAlarmManager.setAlarm).not.toHaveBeenCalled();
    });
  });

  function createTestTab(): Tab & { id: number } {
    return {
      active: false,
      autoDiscardable: false,
      discarded: false,
      groupId: 0,
      highlighted: false,
      id: 1,
      incognito: false,
      index: 0,
      pinned: false,
      selected: false,
      windowId: 0,
    };
  }
});
