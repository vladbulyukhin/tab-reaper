import { Mock, beforeEach, describe, expect, it } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { IBrowserApiProvider } from "../../../api/IBrowserApiProvider";
import {
  type IConfiguration,
  emptyConfiguration,
} from "../../../common/models/Configuration";
import {
  ConfigurationManager,
  type IConfigurationManager,
} from "./ConfigurationManager";

describe("ConfigurationManager", () => {
  let configurationManager: IConfigurationManager;
  let browserApiProvider: DeepMockProxy<IBrowserApiProvider>;

  beforeEach(() => {
    browserApiProvider = mockDeep<IBrowserApiProvider>();
    configurationManager = new ConfigurationManager(browserApiProvider);
  });

  describe("get", () => {
    it("should load configuration from storage on the first call", async () => {
      browserApiProvider.syncStorage.get.mockReturnValue(
        Promise.resolve({ configuration: emptyConfiguration })
      );

      const result = await configurationManager.get();

      expect(result).toEqual(emptyConfiguration);
      expect(browserApiProvider.syncStorage.get).toHaveBeenCalled();
    });

    it("shouldn't load configuration from storage on the second and further calls", async () => {
      browserApiProvider.syncStorage.get.mockReturnValue(
        Promise.resolve({ configuration: emptyConfiguration })
      );

      await configurationManager.get();
      const result = await configurationManager.get();

      expect(result).toEqual(emptyConfiguration);
      expect(browserApiProvider.syncStorage.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("save", () => {
    it("should merge passed configuration with existing", async () => {
      // load cache
      browserApiProvider.syncStorage.get.mockReturnValue(
        Promise.resolve({ configuration: emptyConfiguration })
      );
      await configurationManager.get();

      const partialConfiguration: Partial<IConfiguration> = {
        keepGroupedTabs: false,
      };
      await configurationManager.save(partialConfiguration);

      const result = await configurationManager.get();

      expect(result).toEqual({
        ...emptyConfiguration,
        ...partialConfiguration,
      });
      expect(browserApiProvider.syncStorage.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleConfigurationChanged", async () => {
    it("should update cached configuration when it changes in the storage", async () => {
      browserApiProvider.syncStorage.get.mockReturnValue(
        Promise.resolve({ configuration: emptyConfiguration })
      );
      const initial = await configurationManager.get();
      expect(initial.tabRemovalDelayMin).toBe(
        emptyConfiguration.tabRemovalDelayMin
      );

      // Trigger the event manually by calling the event listener with the mock changes
      const tabRemovalDelayMin = 60;
      const newConfiguration = {
        configuration: {
          newValue: { ...emptyConfiguration, tabRemovalDelayMin },
        },
      };
      (
        browserApiProvider.syncStorage.onChanged.addListener as Mock
      ).mock.calls[0][0](newConfiguration, "session");

      const result = await configurationManager.get();
      expect(result.tabRemovalDelayMin).toBe(tabRemovalDelayMin);
    });

    it("should not update configuration with unrelated changes in storage", async () => {
      browserApiProvider.syncStorage.get.mockReturnValue(
        Promise.resolve({ configuration: emptyConfiguration })
      );
      const initial = await configurationManager.get();
      expect(initial.tabRemovalDelayMin).toBe(
        emptyConfiguration.tabRemovalDelayMin
      );

      // Trigger the event manually by calling the event listener with the mock changes
      const newConfiguration = { unrelated: { newValue: { unrelated: true } } };
      (
        browserApiProvider.syncStorage.onChanged.addListener as Mock
      ).mock.calls[0][0](newConfiguration, "session");

      const result = await configurationManager.get();
      expect(result).toEqual(emptyConfiguration);
    });
  });
});
