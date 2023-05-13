import { TabId, WindowId } from '../../src/types';
import { IBrowserTabAPI } from '../../src/api/IBrowserTabAPI';
import { IOpenedTabManager } from '../../src/managers/IOpenedTabManager';
import { IPinnedTabManager } from '../../src/managers/IPinnedTabManager';
import { ITabTimeoutManager } from '../../src/managers/ITabTimeoutManager';
import { OpenedTabManager } from '../../src/managers/OpenedTabManager';
import { IBrowserRuntimeAPI } from '../../src/api/IBrowserRuntimeAPI';

describe('OpenedTabManager', () => {
  let openedTabManager: IOpenedTabManager;
  let browserRuntimeAPI: jasmine.SpyObj<IBrowserRuntimeAPI>;
  let browserTabAPI: jasmine.SpyObj<IBrowserTabAPI>;
  let tabTimeoutManager: jasmine.SpyObj<ITabTimeoutManager>;
  let pinnedTabManager: jasmine.SpyObj<IPinnedTabManager>;

  beforeEach(() => {
    browserRuntimeAPI = jasmine.createSpyObj('BrowserRuntimeAPI', ['lastError']);
    browserTabAPI = jasmine.createSpyObj('BrowserTabAPI', ['get', 'query', 'remove']);
    tabTimeoutManager = jasmine.createSpyObj('TabTimeoutManager', ['setTimeout', 'clearTimeout']);
    pinnedTabManager = jasmine.createSpyObj('PinnedTabManager', ['isPinned', 'pin', 'unpin', 'toggle']);
    openedTabManager = new OpenedTabManager(browserRuntimeAPI, browserTabAPI, tabTimeoutManager, pinnedTabManager);
  });

  describe('onTabRemoved', () => {
    it('should clear existing timeouts', () => {
      const tabId: TabId = 1;

      openedTabManager.onTabRemoved(tabId);

      expect(tabTimeoutManager.clearTimeout).toHaveBeenCalledWith(tabId);
    });
  });

  describe('onTabActivated', () => {
    it('should clear timeout for activated tab', () => {
      const windowId: WindowId = 1;
      const tabId: TabId = 2;

      openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabTimeoutManager.clearTimeout).toHaveBeenCalledWith(tabId);
    });

    it('should plan removal of the previous tab', () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      openedTabManager.onTabActivated({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;

      openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabTimeoutManager.setTimeout).toHaveBeenCalledWith(
        initialTabId,
        jasmine.any(Number),
        jasmine.any(Function)
      );
    });

    it("should not plan removal of the previous tab if it's pinned", () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      openedTabManager.onTabActivated({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;
      pinnedTabManager.isPinned.and.returnValue(true);

      openedTabManager.onTabActivated({ windowId, tabId });

      expect(tabTimeoutManager.setTimeout).not.toHaveBeenCalled();
    });
  });
});
