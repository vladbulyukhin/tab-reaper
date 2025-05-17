import { beforeEach, describe, expect, it } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { IBrowserApiProvider } from "../../../api/IBrowserApiProvider";
import { emptyConfiguration } from "../../../common/models/Configuration";
import type { TabId, WindowId } from "../../../types";
import { CircularQueue } from "../utils/CircularQueue";
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
      Promise.resolve({
        previousActiveTabByWindow: {},
        recentlyRemovedTabs: new CircularQueue(10),
      })
    );

    tabAlarmManager = mockDeep<ITabAlarmManager>();
    excludedTabManager = mockDeep<IExcludedTabManager>();
    extensionActionManager = mockDeep<IExtensionActionManager>();

    configurationManager = mockDeep<IConfigurationManager>();
    configurationManager.get.mockReturnValue(
      Promise.resolve(emptyConfiguration)
    );

    openedTabManager = new OpenedTabManager(
      browserApiProvider,
      tabAlarmManager,
      excludedTabManager,
      configurationManager,
      extensionActionManager
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
        emptyConfiguration.tabRemovalDelayMin
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
        expect.any(Number)
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

  describe("onTabUpdated", () => {
    it("should remove duplicate tabs when feature is enabled", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({
          ...emptyConfiguration,
          keepGroupedTabs: true,
          removeExactDuplicates: true,
        })
      );

      const originalTab = createTestTab();
      originalTab.url = "https://example.com?foo=bar";
      const copyTab = structuredClone(originalTab);

      const groupedCopyTab = createTestTab();
      groupedCopyTab.url = "https://example.com?foo=bar";
      groupedCopyTab.groupId = 1;

      const newTab = createTestTab();
      newTab.url = "https://example.com?foo=bar";

      browserApiProvider.tab.query.mockReturnValue(
        Promise.resolve([originalTab, copyTab, groupedCopyTab])
      );

      browserApiProvider.tab.get.mockReturnValueOnce(
        Promise.resolve(originalTab)
      );

      browserApiProvider.tab.get.mockReturnValueOnce(Promise.resolve(copyTab));
      browserApiProvider.tab.get.mockReturnValueOnce(
        Promise.resolve(groupedCopyTab)
      );

      browserApiProvider.runtime.getLastError.mockReturnValue(undefined);
      excludedTabManager.isExcluded.mockReturnValue(Promise.resolve(false));

      const listener =
        browserApiProvider.tab.onUpdated.addListener.mock.calls[0][0];
      await listener(newTab.id, { url: newTab.url }, newTab);

      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(
        originalTab.id
      );
      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(copyTab.id);

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalledWith(
        groupedCopyTab.id
      );

      expect(
        extensionActionManager.incrementBadgeCounter
      ).toHaveBeenCalledTimes(2);
    });

    it("shouldn't remove duplicate tabs when feature is disabled", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({
          ...emptyConfiguration,
          removeExactDuplicates: false,
        })
      );

      const originalTab = createTestTab();
      originalTab.url = "https://example.com?foo=bar";
      const copyTab = structuredClone(originalTab);

      const newTab = createTestTab();
      newTab.url = "https://example.com?foo=bar";

      browserApiProvider.tab.query.mockReturnValue(
        Promise.resolve([originalTab, copyTab])
      );

      const listener =
        browserApiProvider.tab.onUpdated.addListener.mock.calls[0][0];
      await listener(newTab.id, { url: newTab.url }, newTab);

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });
  });

  function createTestTab(): chrome.tabs.Tab & { id: number } {
    return {
      audible: false,
      active: false,
      autoDiscardable: false,
      discarded: false,
      groupId: -1,
      highlighted: false,
      id: Math.floor(Math.random() * 1000),
      incognito: false,
      index: 0,
      pinned: false,
      selected: false,
      windowId: 0,
    };
  }
});
