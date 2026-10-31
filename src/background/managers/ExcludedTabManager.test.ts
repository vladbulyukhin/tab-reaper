import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import type { TabId } from "../../types";
import {
  ExcludedTabManager,
  type IExcludedTabManager,
} from "./ExcludedTabManager";
import type { IExtensionActionManager } from "./ExtensionActionManager";
import { IdleTabLedger } from "./IdleTabLedger";

describe("ExcludedTabManager", () => {
  const now = new Date("2026-06-18T10:00:00.000Z");

  let browserApiProvider: Pick<IBrowserApiProvider, "localStorage" | "tab">;
  let extensionIconService: DeepMockProxy<IExtensionActionManager>;
  let storage: Record<string, unknown>;
  let excludedTabManager: IExcludedTabManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    storage = {};
    browserApiProvider = {
      localStorage: {
        clear: vi.fn(async () => {
          storage = {};
        }),
        get: vi.fn(async (defaults?: Record<string, unknown>) => ({
          ...(defaults ?? {}),
          ...storage,
        })) as IBrowserApiProvider["localStorage"]["get"],
        onChanged: {
          addListener: vi.fn(),
          hasListener: vi.fn(),
          hasListeners: vi.fn(),
          removeListener: vi.fn(),
        } as unknown as chrome.storage.StorageChangedEvent,
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storage[key];
          }
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          storage = { ...storage, ...items };
        }) as IBrowserApiProvider["localStorage"]["set"],
      },
      tab: {
        create: vi.fn(),
        get: vi.fn(async () => ({
          id: 42,
          active: false,
          autoDiscardable: true,
          discarded: false,
          highlighted: false,
          incognito: false,
          index: 0,
          pinned: false,
          selected: false,
          url: "https://example.com/article",
          windowId: 1,
        })) as unknown as IBrowserApiProvider["tab"]["get"],
        onActivated: {
          addListener: vi.fn(),
          hasListener: vi.fn(),
          hasListeners: vi.fn(),
          removeListener: vi.fn(),
        } as unknown as chrome.tabs.TabActivatedEvent,
        onCreated: {
          addListener: vi.fn(),
          hasListener: vi.fn(),
          hasListeners: vi.fn(),
          removeListener: vi.fn(),
        } as unknown as chrome.tabs.TabCreatedEvent,
        onUpdated: {
          addListener: vi.fn(),
          hasListener: vi.fn(),
          hasListeners: vi.fn(),
          removeListener: vi.fn(),
        } as unknown as chrome.tabs.TabUpdatedEvent,
        onRemoved: {
          addListener: vi.fn(),
          hasListener: vi.fn(),
          hasListeners: vi.fn(),
          removeListener: vi.fn(),
        } as unknown as chrome.tabs.TabRemovedEvent,
        query: vi.fn(),
        remove: vi.fn(),
        sendMessage: vi.fn(),
      },
    };
    extensionIconService = mockDeep<IExtensionActionManager>();

    excludedTabManager = new ExcludedTabManager(
      browserApiProvider,
      extensionIconService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const persistedExcludedTabs = () =>
    JSON.parse(storage.excludedTabs as string) as Record<
      string,
      { url: string | null; excludedAt: string }
    >;

  const createDeferred = <T>() => {
    let resolve: ((value: T) => void) | undefined;
    let reject: ((error: unknown) => void) | undefined;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return {
      promise,
      resolve: (value: T) => resolve?.(value),
      reject: (error: unknown) => reject?.(error),
    };
  };

  it("persists excluded tabs in local storage with tab URL metadata", async () => {
    const tabId: TabId = 42;

    await excludedTabManager.exclude(tabId);

    expect(browserApiProvider.tab.get).toHaveBeenCalledWith(tabId);
    expect(persistedExcludedTabs()).toEqual({
      [String(tabId)]: {
        url: "https://example.com/article",
        excludedAt: now.toISOString(),
      },
    });
    await expect(
      excludedTabManager.isExcluded(tabId, "https://example.com/article"),
    ).resolves.toBe(true);
  });

  it("distinguishes an uncertain safety hold from explicit Keep and permits clearing it", async () => {
    const original = await browserApiProvider.tab.get(42);
    const other = { ...original, id: 43, windowId: 2 };
    await excludedTabManager.exclude(42);
    await excludedTabManager.reconcileOpenTabs([other]);
    await expect(
      excludedTabManager.getKeepState(43, other.url),
    ).resolves.toEqual({ kept: false, uncertain: true });
    await excludedTabManager.include(43);
    await expect(
      excludedTabManager.getKeepState(43, other.url),
    ).resolves.toEqual({ kept: false, uncertain: false });
    await expect(excludedTabManager.isExcluded(42, original.url)).resolves.toBe(
      true,
    );
  });

  it("keeps the fetched tab in reconciliation when a Keep write query omits it", async () => {
    browserApiProvider.tab.query = vi.fn(async () => [
      { id: 99, index: 0, url: "https://other.example/", windowId: 1 },
    ]) as unknown as IBrowserApiProvider["tab"]["query"];

    await excludedTabManager.exclude(42);

    await expect(
      excludedTabManager.isExcluded(42, "https://example.com/article"),
    ).resolves.toBe(true);
  });

  it("releases a stale safety hold when its kept source is confirmed missing", async () => {
    await excludedTabManager.exclude(42);
    const replacement = {
      id: 84,
      index: 0,
      url: "https://example.com/article",
      windowId: 1,
    } as chrome.tabs.Tab;
    // The close event was missed, but the browser can confirm the old ID is gone.
    browserApiProvider.tab.get = vi.fn(async (id) => {
      if (id === 42) throw new Error("No tab with id: 42");
      return replacement;
    }) as IBrowserApiProvider["tab"]["get"];
    await excludedTabManager.reconcileOpenTabs([replacement]);
    expect(await excludedTabManager.getKeepState(84, replacement.url)).toEqual({
      kept: false,
      uncertain: false,
    });
  });

  it("checks the source when reading a hold, without needing a browser restart", async () => {
    await excludedTabManager.exclude(42);
    const ledger = new IdleTabLedger(browserApiProvider.localStorage);
    const replacement = {
      id: 84,
      index: 0,
      url: "https://example.com/article",
      windowId: 1,
    } as chrome.tabs.Tab;
    await ledger.reconcile([replacement]);
    browserApiProvider.tab.get = vi.fn(async () => {
      throw new Error("No tab with id: 42");
    }) as IBrowserApiProvider["tab"]["get"];
    expect(await excludedTabManager.getKeepState(84, replacement.url)).toEqual({
      kept: false,
      uncertain: false,
    });
  });

  it("preserves Keep and its safety hold during inconclusive browser API failures", async () => {
    await excludedTabManager.exclude(42);
    const replacement = {
      id: 84,
      index: 0,
      url: "https://example.com/article",
      windowId: 1,
    } as chrome.tabs.Tab;
    const ledger = new IdleTabLedger(browserApiProvider.localStorage);
    await ledger.reconcile([replacement]);
    browserApiProvider.tab.get = vi.fn(async () => {
      throw new Error("Safari is temporarily unavailable");
    }) as IBrowserApiProvider["tab"]["get"];
    await excludedTabManager.reconcileOpenTabs([replacement]);
    expect(await excludedTabManager.getKeepState(84, replacement.url)).toEqual({
      kept: false,
      uncertain: true,
    });
    expect(await excludedTabManager.isExcluded(42)).toBe(true);
  });

  it("disables the icon for a restored kept record with a new tab ID", async () => {
    const ledger = new IdleTabLedger(browserApiProvider.localStorage);
    const original = {
      id: 42,
      index: 0,
      url: "https://kept.example/",
      windowId: 1,
    } as chrome.tabs.Tab;
    const restored = {
      ...original,
      id: 84,
      windowId: 2,
    } as chrome.tabs.Tab;
    const manager = new ExcludedTabManager(
      browserApiProvider,
      extensionIconService,
      ledger,
    );

    await ledger.reconcile([original]);
    await ledger.setKept(42, true);
    await manager.reconcileOpenTabs([restored]);

    expect(extensionIconService.disableExtensionIcon).toHaveBeenCalledWith(84);
  });

  it("disables the icon on exclude and enables it on include", async () => {
    const tabId: TabId = 42;

    await excludedTabManager.exclude(tabId);
    await excludedTabManager.include(tabId);

    expect(extensionIconService.disableExtensionIcon).toHaveBeenCalledWith(
      tabId,
    );
    expect(extensionIconService.enableExtensionIcon).toHaveBeenCalledWith(
      tabId,
    );
    expect(persistedExcludedTabs()).toEqual({});
  });

  it("retains an exclusion when enabling its icon during include fails", async () => {
    storage.excludedTabs = JSON.stringify({
      "42": {
        url: "https://example.com/article",
        excludedAt: now.toISOString(),
      },
    });
    extensionIconService.enableExtensionIcon.mockRejectedValue(
      new Error("action unavailable"),
    );

    await expect(excludedTabManager.include(42)).rejects.toThrow(
      "action unavailable",
    );

    expect(persistedExcludedTabs()).toHaveProperty("42");
  });

  it("does not trust old TabId-only keep state after restart", async () => {
    storage.excludedTabs = JSON.stringify([7, 9]);

    await expect(excludedTabManager.isExcluded(7)).resolves.toBe(false);

    expect(persistedExcludedTabs()).toEqual({
      "9": { url: null, excludedAt: new Date(0).toISOString() },
    });
  });

  it("forgets an exclusion when a reused tab ID has a different URL", async () => {
    storage.excludedTabs = JSON.stringify({
      "42": {
        url: "https://old.example.com/",
        excludedAt: now.toISOString(),
      },
    });

    await expect(
      excludedTabManager.isExcluded(42, "https://new.example.com/"),
    ).resolves.toBe(false);

    expect(persistedExcludedTabs()).toEqual({});
  });

  it("does not protect an internal browser page after its tab ID is reused", async () => {
    const tabId: TabId = 42;
    browserApiProvider.tab.get = vi.fn(async () => ({
      id: tabId,
      url: "chrome://newtab/",
    })) as unknown as IBrowserApiProvider["tab"]["get"];

    await excludedTabManager.exclude(tabId);

    await expect(
      excludedTabManager.isExcluded(tabId, "chrome://settings/"),
    ).resolves.toBe(false);
    expect(extensionIconService.enableExtensionIcon).toHaveBeenCalledWith(
      tabId,
    );
  });

  it("forgets a removed tab without changing its icon", async () => {
    storage.excludedTabs = JSON.stringify({
      "42": {
        url: "https://example.com/article",
        excludedAt: now.toISOString(),
      },
    });

    await excludedTabManager.forget(42);

    expect(persistedExcludedTabs()).toEqual({});
    expect(extensionIconService.enableExtensionIcon).not.toHaveBeenCalled();
    expect(extensionIconService.disableExtensionIcon).not.toHaveBeenCalled();
  });

  it("forgets a reused tab ID found in the open-tab query", async () => {
    storage.excludedTabs = JSON.stringify({
      "42": {
        url: "https://example.com/article",
        excludedAt: now.toISOString(),
      },
    });

    await excludedTabManager.reconcileOpenTabs([
      { id: 42, url: "https://example.com/redirected" } as chrome.tabs.Tab,
    ]);

    expect(persistedExcludedTabs()).toEqual({});
    expect(extensionIconService.enableExtensionIcon).toHaveBeenCalledWith(42);
  });

  it("retains an exclusion when tabs.query omits a tab that tabs.get finds", async () => {
    storage.excludedTabs = JSON.stringify({
      "42": {
        url: "https://example.com/article",
        excludedAt: now.toISOString(),
      },
    });

    await excludedTabManager.reconcileOpenTabs([]);

    expect(browserApiProvider.tab.get).toHaveBeenCalledWith(42);
    expect(persistedExcludedTabs()).not.toHaveProperty("42");
    expect(extensionIconService.disableExtensionIcon).not.toHaveBeenCalled();
  });

  it("forgets an exclusion only when both query omission and tabs.get fail", async () => {
    storage.excludedTabs = JSON.stringify({
      "42": {
        url: "https://example.com/article",
        excludedAt: now.toISOString(),
      },
    });
    browserApiProvider.tab.get = vi.fn(async () => {
      throw new Error("No tab with id: 42");
    }) as unknown as IBrowserApiProvider["tab"]["get"];

    await excludedTabManager.reconcileOpenTabs([]);

    expect(persistedExcludedTabs()).toEqual({});
    expect(extensionIconService.disableExtensionIcon).not.toHaveBeenCalled();
  });

  it("keeps a newer exclusion when an earlier reconciliation lookup rejects", async () => {
    storage.excludedTabs = JSON.stringify({
      "42": {
        url: "https://example.com/old",
        excludedAt: now.toISOString(),
      },
    });
    const lookup = createDeferred<chrome.tabs.Tab>();
    browserApiProvider.tab.get = vi
      .fn()
      .mockReturnValueOnce(lookup.promise)
      .mockResolvedValueOnce({
        id: 42,
        url: "https://example.com/new",
      }) as IBrowserApiProvider["tab"]["get"];

    const reconciliation = excludedTabManager.reconcileOpenTabs([]);
    await vi.waitFor(() => {
      expect(browserApiProvider.tab.get).toHaveBeenCalledTimes(1);
    });
    const exclusion = excludedTabManager.exclude(42);
    lookup.reject(new Error("No tab with id: 42"));

    await Promise.all([reconciliation, exclusion]);

    expect(persistedExcludedTabs()).toMatchObject({
      "42": {
        url: "https://example.com/new",
      },
    });
  });

  it("retains an exclusion when tabs.get fulfills with undefined", async () => {
    storage.excludedTabs = JSON.stringify({
      "42": {
        url: "https://example.com/article",
        excludedAt: now.toISOString(),
      },
    });
    browserApiProvider.tab.get = vi.fn(
      async () => undefined,
    ) as unknown as IBrowserApiProvider["tab"]["get"];

    await excludedTabManager.reconcileOpenTabs([]);

    expect(persistedExcludedTabs()).toHaveProperty("42");
  });

  it("retains an exclusion when tabs.get fulfills with null", async () => {
    storage.excludedTabs = JSON.stringify({
      "42": {
        url: "https://example.com/article",
        excludedAt: now.toISOString(),
      },
    });
    browserApiProvider.tab.get = vi.fn(
      async () => null,
    ) as unknown as IBrowserApiProvider["tab"]["get"];

    await excludedTabManager.reconcileOpenTabs([]);

    expect(persistedExcludedTabs()).toHaveProperty("42");
  });
});
