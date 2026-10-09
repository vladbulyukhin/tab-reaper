import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IBrowserApiProvider,
  IBrowserStorageAPI,
} from "../../api/IBrowserApiProvider";
import {
  type IConfiguration,
  emptyConfiguration,
} from "../../common/models/Configuration";
import {
  ConfigurationManager,
  type IConfigurationManager,
} from "./ConfigurationManager";

const configurationKey = "configuration";
const localFallbackAuthorityKey = "configurationLocalFallbackAuthority";

type StorageApiDouble = IBrowserStorageAPI & {
  values: Record<string, unknown>;
  get: ReturnType<typeof vi.fn> & IBrowserStorageAPI["get"];
  set: ReturnType<typeof vi.fn> & IBrowserStorageAPI["set"];
};

const createStorage = (
  initial: Record<string, unknown> = {},
): StorageApiDouble => {
  const storage = {} as StorageApiDouble;
  storage.values = { ...initial };
  storage.clear = vi.fn(async () => {
    storage.values = {};
  });
  storage.get = vi.fn(async (defaults?: Record<string, unknown>) => ({
    ...defaults,
    ...storage.values,
  })) as StorageApiDouble["get"];
  storage.onChanged = {
    addListener: vi.fn(),
    hasListener: vi.fn(),
    hasListeners: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as chrome.storage.StorageChangedEvent;
  storage.remove = vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete storage.values[key];
    }
  });
  storage.set = vi.fn(async (items: Record<string, unknown>) => {
    storage.values = { ...storage.values, ...items };
  }) as StorageApiDouble["set"];

  return storage;
};

const persistedConfiguration = (configuration: Partial<IConfiguration>) =>
  JSON.stringify(configuration);

describe("ConfigurationManager", () => {
  let configurationManager: IConfigurationManager;
  let syncStorage: StorageApiDouble;
  let localStorage: StorageApiDouble;

  const createManager = (
    syncInitial: Record<string, unknown> = {},
    localInitial: Record<string, unknown> = {},
  ) => {
    syncStorage = createStorage(syncInitial);
    localStorage = createStorage(localInitial);
    configurationManager = new ConfigurationManager({
      syncStorage,
      localStorage,
    } as Pick<IBrowserApiProvider, "syncStorage" | "localStorage">);
  };

  const recreateManager = () => {
    configurationManager = new ConfigurationManager({
      syncStorage,
      localStorage,
    } as Pick<IBrowserApiProvider, "syncStorage" | "localStorage">);
  };

  beforeEach(() => {
    createManager();
  });

  describe("get", () => {
    it("keeps diagnostics off for legacy configurations and preserves an explicit opt-in", async () => {
      createManager({
        [configurationKey]: persistedConfiguration({
          keepPinnedTabs: true,
          version: 5,
        }),
      });
      await expect(configurationManager.get()).resolves.toMatchObject({
        diagnosticsEnabled: false,
      });

      createManager({
        [configurationKey]: persistedConfiguration({
          diagnosticsEnabled: true,
          version: 6,
        }),
      });
      await expect(configurationManager.get()).resolves.toMatchObject({
        diagnosticsEnabled: true,
      });
    });

    it("enables recently closed history for configurations saved before the setting existed", async () => {
      createManager({
        [configurationKey]: persistedConfiguration({
          ...emptyConfiguration,
          version: 4,
        }),
      });

      await expect(configurationManager.get()).resolves.toEqual({
        ...emptyConfiguration,
        rememberRecentlyClosedTabs: true,
        version: 4,
      });
    });

    it("uses a present default sync value instead of divergent local data", async () => {
      createManager(
        { [configurationKey]: persistedConfiguration(emptyConfiguration) },
        {
          [configurationKey]: persistedConfiguration({
            ...emptyConfiguration,
            keepGroupedTabs: false,
          }),
        },
      );

      await expect(configurationManager.get()).resolves.toEqual(
        emptyConfiguration,
      );
    });

    it("migrates a valid local value when the sync key is absent", async () => {
      const localConfiguration = {
        ...emptyConfiguration,
        tabRemovalDelayMin: 60,
      };
      createManager(
        {},
        { [configurationKey]: persistedConfiguration(localConfiguration) },
      );

      await expect(configurationManager.get()).resolves.toEqual(
        localConfiguration,
      );
      expect(syncStorage.set).toHaveBeenCalledWith({
        [configurationKey]: persistedConfiguration(localConfiguration),
      });
    });

    it("uses local data when reading sync fails", async () => {
      const localConfiguration = {
        ...emptyConfiguration,
        keepPinnedTabs: false,
      };
      createManager(
        {},
        { [configurationKey]: persistedConfiguration(localConfiguration) },
      );
      syncStorage.get.mockRejectedValueOnce(new Error("sync unavailable"));

      await expect(configurationManager.get()).resolves.toEqual(
        localConfiguration,
      );
    });

    it.each([
      ["serialized-invalid", "{"],
      ["wrong-shaped", { keepPinnedTabs: "never" }],
    ])(
      "uses local data when sync configuration is %s",
      async (_description, invalidSyncValue) => {
        const localConfiguration = {
          ...emptyConfiguration,
          keepPinnedTabs: false,
        };
        createManager(
          { [configurationKey]: invalidSyncValue },
          {
            [configurationKey]: persistedConfiguration(localConfiguration),
          },
        );

        await expect(configurationManager.get()).resolves.toEqual(
          localConfiguration,
        );
      },
    );

    it("rejects when both storage reads fail", async () => {
      syncStorage.get.mockRejectedValueOnce(new Error("sync unavailable"));
      localStorage.get.mockRejectedValue(new Error("local unavailable"));

      await expect(configurationManager.get()).rejects.toThrow(
        "local unavailable",
      );
    });

    it("rejects when sync data is invalid and the fallback cannot be read", async () => {
      createManager({ [configurationKey]: "{" });
      localStorage.get
        .mockResolvedValueOnce({ [localFallbackAuthorityKey]: undefined })
        .mockRejectedValueOnce(new Error("local unavailable"));

      await expect(configurationManager.get()).rejects.toThrow(
        "local unavailable",
      );
    });

    it("falls back to defaults when neither area has a value", async () => {
      await expect(configurationManager.get()).resolves.toEqual(
        emptyConfiguration,
      );
    });

    it("does not migrate invalid local data when the sync key is absent", async () => {
      createManager({}, { [configurationKey]: "{" });

      await expect(configurationManager.get()).resolves.toEqual(
        emptyConfiguration,
      );
      expect(syncStorage.set).not.toHaveBeenCalled();
    });

    it("reads legacy serialized and raw structured values", async () => {
      const syncConfiguration = {
        ...emptyConfiguration,
        tabCountThreshold: 15,
      };
      createManager(
        { [configurationKey]: syncConfiguration },
        { [configurationKey]: persistedConfiguration(emptyConfiguration) },
      );

      await expect(configurationManager.get()).resolves.toEqual(
        syncConfiguration,
      );
    });
  });

  describe("save", () => {
    it("merges a partial update with the canonical current configuration", async () => {
      const current = {
        ...emptyConfiguration,
        keepPinnedTabs: false,
        tabRemovalDelayMin: 60,
      };
      createManager({ [configurationKey]: persistedConfiguration(current) });

      await configurationManager.save({ keepGroupedTabs: false });

      const expected = { ...current, keepGroupedTabs: false };
      await expect(configurationManager.get()).resolves.toEqual(expected);
      expect(syncStorage.set).toHaveBeenLastCalledWith({
        [configurationKey]: persistedConfiguration(expected),
      });
      expect(localStorage.set).toHaveBeenLastCalledWith({
        [configurationKey]: persistedConfiguration(expected),
      });
    });

    it("resolves when one storage write succeeds", async () => {
      syncStorage.set.mockRejectedValueOnce(new Error("sync quota exceeded"));

      await expect(
        configurationManager.save({ keepGroupedTabs: false }),
      ).resolves.toBeUndefined();
      expect(localStorage.set).toHaveBeenCalled();
    });

    it("keeps the locally saved configuration authoritative after a sync write fails", async () => {
      createManager(
        {
          [configurationKey]: persistedConfiguration({
            ...emptyConfiguration,
            keepGroupedTabs: true,
          }),
        },
        {
          [configurationKey]: persistedConfiguration({
            ...emptyConfiguration,
            keepGroupedTabs: true,
          }),
        },
      );
      syncStorage.set.mockRejectedValueOnce(new Error("sync quota exceeded"));

      await configurationManager.save({ keepGroupedTabs: false });

      await expect(configurationManager.get()).resolves.toEqual({
        ...emptyConfiguration,
        keepGroupedTabs: false,
      });
    });

    it("keeps the locally saved configuration authoritative after a restart when sync write fails", async () => {
      createManager(
        {
          [configurationKey]: persistedConfiguration({
            ...emptyConfiguration,
            keepGroupedTabs: true,
          }),
        },
        {
          [configurationKey]: persistedConfiguration({
            ...emptyConfiguration,
            keepGroupedTabs: true,
          }),
        },
      );
      syncStorage.set.mockRejectedValueOnce(new Error("sync quota exceeded"));

      await configurationManager.save({ keepGroupedTabs: false });
      recreateManager();

      await expect(configurationManager.get()).resolves.toEqual({
        ...emptyConfiguration,
        keepGroupedTabs: false,
      });
    });

    it("rejects a save when durable local authority cannot advance to the new configuration", async () => {
      const locallyAuthoritativeConfiguration = {
        ...emptyConfiguration,
        keepGroupedTabs: false,
      };
      createManager(
        {
          [configurationKey]: persistedConfiguration(
            locallyAuthoritativeConfiguration,
          ),
        },
        {
          [configurationKey]: persistedConfiguration(
            locallyAuthoritativeConfiguration,
          ),
          [localFallbackAuthorityKey]: JSON.stringify(true),
        },
      );
      localStorage.set
        .mockRejectedValueOnce(new Error("authority marker unavailable"))
        .mockRejectedValueOnce(new Error("local unavailable"));

      await expect(
        configurationManager.save({ keepPinnedTabs: false }),
      ).rejects.toThrow("local unavailable");

      expect(syncStorage.values[configurationKey]).toBe(
        persistedConfiguration(locallyAuthoritativeConfiguration),
      );
      expect(localStorage.values[configurationKey]).toBe(
        persistedConfiguration(locallyAuthoritativeConfiguration),
      );
      recreateManager();
      await expect(configurationManager.get()).resolves.toEqual(
        locallyAuthoritativeConfiguration,
      );
    });

    it("rejects a save after sync reads fail while durable local authority is active", async () => {
      const locallyAuthoritativeConfiguration = {
        ...emptyConfiguration,
        keepGroupedTabs: false,
      };
      createManager(
        {
          [configurationKey]: persistedConfiguration(
            locallyAuthoritativeConfiguration,
          ),
        },
        {
          [configurationKey]: persistedConfiguration(
            locallyAuthoritativeConfiguration,
          ),
          [localFallbackAuthorityKey]: JSON.stringify(true),
        },
      );
      syncStorage.get.mockRejectedValueOnce(new Error("sync unavailable"));
      localStorage.set.mockRejectedValueOnce(new Error("local unavailable"));

      await expect(
        configurationManager.save({ keepPinnedTabs: false }),
      ).rejects.toThrow("local unavailable");

      expect(syncStorage.values[configurationKey]).toBe(
        persistedConfiguration(locallyAuthoritativeConfiguration),
      );
      expect(localStorage.values[configurationKey]).toBe(
        persistedConfiguration(locallyAuthoritativeConfiguration),
      );
      recreateManager();
      await expect(configurationManager.get()).resolves.toEqual(
        locallyAuthoritativeConfiguration,
      );
    });

    it("rejects a save when durable local authority cannot be read", async () => {
      const locallyAuthoritativeConfiguration = {
        ...emptyConfiguration,
        keepGroupedTabs: false,
      };
      createManager(
        {
          [configurationKey]: persistedConfiguration(
            locallyAuthoritativeConfiguration,
          ),
        },
        {
          [configurationKey]: persistedConfiguration(
            locallyAuthoritativeConfiguration,
          ),
          [localFallbackAuthorityKey]: JSON.stringify(true),
        },
      );
      localStorage.get.mockRejectedValueOnce(
        new Error("authority unavailable"),
      );
      localStorage.set.mockRejectedValueOnce(new Error("local unavailable"));

      await expect(
        configurationManager.save({ keepPinnedTabs: false }),
      ).rejects.toThrow("authority unavailable");

      expect(syncStorage.values[configurationKey]).toBe(
        persistedConfiguration(locallyAuthoritativeConfiguration),
      );
      expect(localStorage.values[configurationKey]).toBe(
        persistedConfiguration(locallyAuthoritativeConfiguration),
      );
    });

    it("rejects when both storage writes fail", async () => {
      syncStorage.set.mockRejectedValueOnce(new Error("sync unavailable"));
      localStorage.set.mockRejectedValueOnce(new Error("local unavailable"));

      await expect(
        configurationManager.save({ keepGroupedTabs: false }),
      ).rejects.toThrow("sync unavailable");
    });

    it("preserves both concurrent partial updates", async () => {
      createManager({
        [configurationKey]: persistedConfiguration(emptyConfiguration),
      });

      await Promise.all([
        configurationManager.save({ keepGroupedTabs: false }),
        configurationManager.save({ keepPinnedTabs: false }),
      ]);

      await expect(configurationManager.get()).resolves.toEqual({
        ...emptyConfiguration,
        keepGroupedTabs: false,
        keepPinnedTabs: false,
      });
    });
  });
});
