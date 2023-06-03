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
    it('should set alarm and register a callback', async () => {
      const tabId: TabId = 10;
      const delay = 5;
      const spy = jasmine.createSpy('alarmCallback');

      await tabAlarmManager.setAlarm(tabId, delay, spy);
      expect(browserAlarmAPI.create).toHaveBeenCalledOnceWith(tabId.toString(), { delayInMinutes: delay });

      (browserAlarmAPI.onAlarm.addListener as jasmine.Spy).calls.mostRecent().args[0]({ name: tabId.toString() });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should clear previously set alarm and callback', async () => {
      const tabId: TabId = 10;
      const delay = 5;

      const oldSpy = jasmine.createSpy('oldAlarmCallback');
      await tabAlarmManager.setAlarm(tabId, delay, oldSpy);
      browserAlarmAPI.clear.calls.reset();

      const newSpy = jasmine.createSpy('newAlarmCallback');
      await tabAlarmManager.setAlarm(tabId, delay, newSpy);
      expect(browserAlarmAPI.clear).toHaveBeenCalledWith(tabId.toString());

      (browserAlarmAPI.onAlarm.addListener as jasmine.Spy).calls.mostRecent().args[0]({ name: tabId.toString() });
      expect(oldSpy).toHaveBeenCalledTimes(0);
    });
  });
});
