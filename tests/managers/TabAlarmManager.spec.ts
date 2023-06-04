import { ITabAlarmManager } from '../../src/managers/ITabAlarmManager';
import { IBrowserAlarmAPI } from '../../src/api/IBrowserAlarmAPI';
import { TabAlarmManager } from '../../src/managers/TabAlarmManager';
import { TabId } from '../../src/types';

describe('TabAlarmManager', () => {
  let tabAlarmManager: ITabAlarmManager;
  let browserAlarmAPI: jasmine.SpyObj<IBrowserAlarmAPI>;

  beforeEach(() => {
    browserAlarmAPI = jasmine.createSpyObj('BrowserAlarmAPI', ['create', 'clear', 'onAlarm']);
    browserAlarmAPI.onAlarm = jasmine.createSpyObj('BrowserAlarmEvent', ['addListener']);
    browserAlarmAPI.onAlarm.addListener = jasmine.createSpy('addListener');

    tabAlarmManager = new TabAlarmManager(browserAlarmAPI);
  });

  describe('setAlarm', () => {
    it('should set alarm', async () => {
      const tabId: TabId = 10;
      const delay = 5;

      await tabAlarmManager.setAlarm(tabId, delay);
      expect(browserAlarmAPI.create).toHaveBeenCalledOnceWith(`tab:${tabId}`, { delayInMinutes: delay });
    });

    it('should clear previously set alarm', async () => {
      const tabId: TabId = 10;
      const delay = 5;

      await tabAlarmManager.setAlarm(tabId, delay);
      browserAlarmAPI.clear.calls.reset();

      await tabAlarmManager.setAlarm(tabId, delay);
      expect(browserAlarmAPI.clear).toHaveBeenCalledWith(`tab:${tabId}`);
    });
  });

  describe('onAlarm', () => {
    it('should add alarm listener', async () => {
      const tabId: TabId = 10;
      const spy = jasmine.createSpy('alarmCallback');

      await tabAlarmManager.onAlarm(spy);

      (browserAlarmAPI.onAlarm.addListener as jasmine.Spy).calls.mostRecent().args[0]({ name: `tab:${tabId}` });
      expect(spy).toHaveBeenCalledOnceWith(tabId);
    });
  });
});
