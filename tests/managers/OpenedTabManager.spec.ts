import { Tab, TabId, WindowId } from '../../src/types';
import { IBrowserTabAPI } from '../../src/api/IBrowserTabAPI';
import { IOpenedTabManager } from '../../src/managers/IOpenedTabManager';
import { IExcludedTabManager } from '../../src/managers/IExcludedTabManager';
import { OpenedTabManager } from '../../src/managers/OpenedTabManager';
import { IBrowserRuntimeAPI } from '../../src/api/IBrowserRuntimeAPI';
import { IConfigurationManager } from '../../src/managers/IConfigurationManager';
import { ITabAlarmManager } from '../../src/managers/ITabAlarmManager';

describe('OpenedTabManager', () => {
  let openedTabManager: IOpenedTabManager;
  let browserRuntimeAPI: jasmine.SpyObj<IBrowserRuntimeAPI>;
  let browserTabAPI: jasmine.SpyObj<IBrowserTabAPI>;
  let tabAlarmManager: jasmine.SpyObj<ITabAlarmManager>;
  let excludedTabManager: jasmine.SpyObj<IExcludedTabManager>;
  let configurationManager: jasmine.SpyObj<IConfigurationManager>;

  beforeEach(() => {
    browserRuntimeAPI = jasmine.createSpyObj('BrowserRuntimeAPI', ['lastError']);
    browserTabAPI = jasmine.createSpyObj('BrowserTabAPI', ['get', 'query', 'remove']);
    tabAlarmManager = jasmine.createSpyObj('TabAlarmManager', ['setAlarm', 'clearAlarm']);
    excludedTabManager = jasmine.createSpyObj('ExcludedTabManager', ['isExcluded', 'exclude', 'include', 'toggle']);
    configurationManager = jasmine.createSpyObj('ConfigurationManager', ['get', 'save']);
    openedTabManager = new OpenedTabManager(browserRuntimeAPI, browserTabAPI, tabAlarmManager, excludedTabManager, configurationManager);
  });

  describe('onTabRemoved', () => {
    it('should clear existing timeouts', () => {
      const tabId: TabId = 1;

      openedTabManager.onTabRemoved(tabId);

      expect(tabAlarmManager.clearAlarm).toHaveBeenCalledWith(tabId);
    });
  });

  describe('onTabActivated', () => {
    it('should clear timeout for activated tab', () => {
      const windowId: WindowId = 1;
      const tabId: TabId = 2;

      openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabAlarmManager.clearAlarm).toHaveBeenCalledWith(tabId);
    });

    it('should plan removal of the previous tab', () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      openedTabManager.onTabActivated({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;

      openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabAlarmManager.setAlarm).toHaveBeenCalledWith(initialTabId, jasmine.any(Number), jasmine.any(Function));
    });

    it("should not plan removal of the previous tab if it's pinned", () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      openedTabManager.onTabActivated({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;
      excludedTabManager.isExcluded.and.returnValue(true);

      openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabAlarmManager.setAlarm).not.toHaveBeenCalled();
    });
  });

  describe('onTabCreated', () => {
    it('should plan removal of created tab', () => {
      const tab = createTestTab();

      openedTabManager.onTabCreated(tab);

      expect(tabAlarmManager.setAlarm).toHaveBeenCalledWith(tab.id, jasmine.any(Number), jasmine.any(Function));
    });

    it('should not plan removal of excluded tab', () => {
      const tab = createTestTab();
      excludedTabManager.isExcluded.and.returnValue(true);

      openedTabManager.onTabCreated(tab);

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
