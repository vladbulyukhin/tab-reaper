import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IBrowserApiProvider,
  IBrowserStorageAPI,
} from "../../api/IBrowserApiProvider";
import {
  type IProtectedSiteManager,
  ProtectedSiteManager,
} from "./ProtectedSiteManager";

const protectedSitesKey = "protectedSites";
const localFallbackAuthorityKey = "protectedSitesLocalFallbackAuthority";

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

const persistedSites = (sites: ReadonlyArray<string>) => JSON.stringify(sites);

const lastStoredSites = (storage: StorageApiDouble) => {
  const set = storage.set as ReturnType<typeof vi.fn>;
  const payload = set.mock.calls.at(-1)?.[0] as
    | Record<string, string>
    | undefined;

  return payload ? JSON.parse(payload[protectedSitesKey]) : undefined;
};

describe("ProtectedSiteManager", () => {
  let protectedSiteManager: IProtectedSiteManager;
  let syncStorage: StorageApiDouble;
  let localStorage: StorageApiDouble;

  const createManager = (
    syncInitial: Record<string, unknown> = {},
    localInitial: Record<string, unknown> = {},
  ) => {
    syncStorage = createStorage(syncInitial);
    localStorage = createStorage(localInitial);
    protectedSiteManager = new ProtectedSiteManager({
      syncStorage,
      localStorage,
    } as Pick<IBrowserApiProvider, "syncStorage" | "localStorage">);
  };

  const recreateManager = () => {
    protectedSiteManager = new ProtectedSiteManager({
      syncStorage,
      localStorage,
    } as Pick<IBrowserApiProvider, "syncStorage" | "localStorage">);
  };

  beforeEach(() => {
    createManager();
  });

  describe("list", () => {
    it("blocks protection checks when neither rules store is readable", async () => {
      syncStorage.get.mockRejectedValue(new Error("sync unavailable"));
      localStorage.get.mockImplementation(async (key) => {
        if ((key as unknown) === localFallbackAuthorityKey) return {} as never;
        throw new Error("local rules unavailable");
      });
      await expect(
        protectedSiteManager.isProtectedUrl("https://example.com"),
      ).rejects.toThrow("local rules unavailable");
      expect(localStorage.set).not.toHaveBeenCalled();
    });

    it("uses the normalized sync value instead of merging divergent local data", async () => {
      createManager(
        {
          [protectedSitesKey]: persistedSites([
            "Beta.com",
            "alpha.com.",
            "alpha.com",
          ]),
        },
        {
          [protectedSitesKey]: persistedSites(["sub.beta.com", "beta.com"]),
        },
      );

      await expect(protectedSiteManager.list()).resolves.toEqual([
        "alpha.com",
        "beta.com",
      ]);
    });

    it("uses a present empty sync list instead of divergent local data", async () => {
      createManager(
        { [protectedSitesKey]: persistedSites([]) },
        { [protectedSitesKey]: persistedSites(["local.test"]) },
      );

      await expect(protectedSiteManager.list()).resolves.toEqual([]);
    });

    it("migrates the local list when the sync key is absent", async () => {
      createManager(
        {},
        { [protectedSitesKey]: persistedSites(["Local.test"]) },
      );

      await expect(protectedSiteManager.list()).resolves.toEqual([
        "local.test",
      ]);
      expect(syncStorage.set).toHaveBeenCalledWith({
        [protectedSitesKey]: persistedSites(["local.test"]),
      });
    });

    it("blocks cleanup without overwriting invalid local protection data", async () => {
      createManager({}, { [protectedSitesKey]: { site: "local.test" } });

      await expect(protectedSiteManager.list()).rejects.toThrow(
        "cleanup is blocked",
      );
      expect(syncStorage.set).not.toHaveBeenCalled();
    });

    it("ignores storage read failures for the storage area that failed", async () => {
      syncStorage.get.mockRejectedValueOnce(new Error("sync unavailable"));
      localStorage.values[protectedSitesKey] = persistedSites(["Local.test"]);

      await expect(protectedSiteManager.list()).resolves.toEqual([
        "local.test",
      ]);
    });

    it.each([
      ["serialized-invalid", "{"],
      ["wrong-shaped", ["example.com", 1]],
    ])(
      "uses local sites when sync data is %s",
      async (_description, invalidSyncValue) => {
        createManager(
          { [protectedSitesKey]: invalidSyncValue },
          { [protectedSitesKey]: persistedSites(["local.test"]) },
        );

        await expect(protectedSiteManager.list()).resolves.toEqual([
          "local.test",
        ]);
      },
    );

    it("reads raw structured values", async () => {
      createManager({ [protectedSitesKey]: ["Example.com."] });

      await expect(protectedSiteManager.list()).resolves.toEqual([
        "example.com",
      ]);
    });
  });

  describe("add", () => {
    it("normalizes URL and host input before saving to both storage areas", async () => {
      await protectedSiteManager.add(" HTTPS://Example.COM/path?x=1 ");
      await protectedSiteManager.add("Blog.Example.COM.");

      expect(lastStoredSites(syncStorage)).toEqual([
        "blog.example.com",
        "example.com",
      ]);
      expect(lastStoredSites(localStorage)).toEqual([
        "blog.example.com",
        "example.com",
      ]);
    });

    it("updates the storage area that succeeds when the other storage area fails", async () => {
      syncStorage.set.mockRejectedValueOnce(new Error("sync quota exceeded"));

      await expect(
        protectedSiteManager.add("https://Example.com/docs"),
      ).resolves.toBeUndefined();

      expect(syncStorage.set).toHaveBeenCalledWith({
        [protectedSitesKey]: persistedSites(["example.com"]),
      });
      expect(localStorage.set).toHaveBeenCalledWith({
        [protectedSitesKey]: persistedSites(["example.com"]),
      });
    });

    it("keeps locally added sites authoritative after a sync write fails", async () => {
      createManager(
        { [protectedSitesKey]: persistedSites(["existing.example.com"]) },
        { [protectedSitesKey]: persistedSites(["existing.example.com"]) },
      );
      syncStorage.set.mockRejectedValueOnce(new Error("sync quota exceeded"));

      await protectedSiteManager.add("new.example.com");

      await expect(protectedSiteManager.list()).resolves.toEqual([
        "existing.example.com",
        "new.example.com",
      ]);
    });

    it("keeps locally added sites authoritative after a restart when sync write fails", async () => {
      createManager(
        { [protectedSitesKey]: persistedSites(["existing.example.com"]) },
        { [protectedSitesKey]: persistedSites(["existing.example.com"]) },
      );
      syncStorage.set.mockRejectedValueOnce(new Error("sync quota exceeded"));

      await protectedSiteManager.add("new.example.com");
      recreateManager();

      await expect(protectedSiteManager.list()).resolves.toEqual([
        "existing.example.com",
        "new.example.com",
      ]);
    });

    it("rejects an addition when durable local authority cannot advance to the new rule set", async () => {
      const locallyAuthoritativeSites = ["existing.example.com"];
      createManager(
        { [protectedSitesKey]: persistedSites(locallyAuthoritativeSites) },
        {
          [protectedSitesKey]: persistedSites(locallyAuthoritativeSites),
          [localFallbackAuthorityKey]: JSON.stringify(true),
        },
      );
      localStorage.set
        .mockRejectedValueOnce(new Error("authority marker unavailable"))
        .mockRejectedValueOnce(new Error("local unavailable"));

      await expect(protectedSiteManager.add("new.example.com")).rejects.toThrow(
        "local unavailable",
      );

      expect(syncStorage.values[protectedSitesKey]).toBe(
        persistedSites(locallyAuthoritativeSites),
      );
      expect(localStorage.values[protectedSitesKey]).toBe(
        persistedSites(locallyAuthoritativeSites),
      );
      recreateManager();
      await expect(protectedSiteManager.list()).resolves.toEqual(
        locallyAuthoritativeSites,
      );
    });

    it("rejects an addition after sync reads fail while durable local authority is active", async () => {
      const locallyAuthoritativeSites = ["existing.example.com"];
      createManager(
        { [protectedSitesKey]: persistedSites(locallyAuthoritativeSites) },
        {
          [protectedSitesKey]: persistedSites(locallyAuthoritativeSites),
          [localFallbackAuthorityKey]: JSON.stringify(true),
        },
      );
      syncStorage.get.mockRejectedValueOnce(new Error("sync unavailable"));
      localStorage.set.mockRejectedValueOnce(new Error("local unavailable"));

      await expect(protectedSiteManager.add("new.example.com")).rejects.toThrow(
        "local unavailable",
      );

      expect(syncStorage.values[protectedSitesKey]).toBe(
        persistedSites(locallyAuthoritativeSites),
      );
      expect(localStorage.values[protectedSitesKey]).toBe(
        persistedSites(locallyAuthoritativeSites),
      );
      recreateManager();
      await expect(protectedSiteManager.list()).resolves.toEqual(
        locallyAuthoritativeSites,
      );
    });

    it("rejects an addition when durable local authority cannot be read", async () => {
      const locallyAuthoritativeSites = ["existing.example.com"];
      createManager(
        { [protectedSitesKey]: persistedSites(locallyAuthoritativeSites) },
        {
          [protectedSitesKey]: persistedSites(locallyAuthoritativeSites),
          [localFallbackAuthorityKey]: JSON.stringify(true),
        },
      );
      localStorage.get.mockRejectedValueOnce(
        new Error("authority unavailable"),
      );
      localStorage.set.mockRejectedValueOnce(new Error("local unavailable"));

      await expect(protectedSiteManager.add("new.example.com")).rejects.toThrow(
        "authority unavailable",
      );

      expect(syncStorage.values[protectedSitesKey]).toBe(
        persistedSites(locallyAuthoritativeSites),
      );
      expect(localStorage.values[protectedSitesKey]).toBe(
        persistedSites(locallyAuthoritativeSites),
      );
    });

    it("rejects when both storage areas fail to write", async () => {
      syncStorage.set.mockRejectedValueOnce(new Error("sync quota exceeded"));
      localStorage.set.mockRejectedValueOnce(new Error("local unavailable"));

      await expect(protectedSiteManager.add("example.com")).rejects.toThrow(
        "sync quota exceeded",
      );
    });

    it("preserves concurrent additions", async () => {
      await Promise.all([
        protectedSiteManager.add("first.example.com"),
        protectedSiteManager.add("second.example.com"),
      ]);

      await expect(protectedSiteManager.list()).resolves.toEqual([
        "first.example.com",
        "second.example.com",
      ]);
    });
  });

  describe("remove", () => {
    it("normalizes URL and host input before removing from both storage areas", async () => {
      createManager(
        {
          [protectedSitesKey]: persistedSites([
            "blog.example.com",
            "example.com",
          ]),
        },
        {
          [protectedSitesKey]: persistedSites([
            "blog.example.com",
            "example.com",
          ]),
        },
      );

      await protectedSiteManager.remove("https://EXAMPLE.com/path");
      await expect(protectedSiteManager.list()).resolves.toEqual([
        "blog.example.com",
      ]);
      expect(lastStoredSites(syncStorage)).toEqual(["blog.example.com"]);
      expect(lastStoredSites(localStorage)).toEqual(["blog.example.com"]);
    });

    it("updates the storage area that succeeds when the other storage area fails", async () => {
      createManager(
        { [protectedSitesKey]: persistedSites(["example.com", "other.com"]) },
        { [protectedSitesKey]: persistedSites(["example.com", "other.com"]) },
      );
      localStorage.set.mockRejectedValueOnce(new Error("local unavailable"));

      await expect(
        protectedSiteManager.remove("Example.com"),
      ).resolves.toBeUndefined();

      expect(syncStorage.set).toHaveBeenCalledWith({
        [protectedSitesKey]: persistedSites(["other.com"]),
      });
      expect(localStorage.set).toHaveBeenCalledWith({
        [protectedSitesKey]: persistedSites(["other.com"]),
      });
    });

    it("removes the matching parent rule for a protected subdomain", async () => {
      createManager({ [protectedSitesKey]: persistedSites(["example.com"]) });

      await protectedSiteManager.remove("www.example.com");

      expect(lastStoredSites(syncStorage)).toEqual([]);
      expect(lastStoredSites(localStorage)).toEqual([]);
    });

    it("preserves concurrent removals", async () => {
      createManager({
        [protectedSitesKey]: persistedSites([
          "first.example.com",
          "second.example.com",
        ]),
      });

      await Promise.all([
        protectedSiteManager.remove("first.example.com"),
        protectedSiteManager.remove("second.example.com"),
      ]);

      await expect(protectedSiteManager.list()).resolves.toEqual([]);
    });
  });

  describe("getMatchingRule", () => {
    it("returns the most-specific stored rule for URL and hostname input", async () => {
      createManager({
        [protectedSitesKey]: persistedSites([
          "example.com",
          "blog.example.com",
        ]),
      });

      const manager = protectedSiteManager as unknown as {
        getMatchingRule(hostnameOrUrl: string): Promise<string | null>;
      };

      await expect(
        manager.getMatchingRule("HTTPS://WWW.BLOG.EXAMPLE.COM./post"),
      ).resolves.toBe("blog.example.com");
      await expect(manager.getMatchingRule("EXAMPLE.COM.")).resolves.toBe(
        "example.com",
      );
      await expect(manager.getMatchingRule("notexample.com")).resolves.toBe(
        null,
      );
    });
  });

  describe("isProtectedUrl", () => {
    it("matches exact hostnames and subdomains only", async () => {
      createManager({ [protectedSitesKey]: persistedSites(["example.com"]) });

      await expect(
        protectedSiteManager.isProtectedUrl("https://example.com/page"),
      ).resolves.toBe(true);
      await expect(
        protectedSiteManager.isProtectedUrl("https://app.example.com/page"),
      ).resolves.toBe(true);
      await expect(
        protectedSiteManager.isProtectedUrl("https://notexample.com/page"),
      ).resolves.toBe(false);
      await expect(
        protectedSiteManager.isProtectedUrl("not a url"),
      ).resolves.toBe(false);
      await expect(
        protectedSiteManager.isProtectedUrl(undefined),
      ).resolves.toBe(false);
    });
  });
});
