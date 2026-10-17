import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { emptyConfiguration } from "../../common/models/Configuration";
import type { TabId, WindowId } from "../../types";
import { CircularQueue } from "../utils/CircularQueue";
import type { IConfigurationManager } from "./ConfigurationManager";
import {
  ExcludedTabManager,
  type IExcludedTabManager,
} from "./ExcludedTabManager";
import type { IExtensionActionManager } from "./ExtensionActionManager";
import { IdleTabLedger } from "./IdleTabLedger";
import { type IOpenedTabManager, OpenedTabManager } from "./OpenedTabManager";
import type { IProtectedSiteManager } from "./ProtectedSiteManager";
import type { ISnoozeManager } from "./SnoozeManager";
import type { ITabAlarmManager } from "./TabAlarmManager";

describe("OpenedTabManager", () => {
  let openedTabManager: IOpenedTabManager;
  let browserApiProvider: DeepMockProxy<IBrowserApiProvider>;
  let tabAlarmManager: DeepMockProxy<ITabAlarmManager>;
  let excludedTabManager: DeepMockProxy<IExcludedTabManager>;
  let protectedSiteManager: DeepMockProxy<IProtectedSiteManager>;
  let snoozeManager: DeepMockProxy<ISnoozeManager>;
  let configurationManager: DeepMockProxy<IConfigurationManager>;
  let extensionActionManager: DeepMockProxy<IExtensionActionManager>;
  let localValues: Record<string, unknown>;

  const idleRecordId = (tabId: TabId | undefined): string | undefined => {
    const state = localValues.idleTabLedger as
      | { records?: Array<{ id: string; tabId?: TabId }> }
      | undefined;
    return state?.records?.find((record) => record.tabId === tabId)?.id;
  };

  beforeEach(async () => {
    browserApiProvider = mockDeep<IBrowserApiProvider>();
    browserApiProvider.sessionStorageKind = "memory-fallback";
    localValues = {};
    browserApiProvider.localStorage.get.mockImplementation(
      async (defaults?: unknown) =>
        ({
          ...(defaults && typeof defaults === "object" ? defaults : {}),
          ...localValues,
        }) as never,
    );
    const localSet = browserApiProvider.localStorage.set as unknown as {
      mockImplementation(
        implementation: (items: object) => Promise<void>,
      ): void;
    };
    localSet.mockImplementation(async (items) => {
      Object.assign(localValues, items);
    });
    const localRemove = browserApiProvider.localStorage.remove as unknown as {
      mockImplementation(
        implementation: (keys: string | string[]) => Promise<void>,
      ): void;
    };
    localRemove.mockImplementation(async (keys) => {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        delete localValues[key];
      }
    });
    browserApiProvider.sessionStorage.get.mockReturnValue(
      Promise.resolve({
        previousActiveTabByWindow: {},
        recentlyRemovedTabs: new CircularQueue(10),
      }),
    );

    tabAlarmManager = mockDeep<ITabAlarmManager>();
    tabAlarmManager.getAlarms.mockResolvedValue([]);
    excludedTabManager = mockDeep<IExcludedTabManager>();
    protectedSiteManager = mockDeep<IProtectedSiteManager>();
    protectedSiteManager.isProtectedUrl.mockReturnValue(Promise.resolve(false));
    extensionActionManager = mockDeep<IExtensionActionManager>();

    snoozeManager = mockDeep<ISnoozeManager>();
    snoozeManager.isSnoozed.mockReturnValue(Promise.resolve(false));

    configurationManager = mockDeep<IConfigurationManager>();
    configurationManager.get.mockReturnValue(
      Promise.resolve(emptyConfiguration),
    );

    openedTabManager = new OpenedTabManager(
      browserApiProvider,
      tabAlarmManager,
      excludedTabManager,
      protectedSiteManager,
      snoozeManager,
      configurationManager,
      extensionActionManager,
    );

    await openedTabManager.setDiagnosticsEnabled(true);
    openedTabManager.watchTabs();
  });

  const getFirstListener = <T extends (...args: never[]) => unknown>(
    addListener: unknown,
  ): T => {
    const listenerMock = addListener as {
      mock: { calls: [[T], ...Array<[T]>] };
    };
    return listenerMock.mock.calls[0][0];
  };

  it("restores enabled recently closed history from local storage after session restart", async () => {
    const removedAt = "2026-08-18T12:00:00.000Z";
    localValues.recentlyRemovedTabsLocal = JSON.stringify({
      elements: [
        { id: 44, removedAt, reason: "idle", url: "https://example.com" },
      ],
    });

    await expect(openedTabManager.getRecentlyClosed()).resolves.toEqual([
      {
        id: 44,
        removedAt,
        reason: "idle",
        url: "https://example.com",
      },
    ]);
  });

  it("clears both session and locally remembered recently closed history", async () => {
    localValues.recentlyRemovedTabsLocal = JSON.stringify({
      elements: [
        {
          id: 44,
          removedAt: "2026-08-18T12:00:00.000Z",
          reason: "idle",
        },
      ],
    });

    await openedTabManager.clearRecentlyClosed();

    expect(localValues.recentlyRemovedTabsLocal).toBeUndefined();
    await expect(openedTabManager.getRecentlyClosed()).resolves.toEqual([]);
  });

  it("removes locally remembered history when the preference is disabled", async () => {
    localValues.recentlyRemovedTabsLocal = JSON.stringify({
      elements: [
        {
          id: 44,
          removedAt: "2026-08-18T12:00:00.000Z",
          reason: "idle",
        },
      ],
    });
    configurationManager.get.mockResolvedValue({
      ...emptyConfiguration,
      rememberRecentlyClosedTabs: false,
    });

    await openedTabManager.syncRecentlyClosedPersistence();

    expect(localValues.recentlyRemovedTabsLocal).toBeUndefined();
  });

  it("clears and stops recording diagnostics when disabled", async () => {
    await openedTabManager.setDiagnosticsEnabled(true);
    openedTabManager.recordKeepStateDiagnostic("before-disable", {});
    await expect(
      openedTabManager.getCleanupDiagnostics(),
    ).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ event: "before-disable" }),
      ]),
    });

    await openedTabManager.setDiagnosticsEnabled(false);
    openedTabManager.recordKeepStateDiagnostic("after-disable", {});

    await expect(
      openedTabManager.getCleanupDiagnostics(),
    ).resolves.toMatchObject({ events: [] });
    expect(localValues.cleanupDiagnosticsEvents).toBeUndefined();
  });

  const getFirstAlarmListener = (): ((
    recordId: string,
    revision: number,
    scheduledTime: number,
  ) => unknown) => {
    const alarmMock = tabAlarmManager.onIdleAlarm as unknown as {
      mock: {
        calls: [
          [
            (
              recordId: string,
              revision: number,
              scheduledTime: number,
            ) => unknown,
          ],
          ...Array<
            [
              (
                recordId: string,
                revision: number,
                scheduledTime: number,
              ) => unknown,
            ]
          >,
        ];
      };
    };
    return alarmMock.mock.calls[0][0];
  };

  const createIdleRecord = async (
    tab: chrome.tabs.Tab,
    deadline = Date.now() + emptyConfiguration.tabRemovalDelayMin * 60_000,
  ) => {
    const lastAccessed = (tab as chrome.tabs.Tab & { lastAccessed?: unknown })
      .lastAccessed;
    const inactiveSince =
      typeof lastAccessed === "number" &&
      Number.isFinite(lastAccessed) &&
      lastAccessed <= Date.now()
        ? lastAccessed
        : Date.now();
    const recordTab = { ...tab, lastAccessed: inactiveSince };
    return await new IdleTabLedger(
      browserApiProvider.localStorage,
    ).ensureInactive(recordTab, deadline - inactiveSince);
  };

  const fireIdleAlarm = async (tab: chrome.tabs.Tab, deadline?: number) => {
    const record = await createIdleRecord(tab, deadline);
    getFirstAlarmListener()(record.id, record.revision, record.deadline ?? 0);
    return record;
  };

  // Duplicate lookups query every inactive tab and match URLs locally.
  const isDuplicateQuery = (queryInfo?: chrome.tabs.QueryInfo): boolean =>
    queryInfo?.active === false && queryInfo.windowId === undefined;

  const mockTabQuery = (
    implementation: (
      queryInfo: chrome.tabs.QueryInfo,
    ) => Promise<ReadonlyArray<chrome.tabs.Tab>>,
  ): void => {
    const query = browserApiProvider.tab.query as unknown as {
      mockImplementation: (fn: typeof implementation) => void;
    };
    query.mockImplementation(implementation);
  };

  const mockTabGet = (
    implementation: (tabId: number) => Promise<chrome.tabs.Tab>,
  ): void => {
    const get = browserApiProvider.tab.get as unknown as {
      mockImplementation: (fn: typeof implementation) => void;
    };
    get.mockImplementation(implementation);
  };

  const mockTabRemove = (
    implementation: (tabId: number) => Promise<void>,
  ): void => {
    const remove = browserApiProvider.tab.remove as unknown as {
      mockImplementation: (fn: typeof implementation) => void;
    };
    remove.mockImplementation(implementation);
  };

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

  describe("temporary Safari diagnostics", () => {
    it("keeps a rehydrated tab record when Safari emits its created event", async () => {
      const original = {
        ...createTestTab(),
        id: 900,
        url: "https://kept.example/",
        windowId: 36,
      } as chrome.tabs.Tab;
      const restored = {
        ...original,
        active: true,
        id: 901,
        windowId: 39,
      } as chrome.tabs.Tab;
      const ledger = new IdleTabLedger(browserApiProvider.localStorage);

      await ledger.reconcile([original]);
      await ledger.setKept(original.id as TabId, true);
      await ledger.reconcile([restored]);
      mockTabGet(async () => restored);
      mockTabQuery(async () => [restored]);

      await getFirstListener<(tab: chrome.tabs.Tab) => Promise<void>>(
        browserApiProvider.tab.onCreated.addListener,
      )(restored);

      await expect(
        ledger.isProtected(restored.id as TabId, restored.url),
      ).resolves.toBe(true);
    });

    it("reports lastAccessed so iOS tab identity can be compared across restarts", async () => {
      const tab = {
        id: 701,
        windowId: 39,
        index: 2,
        active: false,
        lastAccessed: 1_787_100_000_000,
        url: "https://example.com/path",
      } as chrome.tabs.Tab & { lastAccessed: number };
      mockTabQuery(async () => [tab]);

      const diagnostics = await openedTabManager.getCleanupDiagnostics();

      expect(diagnostics.queries.allTabs).toEqual([
        expect.objectContaining({
          id: 701,
          lastAccessed: 1_787_100_000_000,
          url: "https://example.com/path",
        }),
      ]);
      expect(diagnostics.queries.inactiveTabs).toEqual([
        expect.objectContaining({
          id: 701,
          lastAccessed: 1_787_100_000_000,
        }),
      ]);
    });

    it("reports the durable keep binding for each ledger record", async () => {
      const tab = {
        ...createTestTab(),
        active: false,
        id: 702,
        url: "https://dashboard.example",
      } as chrome.tabs.Tab;
      const ledger = new IdleTabLedger(browserApiProvider.localStorage);
      await ledger.reconcile([tab]);
      await ledger.setKept(702, true);
      const record = await ledger.ensureInactive(tab, 30_000);
      mockTabQuery(async () => [tab]);

      await expect(openedTabManager.getCleanupDiagnostics()).resolves.toEqual(
        expect.objectContaining({
          ledger: {
            records: [
              {
                deadline: record.deadline,
                id: record.id,
                kept: true,
                revision: record.revision,
                tabId: 702,
              },
            ],
          },
        }),
      );
    });

    it("adds Keep protocol events to the cleanup report", async () => {
      openedTabManager.recordKeepStateDiagnostic("keep-state-read", {
        excluded: true,
        tab: { id: 702, url: "https://dashboard.example" },
      });

      await expect(openedTabManager.getCleanupDiagnostics()).resolves.toEqual(
        expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({
              details: {
                excluded: true,
                tab: { id: 702, url: "https://dashboard.example" },
              },
              event: "keep-state-read",
            }),
          ]),
        }),
      );
    });

    it("reports the background instance, session storage mode, and current alarms", async () => {
      tabAlarmManager.getAlarms.mockResolvedValue([
        {
          name: "tab:701:3",
          scheduledTime: 1_700_000_000_000,
          periodInMinutes: 5,
        },
      ]);
      mockTabQuery(async () => []);

      await expect(openedTabManager.getCleanupDiagnostics()).resolves.toEqual(
        expect.objectContaining({
          alarms: [
            {
              name: "tab:701:3",
              periodInMinutes: 5,
              scheduledTime: 1_700_000_000_000,
            },
          ],
          background: {
            instanceId: expect.any(String),
            sessionStorageKind: "memory-fallback",
          },
          events: expect.arrayContaining([
            expect.objectContaining({
              details: expect.objectContaining({
                instanceId: expect.any(String),
                sessionStorageKind: "memory-fallback",
              }),
              event: "background-instance-started",
            }),
          ]),
        }),
      );
    });

    it("records alarm delivery and the exact idle identity mismatch", async () => {
      mockTabQuery(async () => []);

      getFirstAlarmListener()("missing-record", 7, 1_700_000_000_000);

      await vi.waitFor(async () =>
        expect((await openedTabManager.getCleanupDiagnostics()).events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              details: {
                recordId: "missing-record",
                revision: 7,
                scheduledTime: 1_700_000_000_000,
              },
              event: "alarm-fired",
            }),
            expect.objectContaining({
              details: {
                recordId: "missing-record",
                revision: 7,
                scheduledTime: 1_700_000_000_000,
              },
              event: "remove-skipped-idle-identity",
            }),
          ]),
        ),
      );
    });

    it("records the generation of an alarm cleared for an active tab", async () => {
      const tab = {
        ...createTestTab(),
        active: false,
        id: 813,
        windowId: 48,
      };
      const record = await createIdleRecord(tab);
      const scheduledRevision = record.revision;
      const activeTab = { ...tab, active: true };
      mockTabGet(async () => activeTab);
      mockTabQuery(async () => []);

      await getFirstListener<(tab: chrome.tabs.Tab) => Promise<void>>(
        browserApiProvider.tab.onCreated.addListener,
      )(activeTab);

      expect(tabAlarmManager.clearIdleAlarm).toHaveBeenCalledWith(
        record.id,
        scheduledRevision,
      );

      await expect(
        openedTabManager.getCleanupDiagnostics(),
      ).resolves.toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({
            details: {
              recordId: record.id,
              revision: scheduledRevision,
              tabId: tab.id,
            },
            event: "alarm-cleared",
          }),
        ]),
      });
    });

    it("restores event history after the background manager is reconstructed", async () => {
      const values: Record<string, unknown> = {};
      const localStorage = {
        clear: vi.fn(async () => undefined),
        get: vi.fn(async (defaults?: Record<string, unknown>) => ({
          ...defaults,
          ...values,
        })),
        onChanged: {
          addListener: vi.fn(),
          hasListener: vi.fn(),
          hasListeners: vi.fn(),
          removeListener: vi.fn(),
        },
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of typeof keys === "string" ? [keys] : keys) {
            delete values[key];
          }
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(values, items);
        }),
      } as unknown as IBrowserApiProvider["localStorage"];
      Reflect.set(browserApiProvider, "localStorage", localStorage);
      mockTabQuery(async () => []);

      const first = new OpenedTabManager(
        browserApiProvider,
        tabAlarmManager,
        excludedTabManager,
        protectedSiteManager,
        snoozeManager,
        configurationManager,
        extensionActionManager,
      );
      await first.setDiagnosticsEnabled(true);
      await first.getCleanupDiagnostics();
      const second = new OpenedTabManager(
        browserApiProvider,
        tabAlarmManager,
        excludedTabManager,
        protectedSiteManager,
        snoozeManager,
        configurationManager,
        extensionActionManager,
      );
      await second.setDiagnosticsEnabled(true);

      const markers = (await second.getCleanupDiagnostics()).events.filter(
        ({ event }) => event === "background-instance-started",
      );
      expect(markers).toHaveLength(2);
      expect(
        new Set(markers.map(({ details }) => details?.instanceId)).size,
      ).toBe(2);
    });

    it("clears only the recorded diagnostic event history", async () => {
      browserApiProvider.tab.query.mockRejectedValueOnce(
        new Error("Safari query failed"),
      );
      mockTabQuery(async () => []);

      await openedTabManager.getCleanupDiagnostics();
      await expect(openedTabManager.getCleanupDiagnostics()).resolves.toEqual(
        expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({ event: "query-all-tabs-failed" }),
          ]),
        }),
      );

      await openedTabManager.clearCleanupDiagnostics();

      await expect(
        openedTabManager.getCleanupDiagnostics(),
      ).resolves.toMatchObject({
        events: [],
        queries: { allTabs: [], inactiveTabs: [] },
      });
    });

    it("reports the all-tab and inactive-tab queries separately", async () => {
      const active = {
        ...createTestTab(),
        id: 701,
        windowId: 41,
        active: true,
        groupId: 8,
        hidden: false,
      };
      const inactive = {
        ...createTestTab(),
        id: 702,
        windowId: 42,
        active: false,
      };
      mockTabQuery(async (queryInfo) => {
        if (queryInfo?.active === false) return [inactive];
        return [active, inactive];
      });

      await expect(
        openedTabManager.getCleanupDiagnostics(),
      ).resolves.toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({ event: "background-instance-started" }),
        ]),
        queries: {
          allTabs: [
            {
              active: true,
              groupId: 8,
              hidden: false,
              id: 701,
              index: 0,
              url: "https://example.com/",
              windowId: 41,
            },
            {
              active: false,
              id: 702,
              index: 0,
              url: "https://example.com/",
              windowId: 42,
            },
          ],
          inactiveTabs: [
            {
              active: false,
              id: 702,
              index: 0,
              url: "https://example.com/",
              windowId: 42,
            },
          ],
        },
      });
      expect(browserApiProvider.tab.query).toHaveBeenCalledWith({});
      expect(browserApiProvider.tab.query).toHaveBeenCalledWith({
        active: false,
      });
    });

    it("records the window and active state when Safari reports a new tab", async () => {
      const tab = {
        ...createTestTab(),
        id: 703,
        windowId: 42,
        active: true,
        url: "https://example.com/new-tab",
      };
      mockTabGet(async () => tab);
      mockTabQuery(async () => []);

      await getFirstListener<(tab: chrome.tabs.Tab) => Promise<void>>(
        browserApiProvider.tab.onCreated.addListener,
      )(tab);

      await vi.waitFor(async () =>
        expect((await openedTabManager.getCleanupDiagnostics()).events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ event: "schedule-skipped-active" }),
          ]),
        ),
      );
      await expect(
        openedTabManager.getCleanupDiagnostics(),
      ).resolves.toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({
            details: expect.objectContaining({
              active: true,
              id: 703,
              url: "https://example.com",
              windowId: 42,
            }),
            event: "tab-created",
          }),
        ]),
      });
    });

    it("records the global duplicate-query result before applying a removal", async () => {
      const source = {
        ...createTestTab(),
        id: 704,
        windowId: 43,
        active: true,
        url: "https://example.com/duplicate",
      };
      const duplicate = {
        ...createTestTab(),
        id: 705,
        windowId: 44,
        active: false,
        url: source.url,
      };
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [source, duplicate];
        if (queryInfo?.windowId === duplicate.windowId) return [duplicate];
        return [];
      });
      mockTabGet(async (tabId) => {
        if (tabId === duplicate.id) return duplicate;
        throw new Error("not found");
      });

      await getFirstListener<
        (
          tabId: TabId,
          info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: source.url },
        source,
      );

      await expect(
        openedTabManager.getCleanupDiagnostics(),
      ).resolves.toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({
            details: expect.objectContaining({
              candidateIds: [duplicate.id],
              matchCount: 2,
              tabId: source.id,
              url: "https://example.com",
            }),
            event: "duplicate-query-completed",
          }),
          expect.objectContaining({
            details: { reason: "duplicate", tabId: duplicate.id },
            event: "remove-attempt",
          }),
          expect.objectContaining({
            details: { reason: "duplicate", tabId: duplicate.id },
            event: "remove-completed",
          }),
        ]),
      });
    });

    it("does not query the idle threshold while removing a duplicate", async () => {
      const source = {
        ...createTestTab(),
        id: 706,
        windowId: 45,
        active: true,
        url: "https://example.com/duplicate",
      };
      const duplicate = {
        ...createTestTab(),
        id: 707,
        windowId: 46,
        active: false,
        url: source.url,
      };
      const wrongWindowTab = { ...createTestTab(), id: 708, windowId: 47 };
      const duplicateWindowTabs = Array.from({ length: 10 }, (_, index) => ({
        ...createTestTab(),
        id: 709 + index,
        index: index + 1,
        windowId: duplicate.windowId,
      }));
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
        tabCountThreshold: 10,
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [source, duplicate];
        if (queryInfo?.windowId === duplicate.windowId) return [wrongWindowTab];
        if (Object.keys(queryInfo ?? {}).length === 0) {
          return [source, duplicate, ...duplicateWindowTabs, wrongWindowTab];
        }
        return [];
      });
      mockTabGet(async (tabId) => {
        if (tabId === duplicate.id) return duplicate;
        throw new Error("not found");
      });

      await getFirstListener<
        (
          tabId: TabId,
          info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: source.url },
        source,
      );

      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(duplicate.id);
      const diagnostics = await openedTabManager.getCleanupDiagnostics();
      expect(
        diagnostics.events.some(
          ({ event }) => event === "threshold-window-query",
        ),
      ).toBe(false);
    });
  });

  describe("onTabRemoved", () => {
    it("restores keep state when Safari recreates a tab after its window closes", async () => {
      const original = {
        ...createTestTab(),
        active: false,
        id: 81,
        url: "https://kept.example/",
        windowId: 8,
      } as chrome.tabs.Tab;
      const ledger = new IdleTabLedger(browserApiProvider.localStorage);
      await ledger.reconcile([original]);
      await ledger.setKept(original.id as TabId, true);
      Reflect.set(
        openedTabManager,
        "excludedTabManager",
        new ExcludedTabManager(
          browserApiProvider,
          extensionActionManager,
          ledger,
        ),
      );

      const listener = getFirstListener<
        (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => unknown
      >(browserApiProvider.tab.onRemoved.addListener);
      await listener(original.id as TabId, {
        isWindowClosing: true,
        windowId: original.windowId,
      });

      const restored = {
        ...original,
        id: 82,
        windowId: 9,
      } as chrome.tabs.Tab;
      await ledger.reconcile([restored]);

      await expect(
        ledger.isProtected(restored.id as TabId, restored.url),
      ).resolves.toBe(true);
    });

    it("keeps an existing exclusion when a reused tab ID is created", async () => {
      const tabId = 91;
      const exclusions = new Set<TabId>();
      const exclude = excludedTabManager.exclude as unknown as {
        mockImplementation: (fn: (id: TabId) => Promise<void>) => void;
      };
      const isExcluded = excludedTabManager.isExcluded as unknown as {
        mockImplementation: (fn: (id: TabId) => Promise<boolean>) => void;
      };
      exclude.mockImplementation(async (id) => {
        exclusions.add(id);
      });
      isExcluded.mockImplementation(async (id) => exclusions.has(id));
      await excludedTabManager.exclude(tabId);

      const created = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      );
      await created({ ...createTestTab(), id: tabId });

      expect(exclusions.has(tabId)).toBe(true);
      expect(excludedTabManager.forget).not.toHaveBeenCalled();
      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
    });
    it("should clear existing timeouts", async () => {
      const tabId: TabId = 1;
      const record = await createIdleRecord({ ...createTestTab(), id: tabId });

      const listener = getFirstListener<
        (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => unknown
      >(browserApiProvider.tab.onRemoved.addListener);
      await listener(tabId, { windowId: 1, isWindowClosing: false });

      expect(tabAlarmManager.clearIdleAlarm).toHaveBeenCalledWith(
        record.id,
        record.revision,
      );
    });

    it("forgets the removed tab exclusion without updating its icon", async () => {
      const tabId: TabId = 1;

      const listener = getFirstListener<
        (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => unknown
      >(browserApiProvider.tab.onRemoved.addListener);
      await listener(tabId, { windowId: 1, isWindowClosing: false });

      expect(excludedTabManager.forget).toHaveBeenCalledWith(tabId);
    });

    it("forgets an exclusion and reconciles threshold when alarm cleanup rejects", async () => {
      const tabId: TabId = 1;
      await createIdleRecord({ ...createTestTab(), id: tabId });
      tabAlarmManager.clearIdleAlarm.mockRejectedValue(new Error("alarm gone"));
      configurationManager.get.mockReturnValue(
        Promise.resolve({ ...emptyConfiguration, tabCountThreshold: 1 }),
      );

      const listener = getFirstListener<
        (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => unknown
      >(browserApiProvider.tab.onRemoved.addListener);

      await expect(
        listener(tabId, { windowId: 1, isWindowClosing: false }),
      ).resolves.toBeUndefined();

      expect(excludedTabManager.forget).toHaveBeenCalledWith(tabId);
      expect(browserApiProvider.tab.query).toHaveBeenCalledWith({
        active: false,
        windowId: 1,
      });
    });

    it("does not let delayed removal cleanup forget a reused ID", async () => {
      const tabId: TabId = 1;
      const clearAlarm = createDeferred<void>();
      const calls: string[] = [];
      await createIdleRecord({ ...createTestTab(), id: tabId });
      tabAlarmManager.clearIdleAlarm.mockReturnValue(clearAlarm.promise);
      excludedTabManager.forget.mockImplementation(async () => {
        calls.push("forget");
      });
      excludedTabManager.exclude.mockImplementation(async () => {
        calls.push("exclude");
      });

      const removedListener = getFirstListener<
        (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => unknown
      >(browserApiProvider.tab.onRemoved.addListener);
      const createdListener = getFirstListener<
        (tab: chrome.tabs.Tab) => unknown
      >(browserApiProvider.tab.onCreated.addListener);

      const removal = removedListener(tabId, {
        windowId: 1,
        isWindowClosing: false,
      });
      const creation = createdListener({ ...createTestTab(), id: tabId });
      await Promise.resolve();
      expect(calls).toEqual(["forget"]);

      clearAlarm.resolve();
      await removal;
      await creation;
      await excludedTabManager.exclude(tabId);

      expect(calls).toEqual(["forget", "exclude"]);
    });

    it("preserves a replacement exclusion created during old removal cleanup", async () => {
      const tabId: TabId = 92;
      const clearAlarm = createDeferred<void>();
      const exclusions = new Set<TabId>();
      const record = await createIdleRecord({ ...createTestTab(), id: tabId });
      tabAlarmManager.clearIdleAlarm.mockReturnValue(clearAlarm.promise);
      const forget = excludedTabManager.forget as unknown as {
        mockImplementation: (fn: (id: TabId) => Promise<void>) => void;
      };
      const exclude = excludedTabManager.exclude as unknown as {
        mockImplementation: (fn: (id: TabId) => Promise<void>) => void;
      };
      const isExcluded = excludedTabManager.isExcluded as unknown as {
        mockImplementation: (fn: (id: TabId) => Promise<boolean>) => void;
      };
      forget.mockImplementation(async (id) => {
        exclusions.delete(id);
      });
      exclude.mockImplementation(async (id) => {
        exclusions.add(id);
      });
      isExcluded.mockImplementation(async (id) => exclusions.has(id));

      const removal = getFirstListener<
        (id: TabId, info: chrome.tabs.TabRemoveInfo) => unknown
      >(browserApiProvider.tab.onRemoved.addListener)(tabId, {
        windowId: 1,
        isWindowClosing: false,
      });
      await vi.waitFor(() =>
        expect(tabAlarmManager.clearIdleAlarm).toHaveBeenCalledWith(
          record.id,
          record.revision,
        ),
      );

      const creation = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )({ ...createTestTab(), id: tabId });
      await vi.waitFor(() =>
        expect(browserApiProvider.sessionStorage.set).toHaveBeenCalledWith({
          tabGenerations: JSON.stringify({ [tabId]: 1 }),
        }),
      );
      await excludedTabManager.exclude(tabId);

      clearAlarm.resolve();
      await removal;
      await creation;

      expect(exclusions.has(tabId)).toBe(true);
    });

    it("queues owned removal exclusion cleanup before a later user exclusion", async () => {
      const tabId: TabId = 93;
      const generationRead = createDeferred<Record<string, unknown>>();
      const exclusions = new Set<TabId>([tabId]);
      const storageGet = browserApiProvider.sessionStorage.get as unknown as {
        mockImplementation: (
          fn: (
            keys: Record<string, unknown>,
          ) => Promise<Record<string, unknown>>,
        ) => void;
      };
      storageGet.mockImplementation(async (keys) => {
        if ((keys as unknown) === "tabGenerations") {
          return generationRead.promise;
        }
        return {
          previousActiveTabByWindow: {},
          recentlyRemovedTabs: new CircularQueue(10),
        };
      });
      const forget = excludedTabManager.forget as unknown as {
        mockImplementation: (fn: (id: TabId) => Promise<void>) => void;
      };
      const exclude = excludedTabManager.exclude as unknown as {
        mockImplementation: (fn: (id: TabId) => Promise<void>) => void;
      };
      forget.mockImplementation(async (id) => {
        exclusions.delete(id);
      });
      exclude.mockImplementation(async (id) => {
        exclusions.add(id);
      });

      const removal = getFirstListener<
        (id: TabId, info: chrome.tabs.TabRemoveInfo) => unknown
      >(browserApiProvider.tab.onRemoved.addListener)(tabId, {
        windowId: 1,
        isWindowClosing: false,
      });
      await vi.waitFor(() =>
        expect(browserApiProvider.sessionStorage.get).toHaveBeenCalledWith(
          "tabGenerations",
        ),
      );

      await excludedTabManager.exclude(tabId);
      generationRead.resolve({
        tabGenerations: JSON.stringify({ [tabId]: 0 }),
      });
      await removal;

      expect(exclusions.has(tabId)).toBe(true);
    });

    it("ignores a stale removal when the pending replacement still exists", async () => {
      const tabId: TabId = 94;
      const replacement = { ...createTestTab(), id: tabId, windowId: 1 };
      const configuration = createDeferred<typeof emptyConfiguration>();
      configurationManager.get.mockReturnValueOnce(configuration.promise);
      mockTabGet(async () => replacement);

      const creation = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(replacement);
      await vi.waitFor(() =>
        expect(configurationManager.get).toHaveBeenCalledTimes(1),
      );

      await getFirstListener<
        (id: TabId, info: chrome.tabs.TabRemoveInfo) => unknown
      >(browserApiProvider.tab.onRemoved.addListener)(tabId, {
        windowId: replacement.windowId,
        isWindowClosing: false,
      });

      expect(browserApiProvider.tab.get).toHaveBeenCalledWith(tabId);
      expect(excludedTabManager.forget).not.toHaveBeenCalled();
      configuration.resolve(emptyConfiguration);
      await creation;
    });

    it("cleans a genuinely closed pending creation and cancels its duplicate cleanup", async () => {
      const source = {
        ...createTestTab(),
        id: 95,
        windowId: 1,
        url: "https://example.com/quick-close",
      };
      const duplicate = {
        ...createTestTab(),
        id: 96,
        windowId: source.windowId,
        url: source.url,
      };
      const duplicateQuery = createDeferred<ReadonlyArray<chrome.tabs.Tab>>();
      let sourceExists = true;
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      mockTabGet(async (tabId) => {
        if (tabId === source.id && sourceExists) return source;
        if (tabId === duplicate.id) return duplicate;
        throw new Error(`Tab ${tabId} is closed`);
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return duplicateQuery.promise;
        if (queryInfo?.windowId === duplicate.windowId) return [duplicate];
        return [];
      });

      const creation = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(source);
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.query).toHaveBeenCalledWith({
          active: false,
        }),
      );

      sourceExists = false;
      await getFirstListener<
        (id: TabId, info: chrome.tabs.TabRemoveInfo) => unknown
      >(browserApiProvider.tab.onRemoved.addListener)(source.id, {
        windowId: source.windowId,
        isWindowClosing: false,
      });
      duplicateQuery.resolve([source, duplicate]);
      await creation;

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      await expect(
        new IdleTabLedger(browserApiProvider.localStorage).getBoundRecord(
          source.id,
        ),
      ).resolves.toBeNull();
    });

    it("blocks duplicate cleanup while validating a pending quick close", async () => {
      const source = {
        ...createTestTab(),
        id: 97,
        windowId: 1,
        url: "https://example.com/quick-close-barrier",
      };
      const duplicate = {
        ...createTestTab(),
        id: 98,
        windowId: source.windowId,
        url: source.url,
      };
      const removalLookup = createDeferred<chrome.tabs.Tab>();
      const duplicateQuery = createDeferred<ReadonlyArray<chrome.tabs.Tab>>();
      let sourceGetCount = 0;
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      mockTabGet(async (tabId) => {
        if (tabId === source.id) {
          sourceGetCount += 1;
          return sourceGetCount === 1 ? source : removalLookup.promise;
        }
        if (tabId === duplicate.id) return duplicate;
        throw new Error(`Tab ${tabId} is closed`);
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return duplicateQuery.promise;
        if (queryInfo?.windowId === duplicate.windowId) return [duplicate];
        return [];
      });

      const creation = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(source);
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.query).toHaveBeenCalledWith({
          active: false,
        }),
      );

      const removal = getFirstListener<
        (id: TabId, info: chrome.tabs.TabRemoveInfo) => unknown
      >(browserApiProvider.tab.onRemoved.addListener)(source.id, {
        windowId: source.windowId,
        isWindowClosing: false,
      });
      await vi.waitFor(() => expect(sourceGetCount).toBe(2));

      duplicateQuery.resolve([source, duplicate]);
      await creation;

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();

      removalLookup.reject(new Error("source tab is closed"));
      await removal;

      await expect(
        new IdleTabLedger(browserApiProvider.localStorage).getBoundRecord(
          source.id,
        ),
      ).resolves.toBeNull();
    });
  });

  describe("recently closed history", () => {
    it("normalizes legacy reasons and discards malformed stored entries", async () => {
      browserApiProvider.sessionStorage.get.mockResolvedValue({
        previousActiveTabByWindow: {},
        recentlyRemovedTabs: JSON.stringify({
          capacity: 50,
          elements: [
            {
              id: 201,
              url: "https://example.com/legacy",
              title: "Legacy tab",
              removedAt: "2026-07-25T12:00:00.000Z",
            },
            {
              id: 202,
              url: "https://example.com/manual",
              title: "Manual tab",
              removedAt: "2026-07-25T12:01:00.000Z",
              reason: "manual",
            },
            { id: "invalid", removedAt: "not-a-date" },
          ],
        }),
      });

      await expect(openedTabManager.getRecentlyClosed()).resolves.toEqual([
        {
          id: 202,
          url: "https://example.com/manual",
          title: "Manual tab",
          removedAt: "2026-07-25T12:01:00.000Z",
          reason: "manual",
        },
        {
          id: 201,
          url: "https://example.com/legacy",
          title: "Legacy tab",
          removedAt: "2026-07-25T12:00:00.000Z",
          reason: "unknown",
        },
      ]);
    });

    it("falls back to an empty history for a malformed raw storage value", async () => {
      browserApiProvider.sessionStorage.get.mockResolvedValue({
        previousActiveTabByWindow: {},
        recentlyRemovedTabs: { elements: [] },
      });

      await expect(openedTabManager.getRecentlyClosed()).resolves.toEqual([]);
    });
  });

  describe("onTabActivated", () => {
    it("should clear timeout for activated tab", async () => {
      const windowId: WindowId = 1;
      const tabId: TabId = 2;
      const record = await createIdleRecord({
        ...createTestTab(),
        id: tabId,
        windowId,
      });
      const scheduledRevision = record.revision;

      const listener = getFirstListener<
        (activeInfo: chrome.tabs.TabActiveInfo) => unknown
      >(browserApiProvider.tab.onActivated.addListener);
      await listener({ windowId, tabId });

      expect(tabAlarmManager.clearIdleAlarm).toHaveBeenCalledWith(
        record.id,
        scheduledRevision,
      );
    });

    it("should plan removal of the previous tab", async () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;
      mockTabGet(async (tabId) => ({
        ...createTestTab(),
        id: tabId,
        windowId,
      }));

      const listener = getFirstListener<
        (activeInfo: chrome.tabs.TabActiveInfo) => unknown
      >(browserApiProvider.tab.onActivated.addListener);
      await listener({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;
      await listener({ windowId, tabId });

      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
        idleRecordId(initialTabId),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it("should not plan removal of the previous tab if it's pinned", async () => {
      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      const listener = getFirstListener<
        (activeInfo: chrome.tabs.TabActiveInfo) => unknown
      >(browserApiProvider.tab.onActivated.addListener);
      await listener({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;
      excludedTabManager.isExcluded.mockReturnValue(Promise.resolve(true));

      await listener({ windowId, tabId });

      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
    });

    it("should not plan removal when under the tab count threshold", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({ ...emptyConfiguration, tabCountThreshold: 10 }),
      );
      mockTabGet(async (tabId) => ({
        ...createTestTab(),
        id: tabId,
        windowId: 1,
      }));
      mockTabQuery(async (queryInfo) => {
        if (queryInfo?.windowId === 1) {
          return Array.from({ length: 10 }, () => ({}) as chrome.tabs.Tab);
        }
        return [] as chrome.tabs.Tab[];
      });

      const windowId: WindowId = 1;
      const initialTabId: TabId = 2;

      const listener = getFirstListener<
        (activeInfo: chrome.tabs.TabActiveInfo) => unknown
      >(browserApiProvider.tab.onActivated.addListener);
      await listener({ windowId, tabId: initialTabId });

      const tabId: TabId = 3;
      await listener({ windowId, tabId });

      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
      expect(tabAlarmManager.clearIdleAlarm).toHaveBeenCalledWith(
        idleRecordId(initialTabId),
        expect.any(Number),
      );
    });

    it("does not persist stale inactivity state when activation overtakes configuration", async () => {
      const tab = { ...createTestTab(), id: 351, windowId: 3 };
      const configuration = createDeferred<typeof emptyConfiguration>();
      configurationManager.get.mockReturnValueOnce(configuration.promise);

      const creation = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(tab);
      await vi.waitFor(() =>
        expect(configurationManager.get).toHaveBeenCalledTimes(1),
      );

      const activate = getFirstListener<
        (activeInfo: chrome.tabs.TabActiveInfo) => unknown
      >(browserApiProvider.tab.onActivated.addListener);
      await activate({ tabId: tab.id, windowId: tab.windowId });
      configuration.resolve(emptyConfiguration);
      await creation;

      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
      expect(
        (
          await new IdleTabLedger(
            browserApiProvider.localStorage,
          ).getBoundRecord(tab.id)
        )?.deadline,
      ).toBeUndefined();

      mockTabGet(async (tabId) => ({ ...tab, id: tabId, active: false }));
      await activate({ tabId: 352, windowId: tab.windowId });

      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledTimes(1);
      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
        idleRecordId(tab.id),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it("uses fresh active state when a stale inactive snapshot is scheduled after activation", async () => {
      const tab = { ...createTestTab(), id: 353, windowId: 3, active: false };
      const reconcile = createDeferred<void>();
      excludedTabManager.reconcileOpenTabs.mockReturnValue(reconcile.promise);
      browserApiProvider.tab.query.mockResolvedValue([tab]);
      mockTabGet(async () => ({ ...tab, active: true }));

      const startup = getFirstListener<() => unknown>(
        browserApiProvider.runtime.onStartup.addListener,
      )();
      await vi.waitFor(() =>
        expect(excludedTabManager.reconcileOpenTabs).toHaveBeenCalledWith([
          tab,
        ]),
      );
      await getFirstListener<(info: chrome.tabs.TabActiveInfo) => unknown>(
        browserApiProvider.tab.onActivated.addListener,
      )({ tabId: tab.id, windowId: tab.windowId });

      reconcile.resolve();
      await startup;

      expect(browserApiProvider.tab.get).toHaveBeenCalledWith(tab.id);
      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
      expect(
        (
          await new IdleTabLedger(
            browserApiProvider.localStorage,
          ).getBoundRecord(tab.id)
        )?.deadline,
      ).toBeUndefined();
    });

    it("does not let an older schedule clear a newer same-generation alarm", async () => {
      const tab = { ...createTestTab(), id: 354, windowId: 3, active: false };
      const oldConfiguration = createDeferred<typeof emptyConfiguration>();
      let currentTab = tab;
      let currentAlarm: { recordId: string; deadline: number } | null = null;
      configurationManager.get
        .mockReturnValueOnce(oldConfiguration.promise)
        .mockResolvedValue(emptyConfiguration);
      browserApiProvider.tab.query.mockResolvedValue([tab]);
      mockTabGet(async (tabId) => ({ ...currentTab, id: tabId }));
      const clearAlarm = tabAlarmManager.clearIdleAlarm as unknown as {
        mockImplementation: (
          fn: (recordId: string, revision?: number) => Promise<void>,
        ) => void;
      };
      const setAlarmAt = tabAlarmManager.setIdleAlarm as unknown as {
        mockImplementation: (
          fn: (
            recordId: string,
            deadline: number,
            revision: number,
          ) => Promise<void>,
        ) => void;
      };
      clearAlarm.mockImplementation(async (recordId) => {
        if (currentAlarm?.recordId === recordId) currentAlarm = null;
      });
      setAlarmAt.mockImplementation(async (recordId, deadline) => {
        currentAlarm = { recordId, deadline };
      });

      const startup = getFirstListener<() => unknown>(
        browserApiProvider.runtime.onStartup.addListener,
      )();
      await vi.waitFor(() =>
        expect(configurationManager.get).toHaveBeenCalledTimes(1),
      );

      const activate = getFirstListener<
        (info: chrome.tabs.TabActiveInfo) => unknown
      >(browserApiProvider.tab.onActivated.addListener);
      currentTab = { ...tab, active: true };
      await activate({ tabId: tab.id, windowId: tab.windowId });
      currentTab = { ...tab, active: false };
      await activate({ tabId: 355, windowId: tab.windowId });
      expect(currentAlarm).toEqual(
        expect.objectContaining({ recordId: idleRecordId(tab.id) }),
      );

      oldConfiguration.resolve(emptyConfiguration);
      await startup;

      expect(currentAlarm).toEqual(
        expect.objectContaining({ recordId: idleRecordId(tab.id) }),
      );
    });
  });

  describe("onTabCreated", () => {
    it("should plan removal of created tab", async () => {
      const tab = createTestTab();
      mockTabGet(async () => tab);

      const listener = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      );
      await listener(tab);

      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
        idleRecordId(tab.id),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it("checks the durable exclusion without forgetting it on creation", async () => {
      const tab = createTestTab();
      mockTabGet(async () => tab);

      const listener = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      );
      await listener(tab);

      expect(excludedTabManager.forget).not.toHaveBeenCalled();
      expect(excludedTabManager.isExcluded).toHaveBeenCalledWith(
        tab.id,
        tab.url,
      );
    });

    it("should not plan removal of excluded tab", async () => {
      const tab = createTestTab();
      excludedTabManager.isExcluded.mockReturnValue(Promise.resolve(true));

      const listener = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      );
      await listener(tab);

      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
    });
  });

  describe("startup reconciliation", () => {
    it("preserves Keep state for the active tab when Safari recreates its ID", async () => {
      const originalActive = {
        ...createTestTab(),
        active: true,
        id: 201,
        url: "https://kept.example/",
        windowId: 20,
      } as chrome.tabs.Tab;
      const restoredActive = {
        ...originalActive,
        id: 301,
        windowId: 30,
      } as chrome.tabs.Tab;
      const restoredInactive = {
        ...createTestTab(),
        active: false,
        id: 302,
        index: 1,
        url: "https://inactive.example/",
        windowId: 30,
      } as chrome.tabs.Tab;
      const ledger = new IdleTabLedger(browserApiProvider.localStorage);
      let currentTabs = [originalActive];
      mockTabQuery(async () => currentTabs);
      mockTabGet(
        async (tabId) =>
          currentTabs.find((tab) => tab.id === tabId) as chrome.tabs.Tab,
      );
      const realExcludedTabManager = new ExcludedTabManager(
        browserApiProvider,
        extensionActionManager,
        ledger,
      );

      await ledger.reconcile([originalActive]);
      await realExcludedTabManager.exclude(originalActive.id as TabId);

      currentTabs = [restoredActive, restoredInactive];
      const restartedManager = new OpenedTabManager(
        browserApiProvider,
        tabAlarmManager,
        realExcludedTabManager,
        protectedSiteManager,
        snoozeManager,
        configurationManager,
        extensionActionManager,
        ledger,
      );

      await restartedManager.rescheduleOpenTabs();

      await expect(
        realExcludedTabManager.isExcluded(
          restoredActive.id as TabId,
          restoredActive.url,
        ),
      ).resolves.toBe(true);
    });

    it("reconciles exclusions against the tabs returned at startup", async () => {
      const tab = createTestTab();
      browserApiProvider.tab.query.mockReturnValue(Promise.resolve([tab]));

      const listener = getFirstListener<() => unknown>(
        browserApiProvider.runtime.onStartup.addListener,
      );
      await listener();

      expect(excludedTabManager.reconcileOpenTabs).toHaveBeenCalledWith([tab]);
    });
  });

  describe("idle clock while a tab cannot close", () => {
    const delay = emptyConfiguration.tabRemovalDelayMin * 60_000;
    const start = 1_700_000_000_000;
    let now = start;

    beforeEach(() => {
      now = start;
      vi.spyOn(Date, "now").mockImplementation(() => now);
    });

    afterEach(() => {
      vi.mocked(Date.now).mockRestore();
    });

    const idleTab = (overrides: Partial<chrome.tabs.Tab> = {}) =>
      ({
        ...createTestTab(),
        id: 640,
        windowId: 1,
        lastAccessed: start - 2 * delay,
        ...overrides,
      }) as chrome.tabs.Tab & { id: number; lastAccessed: number };

    const serveTabs = (getTab: () => chrome.tabs.Tab) => {
      mockTabGet(async () => getTab());
      mockTabQuery(async () => [getTab()]);
    };

    const fireUpdate = (tabId: TabId, changeInfo: chrome.tabs.TabChangeInfo) =>
      getFirstListener<
        (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(tabId, changeInfo);

    const lastAlarmDeadline = () =>
      vi.mocked(tabAlarmManager.setIdleAlarm).mock.calls.at(-1)?.[1];

    it("starts a fresh delay when a background tab stops playing audio", async () => {
      let tab = idleTab();
      serveTabs(() => tab);
      await createIdleRecord(tab, start + 60_000);

      tab = { ...tab, audible: true };
      await fireUpdate(tab.id, { audible: true });
      await vi.waitFor(() =>
        expect(tabAlarmManager.clearIdleAlarm).toHaveBeenCalled(),
      );
      tabAlarmManager.setIdleAlarm.mockClear();

      now = start + 10 * 60_000;
      tab = { ...tab, audible: false };
      await fireUpdate(tab.id, { audible: false });

      await vi.waitFor(() => expect(lastAlarmDeadline()).toBe(now + delay));
    });

    it("starts a fresh delay when a tab is unpinned", async () => {
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        keepPinnedTabs: true,
      });
      let tab = idleTab({ pinned: true });
      serveTabs(() => tab);
      await openedTabManager.rescheduleOpenTabs();
      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();

      now = start + 10 * 60_000;
      tab = { ...tab, pinned: false };
      await fireUpdate(tab.id, { pinned: false });

      await vi.waitFor(() => expect(lastAlarmDeadline()).toBe(now + delay));
    });

    it("starts a fresh delay when a protected site is unprotected", async () => {
      const tab = idleTab();
      serveTabs(() => tab);
      protectedSiteManager.isProtectedUrl.mockResolvedValue(true);
      await openedTabManager.rescheduleOpenTabs();
      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();

      now = start + 10 * 60_000;
      protectedSiteManager.isProtectedUrl.mockResolvedValue(false);
      await openedTabManager.rescheduleOpenTabs();

      expect(lastAlarmDeadline()).toBe(now + delay);
    });

    it("holds a running deadline when its alarm finds the tab protected", async () => {
      const tab = idleTab();
      serveTabs(() => tab);
      protectedSiteManager.isProtectedUrl.mockResolvedValue(true);
      const record = await fireIdleAlarm(tab, start);
      await vi.waitFor(() =>
        expect(tabAlarmManager.clearIdleAlarm).toHaveBeenCalledWith(
          record.id,
          record.revision,
        ),
      );
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();

      now = start + 10 * 60_000;
      protectedSiteManager.isProtectedUrl.mockResolvedValue(false);
      await openedTabManager.rescheduleOpenTabs();

      expect(lastAlarmDeadline()).toBe(now + delay);
    });

    it("starts a fresh delay when a Pause ends", async () => {
      const tab = idleTab();
      serveTabs(() => tab);
      await openedTabManager.rescheduleOpenTabs();
      expect(lastAlarmDeadline()).toBe(tab.lastAccessed + delay);

      snoozeManager.isSnoozed.mockResolvedValue(true);
      await openedTabManager.clearScheduledRemovals();
      await openedTabManager.rescheduleOpenTabs();

      now = start + 10 * 60_000;
      snoozeManager.isSnoozed.mockResolvedValue(false);
      tabAlarmManager.setIdleAlarm.mockClear();
      await openedTabManager.rescheduleOpenTabs();

      expect(lastAlarmDeadline()).toBe(now + delay);
    });

    it("counts time while the browser was closed as idle at startup", async () => {
      const tab = idleTab();
      serveTabs(() => tab);

      await getFirstListener<() => Promise<void>>(
        browserApiProvider.runtime.onStartup.addListener,
      )();

      expect(lastAlarmDeadline()).toBe(tab.lastAccessed + delay);
    });

    const fireInstalled = (previousVersion: string) =>
      getFirstListener<
        (details: chrome.runtime.InstalledDetails) => Promise<void>
      >(browserApiProvider.runtime.onInstalled.addListener)({
        reason: "update",
        previousVersion,
      } as chrome.runtime.InstalledDetails);

    it("gives every tab a fresh delay after an update from before 1.0.0", async () => {
      const tab = idleTab();
      serveTabs(() => tab);

      await fireInstalled("0.2.1");

      expect(lastAlarmDeadline()).toBe(start + delay);
    });

    it("replaces deadlines set by the background start before the update event", async () => {
      const tab = idleTab();
      serveTabs(() => tab);
      await openedTabManager.rescheduleOpenTabs();
      expect(lastAlarmDeadline()).toBe(tab.lastAccessed + delay);

      now = start + 1_000;
      await fireInstalled("0.2.1");

      expect(lastAlarmDeadline()).toBe(now + delay);
    });

    it("keeps idle time across an update from 1.0.0 or later", async () => {
      const tab = idleTab();
      serveTabs(() => tab);

      await fireInstalled("1.0.0");

      expect(lastAlarmDeadline()).toBe(tab.lastAccessed + delay);
    });
  });

  describe("onTabUpdated", () => {
    it("preserves Keep and deadline through a redirect deferred during tab creation", async () => {
      const source = {
        ...createTestTab(),
        active: false,
        id: 126,
        url: "https://before.example/",
        windowId: 12,
      } as chrome.tabs.Tab;
      const redirected = {
        ...source,
        url: "https://after.example/",
      } as chrome.tabs.Tab;
      const ledger = new IdleTabLedger(browserApiProvider.localStorage);
      const configuration = createDeferred<typeof emptyConfiguration>();
      let currentTab = source;
      Reflect.set(openedTabManager, "idleTabLedger", ledger);
      mockTabGet(async () => currentTab);
      mockTabQuery(async () => [currentTab]);
      configurationManager.get
        .mockReturnValueOnce(configuration.promise)
        .mockResolvedValue(emptyConfiguration);

      await ledger.reconcile([source]);
      const scheduled = await ledger.ensureInactive(source, 30_000);
      await ledger.setKept(source.id as TabId, true);

      const created = getFirstListener<(tab: chrome.tabs.Tab) => Promise<void>>(
        browserApiProvider.tab.onCreated.addListener,
      )(source);
      await vi.waitFor(() =>
        expect(configurationManager.get).toHaveBeenCalledTimes(1),
      );

      currentTab = redirected;
      await getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id as TabId,
        { url: redirected.url },
        redirected,
      );
      configuration.resolve(emptyConfiguration);
      await created;

      await expect(
        ledger.isKept(source.id as TabId, redirected.url),
      ).resolves.toBe(true);
      await expect(
        ledger.getBoundRecord(source.id as TabId),
      ).resolves.toMatchObject({ deadline: scheduled.deadline, kept: true });
    });

    it("replays a URL update that arrives while tab creation is pending", async () => {
      const sourceId = 100;
      const source = {
        ...createTestTab(),
        id: sourceId,
        windowId: 1,
        url: undefined,
      };
      const navigatedSource = {
        ...source,
        url: "https://example.com/pending-navigation",
      };
      const duplicate = {
        ...createTestTab(),
        id: 101,
        windowId: source.windowId,
        url: navigatedSource.url,
      };
      const creationConfiguration = createDeferred<typeof emptyConfiguration>();

      const configuration = {
        ...emptyConfiguration,
        removeExactDuplicates: true,
      };
      configurationManager.get
        .mockReturnValueOnce(creationConfiguration.promise)
        .mockResolvedValue(configuration);
      mockTabGet(async (tabId) => {
        if (tabId === source.id) return navigatedSource;
        if (tabId === duplicate.id) return duplicate;
        throw new Error(`Unexpected tab ${tabId}`);
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [duplicate];
        if (queryInfo?.windowId === source.windowId) {
          return [navigatedSource, duplicate];
        }
        return [];
      });

      const creation = getFirstListener<
        (tab: chrome.tabs.Tab) => Promise<void>
      >(browserApiProvider.tab.onCreated.addListener)(source);
      await vi.waitFor(() =>
        expect(configurationManager.get).toHaveBeenCalledTimes(1),
      );

      const update = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: navigatedSource.url },
        navigatedSource,
      );

      creationConfiguration.resolve(configuration);
      await Promise.all([creation, update]);

      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(duplicate.id);
    });

    it("waits for pending removal validation before replaying a creation URL update", async () => {
      const source = {
        ...createTestTab(),
        id: 110,
        windowId: 1,
        url: undefined,
      };
      const navigatedSource = {
        ...source,
        url: "https://example.com/removal-validation",
      };
      const duplicate = {
        ...createTestTab(),
        id: 111,
        windowId: source.windowId,
        url: navigatedSource.url,
      };
      const creationGenerationWrite = createDeferred<void>();
      const removalLookup = createDeferred<chrome.tabs.Tab>();

      const configuration = {
        ...emptyConfiguration,
        removeExactDuplicates: true,
      };
      configurationManager.get.mockResolvedValue(configuration);
      browserApiProvider.sessionStorage.set.mockReturnValueOnce(
        creationGenerationWrite.promise,
      );
      mockTabGet(async (tabId) => {
        if (tabId === source.id) return removalLookup.promise;
        if (tabId === duplicate.id) return duplicate;
        throw new Error(`Unexpected tab ${tabId}`);
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [duplicate];
        if (queryInfo?.windowId === source.windowId) {
          return [navigatedSource, duplicate];
        }
        return [];
      });

      const creation = getFirstListener<
        (tab: chrome.tabs.Tab) => Promise<void>
      >(browserApiProvider.tab.onCreated.addListener)(source);
      await vi.waitFor(() =>
        expect(browserApiProvider.sessionStorage.set).toHaveBeenCalledWith({
          tabGenerations: JSON.stringify({ [source.id]: 1 }),
        }),
      );
      await getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: navigatedSource.url },
        navigatedSource,
      );

      const removal = getFirstListener<
        (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => Promise<void>
      >(browserApiProvider.tab.onRemoved.addListener)(source.id, {
        windowId: source.windowId,
        isWindowClosing: false,
      });
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(source.id),
      );

      creationGenerationWrite.resolve();
      await creation;
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();

      removalLookup.resolve(navigatedSource);
      await removal;

      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(duplicate.id);
    });

    it("discards a pending creation URL update when removal validation confirms closure", async () => {
      const source = {
        ...createTestTab(),
        id: 112,
        windowId: 1,
        url: undefined,
      };
      const navigatedSource = {
        ...source,
        url: "https://example.com/confirmed-closure",
      };
      const duplicate = {
        ...createTestTab(),
        id: 113,
        windowId: source.windowId,
        url: navigatedSource.url,
      };
      const creationGenerationWrite = createDeferred<void>();
      const removalLookup = createDeferred<chrome.tabs.Tab>();

      const configuration = {
        ...emptyConfiguration,
        removeExactDuplicates: true,
      };
      configurationManager.get.mockResolvedValue(configuration);
      browserApiProvider.sessionStorage.set.mockReturnValueOnce(
        creationGenerationWrite.promise,
      );
      mockTabGet(async (tabId) => {
        if (tabId === source.id) return removalLookup.promise;
        if (tabId === duplicate.id) return duplicate;
        throw new Error(`Unexpected tab ${tabId}`);
      });
      mockTabQuery(async (queryInfo) =>
        isDuplicateQuery(queryInfo) ? [duplicate] : [],
      );

      const creation = getFirstListener<
        (tab: chrome.tabs.Tab) => Promise<void>
      >(browserApiProvider.tab.onCreated.addListener)(source);
      await vi.waitFor(() =>
        expect(browserApiProvider.sessionStorage.set).toHaveBeenCalledWith({
          tabGenerations: JSON.stringify({ [source.id]: 1 }),
        }),
      );
      await getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: navigatedSource.url },
        navigatedSource,
      );

      const removal = getFirstListener<
        (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => Promise<void>
      >(browserApiProvider.tab.onRemoved.addListener)(source.id, {
        windowId: source.windowId,
        isWindowClosing: false,
      });
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(source.id),
      );

      creationGenerationWrite.resolve();
      await creation;
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();

      removalLookup.reject(new Error("source closed"));
      await removal;

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      expect(browserApiProvider.tab.query).not.toHaveBeenCalledWith({
        active: false,
        url: navigatedSource.url,
      });
    });

    it("preserves a replacement URL update when an old removal validation resolves after ID reuse", async () => {
      const tabId = 116;
      const oldSource = {
        ...createTestTab(),
        id: tabId,
        windowId: 1,
        url: undefined,
      };
      const replacement = {
        ...oldSource,
        url: "https://example.com/reused-source",
      };
      const duplicate = {
        ...createTestTab(),
        id: 117,
        windowId: oldSource.windowId,
        url: replacement.url,
      };
      const oldCreationGenerationWrite = createDeferred<void>();
      const oldRemovalLookup = createDeferred<chrome.tabs.Tab>();
      let sourceGetCount = 0;

      const configuration = {
        ...emptyConfiguration,
        removeExactDuplicates: true,
      };
      configurationManager.get.mockResolvedValue(configuration);
      browserApiProvider.sessionStorage.set.mockReturnValueOnce(
        oldCreationGenerationWrite.promise,
      );
      mockTabGet(async (candidateId) => {
        if (candidateId === tabId) {
          sourceGetCount += 1;
          return sourceGetCount === 1 ? oldRemovalLookup.promise : replacement;
        }
        if (candidateId === duplicate.id) return duplicate;
        throw new Error(`Unexpected tab ${candidateId}`);
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [duplicate];
        if (queryInfo?.windowId === replacement.windowId) {
          return [replacement, duplicate];
        }
        return [];
      });

      const created = getFirstListener<(tab: chrome.tabs.Tab) => Promise<void>>(
        browserApiProvider.tab.onCreated.addListener,
      );
      const oldCreation = created(oldSource);
      await vi.waitFor(() =>
        expect(browserApiProvider.sessionStorage.set).toHaveBeenCalledWith({
          tabGenerations: JSON.stringify({ [tabId]: 1 }),
        }),
      );
      const oldRemoval = getFirstListener<
        (removedId: number, info: chrome.tabs.TabRemoveInfo) => Promise<void>
      >(browserApiProvider.tab.onRemoved.addListener)(tabId, {
        windowId: oldSource.windowId,
        isWindowClosing: false,
      });
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(tabId),
      );

      const replacementCreation = created({
        ...replacement,
        url: undefined,
      });
      await getFirstListener<
        (
          updatedId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        tabId,
        { url: replacement.url },
        replacement,
      );

      oldCreationGenerationWrite.resolve();
      await Promise.all([oldCreation, replacementCreation]);
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();

      oldRemovalLookup.reject(new Error("old incarnation closed"));
      await oldRemoval;

      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(duplicate.id);
    });

    it("replays only the latest URL update received during pending creation", async () => {
      const source = {
        ...createTestTab(),
        id: 118,
        windowId: 1,
        url: undefined,
      };
      const oldUrl = "https://example.com/old-pending-url";
      const latestUrl = "https://example.com/latest-pending-url";
      const oldDuplicate = {
        ...createTestTab(),
        id: 119,
        windowId: source.windowId,
        url: oldUrl,
      };
      const latestDuplicate = {
        ...createTestTab(),
        id: 120,
        windowId: source.windowId,
        url: latestUrl,
      };
      const creationConfiguration = createDeferred<typeof emptyConfiguration>();

      const configuration = {
        ...emptyConfiguration,
        removeExactDuplicates: true,
      };
      configurationManager.get
        .mockReturnValueOnce(creationConfiguration.promise)
        .mockResolvedValue(configuration);
      mockTabGet(async (tabId) => {
        if (tabId === source.id) return { ...source, url: latestUrl };
        if (tabId === oldDuplicate.id) return oldDuplicate;
        if (tabId === latestDuplicate.id) return latestDuplicate;
        throw new Error(`Unexpected tab ${tabId}`);
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) {
          return [oldDuplicate, latestDuplicate];
        }
        if (queryInfo?.windowId === source.windowId) {
          return [{ ...source, url: latestUrl }, latestDuplicate];
        }
        return [];
      });

      const creation = getFirstListener<
        (tab: chrome.tabs.Tab) => Promise<void>
      >(browserApiProvider.tab.onCreated.addListener)(source);
      await vi.waitFor(() =>
        expect(configurationManager.get).toHaveBeenCalledTimes(1),
      );
      const update = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener);
      await update(source.id, { url: oldUrl }, { ...source, url: oldUrl });
      await update(
        source.id,
        { url: latestUrl },
        { ...source, url: latestUrl },
      );

      creationConfiguration.resolve(configuration);
      await creation;

      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(
        latestDuplicate.id,
      );
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalledWith(
        oldDuplicate.id,
      );
    });

    it("replays the latest URL update received while removal validation blocks creation replay", async () => {
      const source = {
        ...createTestTab(),
        id: 121,
        windowId: 1,
        url: undefined,
      };
      const oldUrl = "https://example.com/old-blocked-url";
      const latestUrl = "https://example.com/latest-blocked-url";
      const oldDuplicate = {
        ...createTestTab(),
        id: 122,
        windowId: source.windowId,
        url: oldUrl,
      };
      const latestSource = {
        ...source,
        url: latestUrl,
      };
      const latestDuplicate = {
        ...createTestTab(),
        id: 123,
        windowId: source.windowId,
        url: latestUrl,
      };
      const creationGenerationWrite = createDeferred<void>();
      const removalLookup = createDeferred<chrome.tabs.Tab>();

      const configuration = {
        ...emptyConfiguration,
        removeExactDuplicates: true,
      };
      configurationManager.get.mockResolvedValue(configuration);
      browserApiProvider.sessionStorage.set.mockReturnValueOnce(
        creationGenerationWrite.promise,
      );
      mockTabGet(async (tabId) => {
        if (tabId === source.id) return removalLookup.promise;
        if (tabId === oldDuplicate.id) return oldDuplicate;
        if (tabId === latestDuplicate.id) return latestDuplicate;
        throw new Error(`Unexpected tab ${tabId}`);
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) {
          return [oldDuplicate, latestDuplicate];
        }
        if (queryInfo?.windowId === source.windowId) {
          return [latestSource, latestDuplicate];
        }
        return [];
      });

      const creation = getFirstListener<
        (tab: chrome.tabs.Tab) => Promise<void>
      >(browserApiProvider.tab.onCreated.addListener)(source);
      await vi.waitFor(() =>
        expect(browserApiProvider.sessionStorage.set).toHaveBeenCalledWith({
          tabGenerations: JSON.stringify({ [source.id]: 1 }),
        }),
      );
      const update = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener);
      await update(source.id, { url: oldUrl }, { ...source, url: oldUrl });

      const removal = getFirstListener<
        (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => Promise<void>
      >(browserApiProvider.tab.onRemoved.addListener)(source.id, {
        windowId: source.windowId,
        isWindowClosing: false,
      });
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(source.id),
      );

      creationGenerationWrite.resolve();
      await creation;
      await update(source.id, { url: latestUrl }, latestSource);
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();

      removalLookup.resolve(latestSource);
      await removal;

      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(
        latestDuplicate.id,
      );
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalledWith(
        oldDuplicate.id,
      );
    });

    it("cancels duplicate removal when the source navigates during final candidate validation", async () => {
      const source = {
        ...createTestTab(),
        id: 114,
        windowId: 1,
        url: "https://example.com/source-navigation",
      };
      const duplicate = {
        ...createTestTab(),
        id: 115,
        windowId: source.windowId,
        url: source.url,
      };
      const candidateLookup = createDeferred<chrome.tabs.Tab>();

      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      mockTabGet(async (tabId) => {
        if (tabId === duplicate.id) return candidateLookup.promise;
        throw new Error(`Unexpected tab ${tabId}`);
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [duplicate];
        return [];
      });

      const update = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener);
      const cleanup = update(source.id, { url: source.url }, source);
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(duplicate.id),
      );

      await update(
        source.id,
        { url: "https://example.com/new-source" },
        { ...source, url: "https://example.com/new-source" },
      );
      candidateLookup.resolve(duplicate);
      await cleanup;

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("restores an overdue deadline after an unpin safety update", async () => {
      const now = 1_700_000_000_000;
      const deadline = now - 60_000;
      const tab = {
        ...createTestTab(),
        id: 124,
        windowId: 1,
        pinned: false,
      };
      vi.spyOn(Date, "now").mockReturnValue(now);
      await createIdleRecord(tab, deadline);
      mockTabGet(async () => tab);

      await getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        tab.id,
        { pinned: false },
        tab,
      );

      await vi.waitFor(() =>
        expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
          idleRecordId(tab.id),
          deadline,
          expect.any(Number),
        ),
      );
    });

    it("schedules the latest URL after aborting an in-flight duplicate removal", async () => {
      const source = {
        ...createTestTab(),
        id: 125,
        windowId: 1,
        url: "https://example.com/old-source",
      };
      const latestSource = {
        ...source,
        url: "https://example.com/latest-source",
      };
      const duplicate = {
        ...createTestTab(),
        id: 126,
        windowId: source.windowId,
        url: source.url,
      };
      const candidateLookup = createDeferred<chrome.tabs.Tab>();

      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      mockTabGet(async (tabId) => {
        if (tabId === source.id) return latestSource;
        if (tabId === duplicate.id) return candidateLookup.promise;
        throw new Error(`Unexpected tab ${tabId}`);
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [duplicate];
        return [];
      });

      const update = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener);
      const oldUpdate = update(source.id, { url: source.url }, source);
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(duplicate.id),
      );

      await update(source.id, { url: latestSource.url }, latestSource);
      candidateLookup.resolve(duplicate);
      await oldUpdate;

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledTimes(1);
        expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
          idleRecordId(source.id),
          expect.any(Number),
          expect.any(Number),
        );
      });
    });

    it("schedules a URL update replayed after pending creation finishes", async () => {
      const source = {
        ...createTestTab(),
        id: 127,
        windowId: 1,
        url: undefined,
      };
      const navigatedSource = {
        ...source,
        url: "https://example.com/pending-schedule",
      };
      const creationConfiguration = createDeferred<typeof emptyConfiguration>();

      configurationManager.get.mockReturnValueOnce(
        creationConfiguration.promise,
      );
      mockTabGet(async () => navigatedSource);

      const creation = getFirstListener<
        (tab: chrome.tabs.Tab) => Promise<void>
      >(browserApiProvider.tab.onCreated.addListener)(source);
      await vi.waitFor(() =>
        expect(configurationManager.get).toHaveBeenCalledTimes(1),
      );
      await getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: navigatedSource.url },
        navigatedSource,
      );

      creationConfiguration.resolve(emptyConfiguration);
      await creation;

      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
        idleRecordId(source.id),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it("should remove duplicate tabs when feature is enabled", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({
          ...emptyConfiguration,
          keepGroupedTabs: true,
          removeExactDuplicates: true,
        }),
      );

      const originalTab = createTestTab();
      originalTab.id = 101;
      originalTab.url = "https://example.com?foo=bar";
      const copyTab = structuredClone(originalTab);
      copyTab.id = 102;

      const groupedCopyTab = createTestTab();
      groupedCopyTab.id = 103;
      groupedCopyTab.url = "https://example.com?foo=bar";
      groupedCopyTab.groupId = 1;

      const newTab = createTestTab();
      newTab.id = 104;
      newTab.url = "https://example.com?foo=bar";

      browserApiProvider.tab.query.mockReturnValue(
        Promise.resolve([originalTab, copyTab, groupedCopyTab]),
      );

      const duplicateTabs = [originalTab, copyTab, groupedCopyTab];
      mockTabGet(async (tabId) => {
        const tab = duplicateTabs.find((candidate) => candidate.id === tabId);
        if (!tab) throw new Error(`Unexpected tab ${tabId}`);
        return tab;
      });

      excludedTabManager.isExcluded.mockReturnValue(Promise.resolve(false));

      const listener = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener);
      await listener(newTab.id, { url: newTab.url }, newTab);

      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(
        originalTab.id,
      );
      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(copyTab.id);

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalledWith(
        groupedCopyTab.id,
      );

      expect(extensionActionManager.setBadgeCounter).toHaveBeenCalledTimes(2);

      const removed = await openedTabManager.getRecentlyClosed();
      expect(removed).toHaveLength(2);
      expect(removed.every((t) => t.reason === "duplicate")).toBe(true);
    });

    it("removes every eligible duplicate even after the window reaches the idle threshold", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({
          ...emptyConfiguration,
          tabCountThreshold: 2,
          removeExactDuplicates: true,
        }),
      );

      const firstDuplicate = createTestTab();
      firstDuplicate.id = 201;
      firstDuplicate.url = "https://example.com?foo=bar";

      const secondDuplicate = createTestTab();
      secondDuplicate.id = 202;
      secondDuplicate.url = "https://example.com?foo=bar";

      const newTab = createTestTab();
      newTab.id = 203;
      newTab.url = "https://example.com?foo=bar";

      let openTabs: chrome.tabs.Tab[] = [
        firstDuplicate,
        secondDuplicate,
        newTab,
      ];

      mockTabQuery(async (queryInfo) => {
        if (queryInfo?.windowId === firstDuplicate.windowId) {
          return openTabs;
        }
        if (isDuplicateQuery(queryInfo)) {
          return [firstDuplicate, secondDuplicate];
        }
        return [];
      });
      mockTabGet(async (tabId) => {
        const tab = openTabs.find((candidate) => candidate.id === tabId);
        if (!tab) {
          throw new Error(`Tab ${tabId} was already removed`);
        }
        return tab;
      });
      mockTabRemove(async (tabId) => {
        openTabs = openTabs.filter((tab) => tab.id !== tabId);
      });

      const listener = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener);
      await listener(newTab.id, { url: newTab.url }, newTab);

      expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(2);
      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(
        firstDuplicate.id,
      );
      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(
        secondDuplicate.id,
      );
      expect(extensionActionManager.setBadgeCounter).toHaveBeenCalledTimes(2);
      expect(await openedTabManager.getRecentlyClosed()).toHaveLength(2);
    });

    it("should not remove duplicate tabs on protected sites", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({
          ...emptyConfiguration,
          removeExactDuplicates: true,
        }),
      );

      const originalTab = createTestTab();
      originalTab.id = 301;
      originalTab.url = "https://example.com?foo=bar";
      const copyTab = structuredClone(originalTab);
      copyTab.id = 302;

      const newTab = createTestTab();
      newTab.id = 303;
      newTab.url = "https://example.com?foo=bar";

      browserApiProvider.tab.query.mockReturnValue(
        Promise.resolve([originalTab, copyTab]),
      );

      browserApiProvider.tab.get.mockReturnValueOnce(
        Promise.resolve(originalTab),
      );
      browserApiProvider.tab.get.mockReturnValueOnce(Promise.resolve(copyTab));

      excludedTabManager.isExcluded.mockReturnValue(Promise.resolve(false));
      protectedSiteManager.isProtectedUrl.mockReturnValue(
        Promise.resolve(true),
      );

      const listener = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener);
      await listener(newTab.id, { url: newTab.url }, newTab);

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      expect(extensionActionManager.setBadgeCounter).not.toHaveBeenCalled();
      expect(await openedTabManager.getRecentlyClosed()).toHaveLength(0);
    });

    it("does not close duplicates when protection storage is unavailable", async () => {
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      const original = {
        ...createTestTab(),
        id: 306,
        url: "https://example.com/",
      };
      const copy = { ...original, id: 307 };
      browserApiProvider.tab.query.mockResolvedValue([original, copy]);
      mockTabGet(async (id) => ({ ...original, id }));
      protectedSiteManager.isProtectedUrl.mockRejectedValue(
        new Error("rules unavailable"),
      );
      const update = getFirstListener<
        (
          id: number,
          change: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener);
      await update(copy.id, { url: copy.url }, copy);
      expect(protectedSiteManager.isProtectedUrl).toHaveBeenCalled();
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("should not remove duplicates when under the tab count threshold", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({
          ...emptyConfiguration,
          tabCountThreshold: 10,
          removeExactDuplicates: true,
        }),
      );
      mockTabQuery(async (queryInfo) => {
        if (queryInfo?.windowId === 0) {
          return Array.from({ length: 10 }, () => ({}) as chrome.tabs.Tab);
        }
        return [] as chrome.tabs.Tab[];
      });

      const newTab = createTestTab();
      newTab.url = "https://example.com?foo=bar";

      const listener = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener);
      await listener(newTab.id, { url: newTab.url }, newTab);

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("shouldn't remove duplicate tabs when feature is disabled", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({
          ...emptyConfiguration,
          removeExactDuplicates: false,
        }),
      );

      const originalTab = createTestTab();
      originalTab.url = "https://example.com?foo=bar";
      const copyTab = structuredClone(originalTab);

      const newTab = createTestTab();
      newTab.url = "https://example.com?foo=bar";

      browserApiProvider.tab.query.mockReturnValue(
        Promise.resolve([originalTab, copyTab]),
      );

      const listener = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener);
      await listener(newTab.id, { url: newTab.url }, newTab);

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });
  });

  describe("snooze", () => {
    it("should not schedule removals while snoozed", async () => {
      snoozeManager.isSnoozed.mockReturnValue(Promise.resolve(true));
      const tab = createTestTab();

      const listener = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      );
      await listener(tab);

      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
    });

    it("should not remove duplicates while snoozed", async () => {
      snoozeManager.isSnoozed.mockReturnValue(Promise.resolve(true));
      configurationManager.get.mockReturnValue(
        Promise.resolve({ ...emptyConfiguration, removeExactDuplicates: true }),
      );

      const tab = createTestTab();
      tab.url = "https://example.com";

      const listener = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener);
      await listener(tab.id, { url: tab.url }, tab);

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("should not remove tabs via alarms while snoozed", async () => {
      snoozeManager.isSnoozed.mockReturnValue(Promise.resolve(true));
      const tabId: TabId = 123;

      await fireIdleAlarm({ ...createTestTab(), id: tabId });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("should re-check snooze before each queued alarm removal", async () => {
      const firstTab = createTestTab();
      firstTab.id = 401;
      firstTab.url = "https://example.com/first";

      const secondTab = createTestTab();
      secondTab.id = 402;
      secondTab.url = "https://example.com/second";

      let openTabs: chrome.tabs.Tab[] = [firstTab, secondTab];
      snoozeManager.isSnoozed.mockImplementation(
        async () => openTabs.length < 2,
      );
      mockTabQuery(async (queryInfo) => {
        if (Object.keys(queryInfo ?? {}).length === 0) {
          return openTabs;
        }
        return [];
      });
      mockTabGet(async (tabId) => {
        const tab = openTabs.find((candidate) => candidate.id === tabId);
        if (!tab) {
          throw new Error(`Tab ${tabId} was already removed`);
        }
        return tab;
      });
      mockTabRemove(async (tabId) => {
        openTabs = openTabs.filter((tab) => tab.id !== tabId);
      });

      await fireIdleAlarm(firstTab);
      await fireIdleAlarm(secondTab);

      await vi.waitFor(() => {
        expect(snoozeManager.isSnoozed).toHaveBeenCalledTimes(2);
      });

      expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1);
      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(firstTab.id);
    });
  });

  describe("tab count threshold", () => {
    it("aborts an alarm removal when configuration cannot be read", async () => {
      const candidate = { ...createTestTab(), id: 1091, windowId: 10 };
      const scheduledTime = 1_700_000_000_000;
      configurationManager.get.mockRejectedValue(new Error("storage offline"));
      mockTabGet(async () => candidate);

      await fireIdleAlarm(candidate, scheduledTime);

      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(candidate.id),
      );
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("does not schedule when configuration cannot be read", async () => {
      const tab = {
        ...createTestTab(),
        id: 1092,
        url: undefined,
        windowId: 10,
      };
      configurationManager.get.mockRejectedValue(new Error("storage offline"));
      mockTabGet(async () => tab);

      await getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(tab);

      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
    });

    it("fails safe for non-array queries, missing window IDs, and candidate get failures", async () => {
      const candidate = { ...createTestTab(), id: 1093, windowId: 10 };
      const scheduledTime = 1_700_000_000_000;
      mockTabGet(async () => candidate);
      const query = browserApiProvider.tab.query as unknown as {
        mockResolvedValueOnce: (value: unknown) => void;
      };
      query.mockResolvedValueOnce({});
      await fireIdleAlarm(candidate, scheduledTime);
      await vi.waitFor(async () =>
        expect((await openedTabManager.getCleanupDiagnostics()).events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ event: "remove-skipped-threshold" }),
          ]),
        ),
      );

      mockTabGet(
        async () =>
          ({ ...candidate, windowId: undefined }) as unknown as chrome.tabs.Tab,
      );
      await fireIdleAlarm(candidate, scheduledTime);
      await vi.waitFor(async () =>
        expect(
          (await openedTabManager.getCleanupDiagnostics()).events.filter(
            ({ event }) => event === "remove-skipped-threshold",
          ),
        ).toHaveLength(2),
      );

      mockTabGet(async () => {
        throw new Error("candidate absent");
      });
      await fireIdleAlarm(candidate, scheduledTime);
      await vi.waitFor(async () =>
        expect((await openedTabManager.getCleanupDiagnostics()).events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: "remove-skipped-idle-identity",
            }),
          ]),
        ),
      );

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("cancels a removal when a protection mutation starts during the final query", async () => {
      const candidate = { ...createTestTab(), id: 1097, windowId: 10 };
      const floor = createDeferred<ReadonlyArray<chrome.tabs.Tab>>();
      mockTabGet(async () => candidate);
      mockTabQuery(async () => floor.promise);
      await fireIdleAlarm(candidate, 1_700_000_000_000);
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.query).toHaveBeenCalledWith({}),
      );
      const finish = openedTabManager.beginSafetyMutation();
      finish();
      floor.resolve([candidate]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it.each([
      [
        "url",
        { url: "https://example.com/changed" },
        { url: "https://example.com/changed" },
      ],
      ["pinned", { pinned: true }, { pinned: true }],
      ["audible", { audible: true }, { audible: true }],
      ["group", { groupId: 7 }, { groupId: 7 }],
    ] as Array<[string, chrome.tabs.TabChangeInfo, Partial<chrome.tabs.Tab>]>)(
      "blocks removal when %s safety changes during the final floor query",
      async (_, changeInfo, tabChanges) => {
        const candidate = {
          ...createTestTab(),
          id: 1097,
          windowId: 10,
          url: "https://example.com/original",
        };
        const companion = {
          ...createTestTab(),
          id: 1098,
          windowId: candidate.windowId,
        };
        const deadline = 1_700_000_000_000;
        const floorQuery = createDeferred<ReadonlyArray<chrome.tabs.Tab>>();
        let globalQueryCount = 0;
        let currentTabs: ReadonlyArray<chrome.tabs.Tab> = [
          candidate,
          companion,
        ];
        configurationManager.get.mockResolvedValue({
          ...emptyConfiguration,
          tabCountThreshold: 1,
        });
        mockTabGet(async () => candidate);
        mockTabQuery(async (queryInfo) => {
          if (Object.keys(queryInfo ?? {}).length !== 0) return [];
          globalQueryCount += 1;
          return globalQueryCount === 1 ? floorQuery.promise : currentTabs;
        });

        await fireIdleAlarm(candidate, deadline);
        await vi.waitFor(() =>
          expect(browserApiProvider.tab.query).toHaveBeenCalledWith({}),
        );

        const updatedTab = { ...candidate, ...tabChanges };
        currentTabs = [updatedTab, companion];
        await getFirstListener<
          (
            id: TabId,
            info: chrome.tabs.TabChangeInfo,
            tab: chrome.tabs.Tab,
          ) => unknown
        >(browserApiProvider.tab.onUpdated.addListener)(
          candidate.id,
          changeInfo,
          updatedTab,
        );
        floorQuery.resolve([updatedTab, companion]);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      },
    );

    it("should not remove tabs via alarms when under the threshold", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({ ...emptyConfiguration, tabCountThreshold: 10 }),
      );
      mockTabGet(async (tabId) => ({
        ...createTestTab(),
        id: tabId,
        windowId: 1,
      }));
      mockTabQuery(async (queryInfo) => {
        if (Object.keys(queryInfo ?? {}).length === 0) {
          return Array.from({ length: 10 }, (_, index) =>
            index === 0
              ? { ...createTestTab(), id: tabId, windowId: 1 }
              : { ...createTestTab(), id: 200 + index, windowId: 1 },
          );
        }
        return [] as chrome.tabs.Tab[];
      });

      const tabId: TabId = 123;
      await fireIdleAlarm({
        ...createTestTab(),
        id: tabId,
        windowId: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("should apply the threshold to the candidate tab window, not global tab count", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({ ...emptyConfiguration, tabCountThreshold: 2 }),
      );

      const candidate = createTestTab();
      candidate.id = 701;
      candidate.windowId = 1;
      candidate.url = "https://example.com/candidate";

      const activeSameWindow = createTestTab();
      activeSameWindow.id = 702;
      activeSameWindow.windowId = 1;
      activeSameWindow.active = true;

      const crowdedOtherWindowTabs = Array.from({ length: 10 }, (_, index) => ({
        ...createTestTab(),
        id: 800 + index,
        windowId: 2,
      }));

      mockTabGet(async (tabId) => {
        if (tabId === candidate.id) return candidate;
        throw new Error(`Unexpected tab ${tabId}`);
      });
      mockTabQuery(async (queryInfo) => {
        if (Object.keys(queryInfo ?? {}).length === 0) {
          return [candidate, activeSameWindow, ...crowdedOtherWindowTabs];
        }
        return [];
      });

      await fireIdleAlarm(candidate);

      await vi.waitFor(() => {
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(candidate.id);
      });

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("keeps a window at its threshold when the global snapshot contains a crowded second window", async () => {
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        tabCountThreshold: 10,
      });
      const candidate = {
        ...createTestTab(),
        id: 851,
        windowId: 5,
        url: "https://example.com/candidate",
      };
      const candidateWindowTabs = [
        candidate,
        ...Array.from({ length: 9 }, (_, index) => ({
          ...createTestTab(),
          id: 852 + index,
          windowId: candidate.windowId,
        })),
      ];
      const crowdedOtherWindowTabs = Array.from({ length: 20 }, (_, index) => ({
        ...createTestTab(),
        id: 900 + index,
        windowId: 6,
      }));
      mockTabGet(async () => candidate);
      mockTabQuery(async (queryInfo) =>
        Object.keys(queryInfo ?? {}).length === 0
          ? [...candidateWindowTabs, ...crowdedOtherWindowTabs]
          : [],
      );

      await fireIdleAlarm(candidate);

      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(candidate.id),
      );
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      await expect(
        openedTabManager.getCleanupDiagnostics(),
      ).resolves.toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({
            details: expect.objectContaining({
              requestedWindowId: candidate.windowId,
              visibleTabCount: 10,
            }),
            event: "threshold-window-query",
          }),
        ]),
      });
    });

    it("should ignore hidden tabs when evaluating the per-window threshold", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({ ...emptyConfiguration, tabCountThreshold: 2 }),
      );

      const candidate = createTestTab();
      candidate.id = 901;
      candidate.windowId = 7;
      candidate.url = "https://example.com/visible";

      const activeVisibleTab = createTestTab();
      activeVisibleTab.id = 902;
      activeVisibleTab.windowId = 7;
      activeVisibleTab.active = true;

      const hiddenTabs = Array.from({ length: 10 }, (_, index) => ({
        ...createTestTab(),
        id: 950 + index,
        windowId: 7,
        hidden: true,
      })) as chrome.tabs.Tab[];

      mockTabGet(async (tabId) => {
        if (tabId === candidate.id) return candidate;
        throw new Error(`Unexpected tab ${tabId}`);
      });
      mockTabQuery(async (queryInfo) => {
        if (Object.keys(queryInfo ?? {}).length === 0) {
          return [candidate, activeVisibleTab, ...hiddenTabs];
        }
        return [];
      });

      await fireIdleAlarm(candidate);

      await vi.waitFor(() => {
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(candidate.id);
      });

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("should not remove hidden duplicate tabs", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({
          ...emptyConfiguration,
          removeExactDuplicates: true,
          tabCountThreshold: 0,
        }),
      );

      const sourceTab = createTestTab();
      sourceTab.id = 1001;
      sourceTab.windowId = 3;
      sourceTab.url = "https://example.com/duplicate";

      const hiddenDuplicate = {
        ...createTestTab(),
        id: 1002,
        windowId: 3,
        url: sourceTab.url,
        hidden: true,
      } as chrome.tabs.Tab & { id: number };

      mockTabGet(async (tabId) => {
        if (tabId === sourceTab.id) return sourceTab;
        if (tabId === hiddenDuplicate.id) return hiddenDuplicate;
        throw new Error(`Unexpected tab ${tabId}`);
      });
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) {
          return [hiddenDuplicate];
        }
        return [];
      });

      const listener = getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener);
      await listener(sourceTab.id, { url: sourceTab.url }, sourceTab);

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("should ignore duplicate queued alarms after a tab has already been removed", async () => {
      const tab = createTestTab();
      tab.id = 501;
      tab.url = "https://example.com/alarm";

      let openTabs: chrome.tabs.Tab[] = [tab];

      mockTabQuery(async (queryInfo) => {
        if (Object.keys(queryInfo ?? {}).length === 0) {
          return openTabs;
        }
        return [];
      });
      mockTabGet(async (tabId) => {
        const existingTab = openTabs.find(
          (candidate) => candidate.id === tabId,
        );
        if (!existingTab) {
          throw new Error(`Tab ${tabId} was already removed`);
        }
        return existingTab;
      });
      mockTabRemove(async (tabId) => {
        openTabs = openTabs.filter((candidate) => candidate.id !== tabId);
      });

      const record = await createIdleRecord(tab);
      const scheduledTime = record.deadline ?? 0;
      getFirstAlarmListener()(record.id, record.revision, scheduledTime);
      getFirstAlarmListener()(record.id, record.revision, scheduledTime);

      await vi.waitFor(() => {
        expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1);
      });

      expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1);
      expect(extensionActionManager.setBadgeCounter).toHaveBeenCalledTimes(1);
      expect(await openedTabManager.getRecentlyClosed()).toHaveLength(1);
    });

    it("should re-check the threshold before each queued alarm removal", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({ ...emptyConfiguration, tabCountThreshold: 2 }),
      );

      const firstTab = createTestTab();
      firstTab.id = 101;
      firstTab.url = "https://example.com/first";

      const secondTab = createTestTab();
      secondTab.id = 102;
      secondTab.url = "https://example.com/second";

      const activeTab = createTestTab();
      activeTab.id = 103;
      activeTab.active = true;
      activeTab.url = "https://example.com/active";

      let openTabs: chrome.tabs.Tab[] = [firstTab, secondTab, activeTab];

      mockTabQuery(async (queryInfo) => {
        if (Object.keys(queryInfo ?? {}).length === 0) {
          return openTabs;
        }
        return [];
      });
      mockTabGet(async (tabId) => {
        const tab = openTabs.find((candidate) => candidate.id === tabId);
        if (!tab) {
          throw new Error(`Tab ${tabId} was already removed`);
        }
        return tab;
      });
      mockTabRemove(async (tabId) => {
        openTabs = openTabs.filter((tab) => tab.id !== tabId);
      });

      await fireIdleAlarm(firstTab);
      await fireIdleAlarm(secondTab);

      await vi.waitFor(() => {
        expect(configurationManager.get).toHaveBeenCalledTimes(4);
      });

      expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1);
    });

    it.each([
      { threshold: 0, visibleCount: 1, schedules: true },
      { threshold: 2, visibleCount: 1, schedules: false },
      { threshold: 2, visibleCount: 2, schedules: false },
      { threshold: 2, visibleCount: 3, schedules: true },
    ])(
      "uses $threshold as a hard floor with $visibleCount visible tabs",
      async ({ threshold, visibleCount, schedules }) => {
        configurationManager.get.mockReturnValue(
          Promise.resolve({
            ...emptyConfiguration,
            tabCountThreshold: threshold,
          }),
        );
        const tab = { ...createTestTab(), id: 1, windowId: 4 };
        mockTabGet(async () => tab);
        mockTabQuery(async (queryInfo) =>
          queryInfo?.windowId === tab.windowId
            ? Array.from({ length: visibleCount }, (_, index) =>
                index === 0
                  ? tab
                  : { ...createTestTab(), windowId: tab.windowId },
              )
            : [],
        );

        const listener = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
          browserApiProvider.tab.onCreated.addListener,
        );
        await listener(tab);

        if (schedules) {
          expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
            idleRecordId(tab.id),
            expect.any(Number),
            expect.any(Number),
          );
        } else {
          expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
          expect(tabAlarmManager.clearIdleAlarm).toHaveBeenCalledWith(
            idleRecordId(tab.id),
            expect.any(Number),
          );
        }
      },
    );

    it("fails safe when the candidate is absent from its queried window", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({ ...emptyConfiguration, tabCountThreshold: 2 }),
      );
      const candidate = { ...createTestTab(), id: 1101, windowId: 11 };
      mockTabGet(async () => candidate);
      mockTabQuery(async (queryInfo) =>
        queryInfo?.windowId === candidate.windowId
          ? [
              { ...createTestTab(), id: 1102, windowId: candidate.windowId },
              { ...createTestTab(), id: 1103, windowId: candidate.windowId },
              { ...createTestTab(), id: 1104, windowId: candidate.windowId },
            ]
          : [],
      );

      await fireIdleAlarm(candidate);

      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(candidate.id),
      );
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("fails safe on a window query failure even when the threshold is disabled", async () => {
      const candidate = { ...createTestTab(), id: 1151, windowId: 11 };
      mockTabGet(async () => candidate);
      mockTabQuery(async () => {
        throw new Error("Safari tabs query failed");
      });

      await fireIdleAlarm(candidate);

      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(candidate.id),
      );
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });
  });

  describe("inactivity deadlines", () => {
    it("restores an idle deadline to a recreated tab ID with the same URL", async () => {
      const now = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      const originalTab = {
        ...createTestTab(),
        id: 127,
        index: 0,
        url: "https://lyrics.example/",
        windowId: 126,
      };
      let currentTab: chrome.tabs.Tab = originalTab;
      mockTabGet(async () => currentTab);
      mockTabQuery(async (queryInfo) =>
        queryInfo?.windowId === currentTab.windowId ||
        Object.keys(queryInfo ?? {}).length === 0
          ? [currentTab]
          : [],
      );

      await getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(originalTab);
      await vi.waitFor(() =>
        expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledTimes(1),
      );
      const setIdleAlarm = tabAlarmManager.setIdleAlarm as unknown as {
        mock: { calls: Array<[string, number, number]> };
      };
      const [recordId, deadline, revision] = setIdleAlarm.mock.calls[0];

      currentTab = {
        ...originalTab,
        id: 63,
        windowId: 39,
      };
      const restartedManager = new OpenedTabManager(
        browserApiProvider,
        tabAlarmManager,
        excludedTabManager,
        protectedSiteManager,
        snoozeManager,
        configurationManager,
        extensionActionManager,
      );
      await restartedManager.watchTabs();

      await vi.waitFor(() =>
        expect(tabAlarmManager.setIdleAlarm).toHaveBeenLastCalledWith(
          recordId,
          deadline,
          revision,
        ),
      );
    });

    it("holds the deadline while an inactive tab is initially excluded", async () => {
      const now = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      const tab = {
        ...createTestTab(),
        id: 1191,
        windowId: 12,
        lastAccessed: now - 31 * 60_000,
      };
      excludedTabManager.isExcluded.mockResolvedValue(true);
      mockTabGet(async () => tab);

      await getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(tab);

      const record = await new IdleTabLedger(
        browserApiProvider.localStorage,
      ).getBoundRecord(tab.id);
      expect(record?.held).toBe(true);
      expect(record?.deadline).toBeUndefined();
      expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
    });

    it("starts a fresh delay when an excluded tab becomes eligible", async () => {
      const now = 1_700_000_000_000;
      const deadline = now - 60_000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      const tab = { ...createTestTab(), id: 1192, windowId: 12 };
      await createIdleRecord(tab, deadline);
      excludedTabManager.isExcluded.mockResolvedValueOnce(true);
      excludedTabManager.isExcluded.mockResolvedValue(false);
      mockTabGet(async () => tab);
      mockTabQuery(async (queryInfo) =>
        queryInfo?.windowId === tab.windowId ? [tab] : [],
      );

      browserApiProvider.tab.query.mockResolvedValue([tab]);
      const startup = getFirstListener<() => unknown>(
        browserApiProvider.runtime.onStartup.addListener,
      );
      await startup();
      await openedTabManager.rescheduleOpenTabs();

      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
        idleRecordId(tab.id),
        now + 30 * 60_000,
        expect.any(Number),
      );
    });

    it("starts a fresh delay when a pinned tab becomes eligible", async () => {
      const now = 1_700_000_000_000;
      const lastAccessed = now - 31 * 60_000;
      const deadline = now + 30 * 60_000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      const tab = {
        ...createTestTab(),
        id: 1195,
        windowId: 12,
        pinned: true,
        lastAccessed,
      };
      browserApiProvider.tab.query.mockResolvedValue([tab]);
      mockTabGet(async () => tab);

      await getFirstListener<() => unknown>(
        browserApiProvider.runtime.onStartup.addListener,
      )();
      tab.pinned = false;
      await openedTabManager.rescheduleOpenTabs();

      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
        idleRecordId(tab.id),
        deadline,
        expect.any(Number),
      );
    });

    it("rejects a stale alarm after a tab ID is reused", async () => {
      const oldDeadline = 1_700_000_000_000;
      const newDeadline = oldDeadline + 60_000;
      const oldTab = {
        ...createTestTab(),
        id: 1193,
        url: "https://example.com/old-incarnation",
        windowId: 12,
      };
      const reusedTab = {
        ...oldTab,
        url: "https://example.com/new-incarnation",
      };
      const oldRecord = await createIdleRecord(oldTab, oldDeadline);
      vi.spyOn(Date, "now").mockReturnValue(newDeadline - 30 * 60_000);
      mockTabGet(async () => reusedTab);
      mockTabQuery(async () => [reusedTab]);

      await getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(reusedTab);
      getFirstAlarmListener()(oldRecord.id, oldRecord.revision, oldDeadline);
      await vi.waitFor(async () =>
        expect((await openedTabManager.getCleanupDiagnostics()).events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: "remove-skipped-idle-identity",
            }),
          ]),
        ),
      );

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("rejects an old-revision alarm with the same deadline after manager recreation", async () => {
      const tabId = 1196;
      const deadline = 1_700_000_000_000;
      const tab = { ...createTestTab(), id: tabId };
      const oldRecord = await createIdleRecord(tab, deadline);
      await new IdleTabLedger(browserApiProvider.localStorage).markActive(
        tabId,
      );
      const restartedManager = new OpenedTabManager(
        browserApiProvider,
        tabAlarmManager,
        excludedTabManager,
        protectedSiteManager,
        snoozeManager,
        configurationManager,
        extensionActionManager,
      );
      await restartedManager.watchTabs();
      const alarmListener = (
        tabAlarmManager.onIdleAlarm as unknown as {
          mock: {
            calls: Array<
              [
                (
                  recordId: string,
                  revision: number,
                  scheduledTime: number,
                ) => unknown,
              ]
            >;
          };
        }
      ).mock.calls[1][0];

      alarmListener(oldRecord.id, oldRecord.revision, deadline);
      await Promise.resolve();

      expect(browserApiProvider.tab.get).not.toHaveBeenCalled();
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("rejects a stale alarm while reused-ID cleanup is pending", async () => {
      const tabId = 1197;
      const deadline = 1_700_000_000_000;
      const clearAlarm = createDeferred<void>();
      const inactiveTab = { ...createTestTab(), id: tabId, active: false };
      const record = await createIdleRecord(inactiveTab, deadline);
      const activeTab = { ...inactiveTab, active: true };
      mockTabGet(async () => activeTab);
      tabAlarmManager.clearIdleAlarm.mockReturnValue(clearAlarm.promise);
      const creation = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(activeTab);
      await vi.waitFor(() =>
        expect(tabAlarmManager.clearIdleAlarm).toHaveBeenCalledWith(
          record.id,
          record.revision,
        ),
      );

      getFirstAlarmListener()(record.id, record.revision, deadline);
      await vi.waitFor(async () =>
        expect((await openedTabManager.getCleanupDiagnostics()).events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: "remove-skipped-stale-lifecycle",
            }),
          ]),
        ),
      );
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();

      clearAlarm.resolve();
      await creation;
    });

    it("rejects an old same-deadline alarm before creation cleanup advances generation", async () => {
      const tabId = 1199;
      const deadline = 1_700_000_000_000;
      const replacement = {
        ...createTestTab(),
        id: tabId,
        windowId: 12,
      };
      const record = await createIdleRecord(replacement, deadline);
      const generationWrite = createDeferred<void>();
      browserApiProvider.sessionStorage.set.mockReturnValueOnce(
        generationWrite.promise,
      );
      mockTabGet(async () => replacement);
      mockTabQuery(async () => [replacement]);

      const creation = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(replacement);
      await vi.waitFor(() =>
        expect(browserApiProvider.sessionStorage.set).toHaveBeenCalledWith({
          tabGenerations: JSON.stringify({ [tabId]: 1 }),
        }),
      );

      getFirstAlarmListener()(record.id, record.revision, deadline);
      await Promise.resolve();

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      generationWrite.resolve();
      await creation;
    });

    it("rejects tab ID reuse that begins during the final floor query", async () => {
      const tabId = 1200;
      const deadline = 1_700_000_000_000;
      const oldTab = { ...createTestTab(), id: tabId, windowId: 12 };
      const replacement = { ...oldTab };
      const companion = {
        ...createTestTab(),
        id: 1202,
        windowId: oldTab.windowId,
      };
      const floorQuery = createDeferred<ReadonlyArray<chrome.tabs.Tab>>();
      const generationWrite = createDeferred<void>();
      let currentTab = oldTab;
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        tabCountThreshold: 1,
      });
      const record = await createIdleRecord(oldTab, deadline);
      mockTabGet(async () => currentTab);
      mockTabQuery(async (queryInfo) =>
        Object.keys(queryInfo ?? {}).length === 0 ? floorQuery.promise : [],
      );

      getFirstAlarmListener()(record.id, record.revision, deadline);
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.query).toHaveBeenCalledWith({}),
      );

      currentTab = replacement;
      browserApiProvider.sessionStorage.set.mockReturnValueOnce(
        generationWrite.promise,
      );
      const creation = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(replacement);
      floorQuery.resolve([replacement, companion]);
      await Promise.resolve();

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      generationWrite.resolve();
      await creation;
    });

    it("revalidates an idle alarm after eligibility awaits when the ID is reused with the same deadline", async () => {
      const tabId = 1198;
      const deadline = 1_700_000_000_000;
      const oldTab = {
        ...createTestTab(),
        id: tabId,
        windowId: 12,
        lastAccessed: deadline - emptyConfiguration.tabRemovalDelayMin * 60_000,
      };
      const replacement = { ...oldTab };
      const protectedCheck = createDeferred<boolean>();
      let currentTab = oldTab;
      vi.spyOn(Date, "now").mockReturnValue(deadline);
      const record = await createIdleRecord(oldTab, deadline);
      mockTabGet(async () => currentTab);
      mockTabQuery(async () => [currentTab]);
      protectedSiteManager.isProtectedUrl
        .mockReturnValueOnce(protectedCheck.promise)
        .mockResolvedValue(false);

      getFirstAlarmListener()(record.id, record.revision, deadline);
      await vi.waitFor(() =>
        expect(protectedSiteManager.isProtectedUrl).toHaveBeenCalledTimes(1),
      );

      currentTab = replacement;
      const creation = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(replacement);
      await vi.waitFor(() =>
        expect(browserApiProvider.sessionStorage.set).toHaveBeenCalledWith({
          tabGenerations: JSON.stringify({ [tabId]: 1 }),
        }),
      );
      protectedCheck.resolve(false);
      await creation;

      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
        record.id,
        deadline,
        record.revision,
      );
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("persists a deadline across a recreated manager", async () => {
      const storage: Record<string, unknown> = {
        previousActiveTabByWindow: {},
        recentlyRemovedTabs: new CircularQueue(10),
      };
      browserApiProvider.sessionStorage.get.mockImplementation(
        async () => storage,
      );
      const sessionStorageSet = browserApiProvider.sessionStorage
        .set as unknown as {
        mockImplementation: (
          implementation: (items: object) => Promise<void>,
        ) => void;
      };
      sessionStorageSet.mockImplementation(async (items) => {
        Object.assign(storage, items);
      });
      const tab = { ...createTestTab(), id: 1194, windowId: 12 };
      mockTabGet(async () => tab);
      mockTabQuery(async () => [tab]);
      const startup = getFirstListener<() => unknown>(
        browserApiProvider.runtime.onStartup.addListener,
      );
      await startup();

      const restartedManager = new OpenedTabManager(
        browserApiProvider,
        tabAlarmManager,
        excludedTabManager,
        protectedSiteManager,
        snoozeManager,
        configurationManager,
        extensionActionManager,
      );
      await restartedManager.watchTabs();
      const restartedStartup = (
        browserApiProvider.runtime.onStartup.addListener as unknown as {
          mock: { calls: Array<[() => unknown]> };
        }
      ).mock.calls[1][0];
      await restartedStartup();

      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledTimes(2);
      expect(tabAlarmManager.setIdleAlarm.mock.calls[1]).toEqual(
        tabAlarmManager.setIdleAlarm.mock.calls[0],
      );
    });
    it("restores the same absolute deadline from lastAccessed on every reconciliation", async () => {
      const now = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      const tab = {
        ...createTestTab(),
        id: 1201,
        windowId: 12,
        lastAccessed: now - 10 * 60_000,
      };
      browserApiProvider.tab.query.mockResolvedValue([tab]);
      mockTabGet(async () => tab);

      const startupListener = getFirstListener<() => unknown>(
        browserApiProvider.runtime.onStartup.addListener,
      );
      await startupListener();
      await startupListener();

      const deadline =
        tab.lastAccessed + emptyConfiguration.tabRemovalDelayMin * 60_000;
      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledTimes(2);
      expect(tabAlarmManager.setIdleAlarm).toHaveBeenLastCalledWith(
        idleRecordId(tab.id),
        deadline,
        expect.any(Number),
      );
    });

    it("keeps an overdue deadline below the floor and restores it above the floor", async () => {
      const now = 1_700_000_000_000;
      const deadline = now - 60_000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      const tab = { ...createTestTab(), id: 1301, windowId: 13 };
      await createIdleRecord(tab, deadline);
      configurationManager.get.mockReturnValue(
        Promise.resolve({ ...emptyConfiguration, tabCountThreshold: 2 }),
      );
      mockTabGet(async () => tab);
      let visibleCount = 2;
      mockTabQuery(async (queryInfo) => {
        if (
          queryInfo?.windowId === tab.windowId ||
          Object.keys(queryInfo ?? {}).length === 0
        ) {
          return Array.from({ length: visibleCount }, (_, index) =>
            index === 0 ? tab : { ...createTestTab(), windowId: tab.windowId },
          );
        }
        return [tab];
      });

      const startup = getFirstListener<() => unknown>(
        browserApiProvider.runtime.onStartup.addListener,
      );
      await startup();
      visibleCount = 3;
      await openedTabManager.rescheduleOpenTabs();

      expect(tabAlarmManager.clearIdleAlarm).toHaveBeenCalledWith(
        idleRecordId(tab.id),
        expect.any(Number),
      );
      expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
        idleRecordId(tab.id),
        deadline,
        expect.any(Number),
      );
    });

    it("reconciles an overdue tab after a different tab opens without resetting its deadline", async () => {
      const now = 1_700_000_000_000;
      const deadline = now - 60_000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      const overdueTab = { ...createTestTab(), id: 1302, windowId: 13 };
      const newTab = { ...createTestTab(), id: 1303, windowId: 13 };
      await createIdleRecord(overdueTab, deadline);
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        tabCountThreshold: 2,
      });
      let tabs = [overdueTab, { ...createTestTab(), id: 1304, windowId: 13 }];
      mockTabGet(async (tabId) => {
        const tab = tabs.find((candidate) => candidate.id === tabId);
        if (!tab) throw new Error(`Unexpected tab ${tabId}`);
        return tab;
      });
      mockTabQuery(async (queryInfo) => {
        if (queryInfo?.windowId === overdueTab.windowId) return tabs;
        return tabs;
      });

      await getFirstListener<() => unknown>(
        browserApiProvider.runtime.onStartup.addListener,
      )();
      tabs = [...tabs, newTab];
      await getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(newTab);

      await vi.waitFor(() =>
        expect(tabAlarmManager.setIdleAlarm).toHaveBeenCalledWith(
          idleRecordId(overdueTab.id),
          deadline,
          expect.any(Number),
        ),
      );
    });

    it.each([
      ["activation", "onActivated"],
      ["removal", "onRemoved"],
    ] as const)("clears the inactive age on %s", async (_, eventName) => {
      const tabId = 1401;
      const ledger = new IdleTabLedger(browserApiProvider.localStorage);
      await createIdleRecord(
        { ...createTestTab(), id: tabId, windowId: 14 },
        1_700_000_000_000,
      );

      if (eventName === "onActivated") {
        await getFirstListener<(info: chrome.tabs.TabActiveInfo) => unknown>(
          browserApiProvider.tab.onActivated.addListener,
        )({ tabId, windowId: 14 });
      } else {
        await getFirstListener<
          (id: TabId, info: chrome.tabs.TabRemoveInfo) => unknown
        >(browserApiProvider.tab.onRemoved.addListener)(tabId, {
          windowId: 14,
          isWindowClosing: false,
        });
      }

      if (eventName === "onActivated") {
        await expect(ledger.getBoundRecord(tabId)).resolves.toMatchObject({
          deadline: undefined,
        });
      } else {
        await expect(ledger.getBoundRecord(tabId)).resolves.toBeNull();
      }
    });
  });

  describe("global duplicate cleanup", () => {
    it("matches duplicate URLs locally instead of through a query pattern", async () => {
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      const source = {
        ...createTestTab(),
        id: 1489,
        windowId: 15,
        url: "https://m.youtube.com/watch?v=abc&t=1",
      };
      const duplicate = { ...source, id: 1490, active: false };
      const otherVideo = {
        ...duplicate,
        id: 1492,
        url: "https://m.youtube.com/watch?v=xyz",
      };
      mockTabQuery(async (queryInfo) => {
        if (queryInfo?.url) throw new Error("url filters are unreliable");
        if (isDuplicateQuery(queryInfo)) return [duplicate, otherVideo];
        if (queryInfo?.windowId === source.windowId) {
          return [source, duplicate, otherVideo];
        }
        return [];
      });
      mockTabGet(async (tabId) => {
        if (tabId === duplicate.id) return duplicate;
        throw new Error("not found");
      });

      await getFirstListener<
        (
          id: TabId,
          info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: source.url },
        source,
      );

      await vi.waitFor(() =>
        expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(
          duplicate.id,
        ),
      );
      expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1);
    });

    it("aborts duplicate cleanup when configuration cannot be read", async () => {
      configurationManager.get.mockRejectedValue(new Error("storage offline"));
      const source = {
        ...createTestTab(),
        id: 1491,
        url: "https://example.com/config-failure",
      };

      await expect(
        getFirstListener<
          (
            id: TabId,
            info: chrome.tabs.TabChangeInfo,
            tab: chrome.tabs.Tab,
          ) => unknown
        >(browserApiProvider.tab.onUpdated.addListener)(
          source.id,
          { url: source.url },
          source,
        ),
      ).resolves.toBeUndefined();

      expect(browserApiProvider.tab.query).not.toHaveBeenCalledWith({
        active: false,
      });
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("finds duplicates globally and applies the floor to each duplicate window", async () => {
      configurationManager.get.mockReturnValue(
        Promise.resolve({
          ...emptyConfiguration,
          removeExactDuplicates: true,
          tabCountThreshold: 2,
        }),
      );
      const source = {
        ...createTestTab(),
        id: 1501,
        windowId: 15,
        url: "https://example.com",
      };
      const duplicate = {
        ...createTestTab(),
        id: 1502,
        windowId: 16,
        url: source.url,
      };
      const companion = { ...createTestTab(), id: 1503, windowId: 16 };
      const active = {
        ...createTestTab(),
        id: 1504,
        windowId: 16,
        active: true,
      };
      let openTabs = [source, duplicate, companion, active];
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) {
          return queryInfo.windowId === undefined ? [source, duplicate] : [];
        }
        if (queryInfo?.windowId === duplicate.windowId) {
          return openTabs.filter((tab) => tab.windowId === duplicate.windowId);
        }
        return [];
      });
      mockTabGet(async (id) => {
        const tab = openTabs.find((candidate) => candidate.id === id);
        if (!tab) throw new Error("not found");
        return tab;
      });
      mockTabRemove(async (id) => {
        openTabs = openTabs.filter((tab) => tab.id !== id);
      });

      await getFirstListener<
        (
          id: TabId,
          info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: source.url },
        source,
      );

      expect(browserApiProvider.tab.query).toHaveBeenCalledWith({
        active: false,
      });
      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(duplicate.id);
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalledWith(source.id);
      expect(extensionActionManager.setBadgeCounter).toHaveBeenCalledTimes(1);
      expect(await openedTabManager.getRecentlyClosed()).toHaveLength(1);
    });

    it("does not remove query matches with a different URL fragment", async () => {
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      const source = {
        ...createTestTab(),
        id: 1505,
        windowId: 15,
        url: "https://example.com/page#source",
      };
      const fragmentMatch = {
        ...createTestTab(),
        id: 1506,
        windowId: 15,
        url: "https://example.com/page#other",
      };
      mockTabGet(async () => fragmentMatch);
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [source, fragmentMatch];
        if (queryInfo?.windowId === fragmentMatch.windowId) {
          return [source, fragmentMatch];
        }
        return [];
      });

      await getFirstListener<
        (
          id: TabId,
          info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: source.url },
        source,
      );

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("records one removal when a duplicate cleanup races its alarm", async () => {
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      const source = {
        ...createTestTab(),
        id: 1551,
        windowId: 15,
        url: "https://example.com/race",
      };
      const duplicate = {
        ...createTestTab(),
        id: 1552,
        windowId: 15,
        url: source.url,
      };
      let openTabs = [source, duplicate];
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [source, duplicate];
        if (Object.keys(queryInfo ?? {}).length === 0) return openTabs;
        return [];
      });
      mockTabGet(async (id) => {
        const tab = openTabs.find((candidate) => candidate.id === id);
        if (!tab) throw new Error("tab already removed");
        return tab;
      });
      mockTabRemove(async (id) => {
        openTabs = openTabs.filter((tab) => tab.id !== id);
      });

      const duplicateCleanup = getFirstListener<
        (
          id: TabId,
          info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: source.url },
        source,
      );
      const record = await createIdleRecord(duplicate);
      getFirstAlarmListener()(record.id, record.revision, record.deadline ?? 0);

      await duplicateCleanup;
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1),
      );

      expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1);
      expect(extensionActionManager.setBadgeCounter).toHaveBeenCalledTimes(1);
      expect(await openedTabManager.getRecentlyClosed()).toHaveLength(1);
    });

    it("rejects a duplicate candidate whose tab ID is reused after discovery", async () => {
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      const source = {
        ...createTestTab(),
        id: 1553,
        windowId: 15,
        url: "https://example.com/reused-duplicate",
      };
      const duplicate = {
        ...createTestTab(),
        id: 1554,
        windowId: 15,
        url: source.url,
      };
      const replacement = {
        ...duplicate,
        url: "https://example.com/replacement",
      };
      const protectedCheck = createDeferred<boolean>();
      let currentCandidate = duplicate;
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [source, duplicate];
        if (queryInfo?.windowId === duplicate.windowId) {
          return [source, currentCandidate];
        }
        return [];
      });
      mockTabGet(async () => currentCandidate);
      protectedSiteManager.isProtectedUrl
        .mockReturnValueOnce(protectedCheck.promise)
        .mockResolvedValue(false);

      const duplicateCleanup = getFirstListener<
        (
          id: TabId,
          info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: source.url },
        source,
      );
      await vi.waitFor(() =>
        expect(protectedSiteManager.isProtectedUrl).toHaveBeenCalledTimes(1),
      );

      currentCandidate = replacement;
      const creation = getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(replacement);
      await vi.waitFor(() =>
        expect(browserApiProvider.sessionStorage.set).toHaveBeenCalledWith({
          tabGenerations: JSON.stringify({ [replacement.id]: 1 }),
        }),
      );
      protectedCheck.resolve(false);
      await duplicateCleanup;
      await creation;

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("rejects a stale duplicate query when the candidate ID is reused before selection", async () => {
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      const source = {
        ...createTestTab(),
        id: 1555,
        windowId: 15,
        url: "https://example.com/stale-query",
      };
      const duplicate = {
        ...createTestTab(),
        id: 1556,
        windowId: 15,
        url: source.url,
      };
      const replacement = {
        ...duplicate,
        url: "https://example.com/query-replacement",
      };
      const duplicateQuery = createDeferred<ReadonlyArray<chrome.tabs.Tab>>();
      let currentCandidate = duplicate;
      let duplicateQueries = 0;
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) {
          duplicateQueries += 1;
          return duplicateQueries === 1 ? duplicateQuery.promise : [];
        }
        if (queryInfo?.windowId === duplicate.windowId) {
          return [source, currentCandidate];
        }
        return [];
      });
      mockTabGet(async () => currentCandidate);

      const duplicateCleanup = getFirstListener<
        (
          id: TabId,
          info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: source.url },
        source,
      );
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.query).toHaveBeenCalledWith({
          active: false,
        }),
      );

      currentCandidate = replacement;
      await getFirstListener<(tab: chrome.tabs.Tab) => unknown>(
        browserApiProvider.tab.onCreated.addListener,
      )(replacement);
      duplicateQuery.resolve([source, duplicate]);
      await duplicateCleanup;

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });

    it("rejects a duplicate candidate that navigates during final validation", async () => {
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
        tabCountThreshold: 1,
      });
      const source = {
        ...createTestTab(),
        id: 1557,
        windowId: 15,
        url: "https://example.com/discovered-url",
      };
      const duplicate = {
        ...createTestTab(),
        id: 1558,
        windowId: 15,
        url: source.url,
      };
      const navigated = {
        ...duplicate,
        url: "https://example.com/navigated-url",
      };
      const candidateLookup = createDeferred<chrome.tabs.Tab>();
      let currentCandidate = duplicate;
      mockTabGet(async () => candidateLookup.promise);
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [source, duplicate];
        return [];
      });

      const cleanup = getFirstListener<
        (
          id: TabId,
          info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: source.url },
        source,
      );
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(duplicate.id),
      );

      currentCandidate = navigated;
      await getFirstListener<
        (
          id: TabId,
          info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => unknown
      >(browserApiProvider.tab.onUpdated.addListener)(
        navigated.id,
        { url: navigated.url },
        navigated,
      );
      candidateLookup.resolve(navigated);
      await cleanup;

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
    });
  });

  describe("post-removal bookkeeping", () => {
    const prepareIdleRemoval = async (tabId: TabId, deadline: number) => {
      const tab = { ...createTestTab(), id: tabId, windowId: 17 };
      const record = await createIdleRecord(tab, deadline);
      mockTabGet(async () => tab);
      mockTabQuery(async () => [tab]);
      return { record, tab };
    };

    it("accepts late idle alarms and one-millisecond Safari rounding only", async () => {
      const deadline = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockReturnValue(
        deadline - emptyConfiguration.tabRemovalDelayMin * 60_000,
      );
      const tabs = [
        { ...createTestTab(), id: 1573, windowId: 17 },
        { ...createTestTab(), id: 1574, windowId: 17 },
        { ...createTestTab(), id: 1575, windowId: 17 },
      ];
      const records: Awaited<ReturnType<typeof createIdleRecord>>[] = [];
      for (const tab of tabs) {
        records.push(await createIdleRecord(tab, deadline));
      }
      mockTabGet(
        async (tabId) =>
          tabs.find((tab) => tab.id === tabId) as chrome.tabs.Tab,
      );
      mockTabQuery(async () => tabs);

      getFirstAlarmListener()(records[0].id, records[0].revision, deadline + 1);
      getFirstAlarmListener()(records[1].id, records[1].revision, deadline - 1);
      getFirstAlarmListener()(records[2].id, records[2].revision, deadline - 2);

      await vi.waitFor(() =>
        expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(2),
      );
      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(1573);
      expect(browserApiProvider.tab.remove).toHaveBeenCalledWith(1574);
      expect(browserApiProvider.tab.remove).not.toHaveBeenCalledWith(1575);
    });

    it("persists history once when the badge update fails", async () => {
      const tabId = 1571;
      const deadline = 1_700_000_000_000;
      const { record } = await prepareIdleRemoval(tabId, deadline);
      extensionActionManager.setBadgeCounter.mockRejectedValue(
        new Error("badge unavailable"),
      );

      getFirstAlarmListener()(record.id, record.revision, deadline);

      await vi.waitFor(() =>
        expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1),
      );
      await vi.waitFor(async () =>
        expect(await openedTabManager.getRecentlyClosed()).toHaveLength(1),
      );
      expect(extensionActionManager.setBadgeCounter).toHaveBeenCalledTimes(1);
      expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1);
    });

    it("increments the badge once when history persistence fails", async () => {
      const tabId = 1572;
      const deadline = 1_700_000_000_000;
      const { record } = await prepareIdleRemoval(tabId, deadline);
      const sessionStorageSet = browserApiProvider.sessionStorage
        .set as unknown as {
        mockImplementation: (
          implementation: (items: object) => Promise<void>,
        ) => void;
        mock: { calls: Array<[object]> };
      };
      sessionStorageSet.mockImplementation(async (items) => {
        if ("recentlyRemovedTabs" in items) {
          throw new Error("history unavailable");
        }
      });

      getFirstAlarmListener()(record.id, record.revision, deadline);

      await vi.waitFor(() =>
        expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1),
      );
      await vi.waitFor(() =>
        expect(extensionActionManager.setBadgeCounter).toHaveBeenCalledTimes(1),
      );
      const historyWrites = sessionStorageSet.mock.calls.filter(
        ([items]) => "recentlyRemovedTabs" in items,
      );
      expect(historyWrites).toHaveLength(1);
      expect(browserApiProvider.tab.remove).toHaveBeenCalledTimes(1);
    });
  });

  describe("automatic-removal safety", () => {
    const cases: Array<
      [
        string,
        Partial<chrome.tabs.Tab>,
        { excluded?: boolean; protected?: boolean; snoozed?: boolean },
      ]
    > = [
      ["active", { active: true }, {}],
      ["pinned", { pinned: true }, {}],
      ["audible", { audible: true }, {}],
      ["grouped", { groupId: 7 }, {}],
      ["excluded", {}, { excluded: true }],
      ["protected", {}, { protected: true }],
      ["missing URL", { url: undefined }, {}],
    ];

    it.each(cases)(
      "does not retry an alarm immediately when its tab is %s",
      async (_, tabOverrides, safeguards) => {
        const recordTab = {
          ...createTestTab(),
          id: 1601,
          windowId: 16,
        };
        const tab = {
          ...recordTab,
          ...tabOverrides,
        };
        const record = await createIdleRecord(recordTab);
        excludedTabManager.isExcluded.mockResolvedValue(
          safeguards.excluded ?? false,
        );
        protectedSiteManager.isProtectedUrl.mockResolvedValue(
          safeguards.protected ?? false,
        );
        snoozeManager.isSnoozed.mockResolvedValue(safeguards.snoozed ?? false);
        mockTabGet(async () => tab);
        mockTabQuery(async (queryInfo) =>
          queryInfo?.windowId === tab.windowId ? [tab] : [],
        );

        getFirstAlarmListener()(
          record.id,
          record.revision,
          record.deadline ?? 0,
        );
        await vi.waitFor(() =>
          expect(browserApiProvider.tab.get).toHaveBeenCalledWith(tab.id),
        );

        expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
        expect(tabAlarmManager.setIdleAlarm).not.toHaveBeenCalled();
      },
    );

    it("does not auto-close an unrecoverable URL after an idle alarm", async () => {
      const tab = {
        ...createTestTab(),
        id: 1602,
        windowId: 16,
        url: "chrome://settings/",
      };
      const deadline = 1_700_000_000_000;
      const record = await createIdleRecord(tab, deadline);
      mockTabGet(async () => tab);
      mockTabQuery(async (queryInfo) =>
        queryInfo?.windowId === tab.windowId ? [tab] : [],
      );

      getFirstAlarmListener()(record.id, record.revision, deadline);
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(tab.id),
      );

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      expect(extensionActionManager.setBadgeCounter).not.toHaveBeenCalled();
      await expect(openedTabManager.getRecentlyClosed()).resolves.toEqual([]);
    });

    it("does not auto-close a missing URL after an idle alarm", async () => {
      const tab = {
        ...createTestTab(),
        id: 1606,
        url: undefined,
        windowId: 16,
      };
      const deadline = 1_700_000_000_000;
      const record = await createIdleRecord(
        { ...tab, url: "https://example.com/previous-url" },
        deadline,
      );
      mockTabGet(async () => tab);
      mockTabQuery(async (queryInfo) =>
        queryInfo?.windowId === tab.windowId ? [tab] : [],
      );

      getFirstAlarmListener()(record.id, record.revision, deadline);
      await vi.waitFor(() =>
        expect(browserApiProvider.tab.get).toHaveBeenCalledWith(tab.id),
      );

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      expect(extensionActionManager.setBadgeCounter).not.toHaveBeenCalled();
      await expect(openedTabManager.getRecentlyClosed()).resolves.toEqual([]);
    });

    it("does not auto-close a duplicate with an unrecoverable URL", async () => {
      const source = {
        ...createTestTab(),
        id: 1603,
        windowId: 16,
        url: "chrome://settings/",
      };
      const duplicate = { ...source, id: 1604 };
      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });
      mockTabGet(async () => duplicate);
      mockTabQuery(async (queryInfo) => {
        if (isDuplicateQuery(queryInfo)) return [source, duplicate];
        if (queryInfo?.windowId === source.windowId) return [source, duplicate];
        return [];
      });

      await getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: source.url },
        source,
      );

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      expect(extensionActionManager.setBadgeCounter).not.toHaveBeenCalled();
      await expect(openedTabManager.getRecentlyClosed()).resolves.toEqual([]);
    });

    it("does not write history or increment the badge for a duplicate update without a URL", async () => {
      const source = {
        ...createTestTab(),
        id: 1605,
        windowId: 16,
        url: undefined,
      };

      configurationManager.get.mockResolvedValue({
        ...emptyConfiguration,
        removeExactDuplicates: true,
      });

      await getFirstListener<
        (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => Promise<void>
      >(browserApiProvider.tab.onUpdated.addListener)(
        source.id,
        { url: undefined },
        source,
      );

      expect(browserApiProvider.tab.remove).not.toHaveBeenCalled();
      expect(extensionActionManager.setBadgeCounter).not.toHaveBeenCalled();
      await expect(openedTabManager.getRecentlyClosed()).resolves.toEqual([]);
    });
  });

  function createTestTab(): chrome.tabs.Tab & { id: number } {
    return {
      audible: false,
      active: false,
      autoDiscardable: false,
      discarded: false,
      groupId: -1,
      highlighted: false,
      id: Math.floor(Math.random() * 1000),
      incognito: false,
      index: 0,
      pinned: false,
      selected: false,
      url: "https://example.com/",
      windowId: 0,
    };
  }
});
