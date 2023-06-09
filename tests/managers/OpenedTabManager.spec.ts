import { Tab, TabId, WindowId } from '../../src/types';
import { IBrowserTabAPI } from '../../src/api/IBrowserTabAPI';
import { IOpenedTabManager } from '../../src/managers/IOpenedTabManager';
import { IExcludedTabManager } from '../../src/managers/IExcludedTabManager';
import { OpenedTabManager } from '../../src/managers/OpenedTabManager';
import { IBrowserRuntimeAPI } from '../../src/api/IBrowserRuntimeAPI';
import { IConfigurationManager } from '../../src/managers/IConfigurationManager';
import { ITabAlarmManager } from '../../src/managers/ITabAlarmManager';
import { emptyConfiguration } from '../../src/models/Configuration';
import { IBrowserStorageAPI } from '../../src/api/IBrowserStorageAPI';

describe('OpenedTabManager', () => {
  let openedTabManager: IOpenedTabManager;
  let browserRuntimeAPI: jasmine.SpyObj<IBrowserRuntimeAPI>;
  let browserTabAPI: jasmine.SpyObj<IBrowserTabAPI>;
  let browserStorageAPI: jasmine.SpyObj<IBrowserStorageAPI>;
  let tabAlarmManager: jasmine.SpyObj<ITabAlarmManager>;
  let excludedTabManager: jasmine.SpyObj<IExcludedTabManager>;
  let configurationManager: jasmine.SpyObj<IConfigurationManager>;

  beforeEach(() => {
    browserStorageAPI = createBrowserStorageAPIStub();

    browserRuntimeAPI = jasmine.createSpyObj('BrowserRuntimeAPI', ['lastError']);
    browserTabAPI = jasmine.createSpyObj('BrowserTabAPI', ['get', 'query', 'remove']);
    tabAlarmManager = jasmine.createSpyObj('TabAlarmManager', ['setAlarm', 'clearAlarm', 'onAlarm']);
    excludedTabManager = jasmine.createSpyObj('ExcludedTabManager', ['isExcluded', 'exclude', 'include', 'toggle']);
    configurationManager = jasmine.createSpyObj('ConfigurationManager', ['get', 'save']);
    openedTabManager = new OpenedTabManager(
      browserRuntimeAPI,
      browserTabAPI,
      browserStorageAPI,
      tabAlarmManager,
      excludedTabManager,
      configurationManager
    );

    configurationManager.get.and.returnValue(Promise.resolve(emptyConfiguration));
  });

  describe('onTabRemoved', () => {
    it('should clear existing timeouts', async () => {
      const tabId: TabId = 1;

      await openedTabManager.onTabRemoved(tabId);

      expect(tabAlarmManager.clearAlarm).toHaveBeenCalledWith(tabId);
    });
  });

  describe('onTabActivated', () => {
    it('should clear timeout for activated tab', async () => {
      const windowId: WindowId = 1;
      const tabId: TabId = 2;

      await openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabAlarmManager.clearAlarm).toHaveBeenCalledWith(tabId);
    });

    it('should plan removal of the previous tab', async () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      await openedTabManager.onTabActivated({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;

      await openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabAlarmManager.setAlarm).toHaveBeenCalledWith(initialTabId, emptyConfiguration.tabRemovalDelayMin);
    });

    it("should not plan removal of the previous tab if it's pinned", async () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      await openedTabManager.onTabActivated({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;
      excludedTabManager.isExcluded.and.returnValue(Promise.resolve(true));

      await openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabAlarmManager.setAlarm).not.toHaveBeenCalled();
    });
  });

  describe('onTabCreated', () => {
    it('should plan removal of created tab', async () => {
      const tab = createTestTab();

      await openedTabManager.onTabCreated(tab);

      expect(tabAlarmManager.setAlarm).toHaveBeenCalledWith(tab.id, jasmine.any(Number));
    });

    it('should not plan removal of excluded tab', async () => {
      const tab = createTestTab();
      excludedTabManager.isExcluded.and.returnValue(Promise.resolve(true));

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

  function createBrowserStorageAPIStub(): jasmine.SpyObj<IBrowserStorageAPI> {
    const stub = jasmine.createSpyObj('BrowserStorageAPI', ['onChanged', 'clear', 'get', 'remove', 'set']);
    stub.onChanged = jasmine.createSpyObj('BrowserAlarmEvent', ['addListener']);
    stub.onChanged.addListener = jasmine.createSpy('addListener');
    stub.get.and.returnValue(Promise.resolve({ previousActiveTabByWindow: {} }));

    return stub;
  }
});
