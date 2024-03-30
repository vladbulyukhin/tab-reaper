import { beforeEach, describe, expect, it } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { emptyConfiguration } from "../../common/models/Configuration";
import type { TabId, WindowId } from "../../types";
import type { IConfigurationManager } from "./ConfigurationManager";
import type { IExcludedTabManager } from "./ExcludedTabManager";
import type { IExtensionActionManager } from "./ExtensionActionManager";
import { type IOpenedTabManager, OpenedTabManager } from "./OpenedTabManager";
import type { ITabAlarmManager } from "./TabAlarmManager";

describe("OpenedTabManager", () => {
  let openedTabManager: IOpenedTabManager;
  let browserApiProvider: DeepMockProxy<IBrowserApiProvider>;
  let tabAlarmManager: DeepMockProxy<ITabAlarmManager>;
  let excludedTabManager: DeepMockProxy<IExcludedTabManager>;
  let configurationManager: DeepMockProxy<IConfigurationManager>;
  let extensionActionManager: DeepMockProxy<IExtensionActionManager>;

  beforeEach(() => {
    browserApiProvider = mockDeep<IBrowserApiProvider>();
    browserApiProvider.sessionStorage.get.mockReturnValue(
      Promise.resolve({ previousActiveTabByWindow: {} }),
    );

    tabAlarmManager = mockDeep<ITabAlarmManager>();
    excludedTabManager = mockDeep<IExcludedTabManager>();
    extensionActionManager = mockDeep<IExtensionActionManager>();

    configurationManager = mockDeep<IConfigurationManager>();
    configurationManager.get.mockReturnValue(
      Promise.resolve(emptyConfiguration),
    );

    openedTabManager = new OpenedTabManager(
      browserApiProvider,
      tabAlarmManager,
      excludedTabManager,
      configurationManager,
      extensionActionManager,
    );

    openedTabManager.watchTabs();
  });

  describe("onTabRemoved", () => {
    it("should clear existing timeouts", async () => {
      const tabId: TabId = 1;

      const listener =
        browserApiProvider.tab.onRemoved.addListener.mock.calls[0][0];
      await listener(tabId, { windowId: 1, isWindowClosing: false });

      expect(tabAlarmManager.clearAlarm).toHaveBeenCalledWith(tabId);
    });
  });

  describe("onTabActivated", () => {
    it("should clear timeout for activated tab", async () => {
      const windowId: WindowId = 1;
      const tabId: TabId = 2;

      const listener =
        browserApiProvider.tab.onActivated.addListener.mock.calls[0][0];
      await listener({ windowId, tabId });

      expect(tabAlarmManager.clearAlarm).toHaveBeenCalledWith(tabId);
    });

    it("should plan removal of the previous tab", async () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      const listener =
        browserApiProvider.tab.onActivated.addListener.mock.calls[0][0];
      await listener({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;
      await listener({ windowId, tabId });

      expect(tabAlarmManager.setAlarm).toHaveBeenCalledWith(
        initialTabId,
        emptyConfiguration.tabRemovalDelayMin,
      );
    });

    it("should not plan removal of the previous tab if it's pinned", async () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      const listener =
        browserApiProvider.tab.onActivated.addListener.mock.calls[0][0];
      await listener({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;
      excludedTabManager.isExcluded.mockReturnValue(Promise.resolve(true));

      await listener({ windowId, tabId });

      expect(tabAlarmManager.setAlarm).not.toHaveBeenCalled();
    });
  });

  describe("onTabCreated", () => {
    it("should plan removal of created tab", async () => {
      const tab = createTestTab();

      const listener =
        browserApiProvider.tab.onCreated.addListener.mock.calls[0][0];
      await listener(tab);

      expect(tabAlarmManager.setAlarm).toHaveBeenCalledWith(
        tab.id,
        expect.any(Number),
      );
    });

    it("should not plan removal of excluded tab", async () => {
      const tab = createTestTab();
      excludedTabManager.isExcluded.mockReturnValue(Promise.resolve(true));

      const listener =
        browserApiProvider.tab.onCreated.addListener.mock.calls[0][0];
      await listener(tab);

      expect(tabAlarmManager.setAlarm).not.toHaveBeenCalled();
    });
  });

  function createTestTab(): chrome.tabs.Tab & { id: number } {
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
