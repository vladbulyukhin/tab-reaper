import { IConfigurationManager } from '../../src/managers/IConfigurationManager';
import { IBrowserStorageAPI } from '../../src/api/IBrowserStorageAPI';
import { ConfigurationManager } from '../../src/managers/ConfigurationManager';
import { emptyConfiguration, IConfiguration } from '../../src/models/Configuration';

describe('ConfigurationManager', () => {
  let configurationManager: IConfigurationManager;
  let browserStorageAPI: jasmine.SpyObj<IBrowserStorageAPI>;

  beforeEach(() => {
    browserStorageAPI = jasmine.createSpyObj('BrowserStorageAPI', ['get', 'set', 'onChanged']);
    browserStorageAPI.onChanged = jasmine.createSpyObj('BrowserStorageChangedEvent', ['addListener']);
    browserStorageAPI.onChanged.addListener = jasmine.createSpy('addListener');

    configurationManager = new ConfigurationManager(browserStorageAPI);
  });

  describe('get', () => {
    it('should load configuration from storage on the first call', async () => {
      browserStorageAPI.get.and.returnValue(Promise.resolve({ configuration: emptyConfiguration }));

      const result = await configurationManager.get();

      expect(result).toEqual(emptyConfiguration);
      expect(browserStorageAPI.get).toHaveBeenCalled();
    });

    it("shouldn't load configuration from storage on the second and further calls", async () => {
      browserStorageAPI.get.and.returnValue(Promise.resolve({ configuration: emptyConfiguration }));
      await configurationManager.get();
      const result = await configurationManager.get();

      expect(result).toEqual(emptyConfiguration);
      expect(browserStorageAPI.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('save', () => {
    it('should merge passed configuration with existing', async () => {
      // load cache
      browserStorageAPI.get.and.returnValue(Promise.resolve({ configuration: emptyConfiguration }));
      await configurationManager.get();

      const partialConfiguration: Partial<IConfiguration> = { keepGroupedTabs: false };
      await configurationManager.save(partialConfiguration);

      const result = await configurationManager.get();

      expect(result).toEqual({ ...emptyConfiguration, ...partialConfiguration });
      expect(browserStorageAPI.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleConfigurationChanged', async () => {
    it('should update cached configuration when it changes in the storage', async () => {
      browserStorageAPI.get.and.returnValue(Promise.resolve({ configuration: emptyConfiguration }));
      const initial = await configurationManager.get();
      expect(initial.tabRemovalDelayMin).toBe(emptyConfiguration.tabRemovalDelayMin);

      // Trigger the event manually by calling the event listener with the mock changes
      const tabRemovalDelayMin = 60;
      const newConfiguration = { configuration: { newValue: { ...emptyConfiguration, tabRemovalDelayMin } } };
      (browserStorageAPI.onChanged.addListener as jasmine.Spy).calls.mostRecent().args[0](newConfiguration);

      const result = await configurationManager.get();
      expect(result.tabRemovalDelayMin).toBe(tabRemovalDelayMin);
    });

    it('should not update configuration with unrelated changes in storage', async () => {
      browserStorageAPI.get.and.returnValue(Promise.resolve({ configuration: emptyConfiguration }));
      const initial = await configurationManager.get();
      expect(initial.tabRemovalDelayMin).toBe(emptyConfiguration.tabRemovalDelayMin);

      // Trigger the event manually by calling the event listener with the mock changes
      const newConfiguration = { unrelated: { newValue: { unrelated: true } } };
      (browserStorageAPI.onChanged.addListener as jasmine.Spy).calls.mostRecent().args[0](newConfiguration);

      const result = await configurationManager.get();
      expect(result).toEqual(emptyConfiguration);
    });
  });
});
