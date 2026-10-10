import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import { createSharedStorage } from "../utils/SharedStorageDouble";
import { IdleTabLedger, savedKeepLifetimeMs } from "./IdleTabLedger";

type StorageDouble = IBrowserStorageAPI & {
  values: Record<string, unknown>;
};

type ChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
) => void;

// Like browser storage, values are copied and every write is announced.
const createStorage = (): StorageDouble => {
  const storage = {} as StorageDouble;
  const listeners = new Set<ChangeListener>();
  storage.values = {};
  storage.clear = vi.fn(async () => {
    storage.values = {};
  });
  storage.get = vi.fn(async (defaults?: Record<string, unknown>) => ({
    ...defaults,
    ...storage.values,
  })) as StorageDouble["get"];
  storage.onChanged = {
    addListener: vi.fn((listener: ChangeListener) => listeners.add(listener)),
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
    const copied = structuredClone(items);
    storage.values = { ...storage.values, ...copied };
    const changes = Object.fromEntries(
      Object.entries(copied).map(([key, newValue]) => [
        key,
        { newValue: structuredClone(newValue) },
      ]),
    );
    for (const listener of listeners) listener(changes);
  }) as StorageDouble["set"];
  return storage;
};

const tab = (id: number, url: string, index = 0): chrome.tabs.Tab =>
  ({ id, index, url, windowId: 1, active: false }) as chrome.tabs.Tab;

describe("IdleTabLedger", () => {
  it("only forgets unverified same-address Keeps after explicit recovery", async () => {
    const store = createStorage();
    const ledger = new IdleTabLedger(store);
    const hidden = tab(1, "https://same.example/");
    const visible = tab(2, "https://same.example/", 1);
    const unrelated = tab(3, "https://other.example/");
    await ledger.reconcile([hidden, visible, unrelated]);
    await ledger.setKept(1, true);
    await ledger.setKept(2, true);
    await ledger.setKept(3, true);
    await ledger.reconcile([tab(4, "https://same.example/")]);
    expect(await ledger.isProtected(4)).toBe(true);
    expect(
      await ledger.forgetSavedKeeps(
        4,
        new Set([2, 4]),
        "https://other.example/",
      ),
    ).toBe(0);
    expect(
      await ledger.forgetSavedKeeps(
        4,
        new Set([2, 4]),
        "https://same.example/",
      ),
    ).toBe(1);
    expect(await ledger.isKept(2)).toBe(true);
    expect(await ledger.isKept(3)).toBe(true);
    expect(await ledger.isProtected(4)).toBe(true);
    expect(
      await ledger.forgetSavedKeeps(4, new Set([4]), "https://same.example/"),
    ).toBe(1);
    expect(await ledger.isProtected(4)).toBe(false);
    await ledger.reconcile([tab(5, "https://same.example/")]);
    expect(await ledger.isProtected(5)).toBe(false);
  });
  it("resets a malformed ledger, keeps a backup, and leaves a notice", async () => {
    const bad = { version: 1, salt: "existing", records: [{ kept: true }] };
    const store = createStorage();
    store.values.idleTabLedger = bad;
    const ledger = new IdleTabLedger(store);

    await ledger.reconcile([tab(1, "https://reset.example/")]);

    expect(store.values.idleTabLedgerCorrupt).toEqual(bad);
    expect(store.values.idleTabLedger).toMatchObject({
      version: 1,
      records: [expect.objectContaining({ tabId: 1, kept: false })],
    });
    expect(await ledger.hasResetNotice()).toBe(true);
    await ledger.dismissResetNotice();
    expect(await ledger.hasResetNotice()).toBe(false);
  });

  it("expires saved Keeps that no open tab has matched for 30 days", async () => {
    const store = createStorage();
    const ledger = new IdleTabLedger(store);
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      await ledger.reconcile([
        tab(1, "https://open.example/"),
        tab(2, "https://closed.example/", 1),
      ]);
      await ledger.setKept(1, true);
      await ledger.setKept(2, true);
      await ledger.detachTab(2);

      spy.mockReturnValue(now + savedKeepLifetimeMs - 1);
      await ledger.reconcile([tab(1, "https://open.example/")]);
      await ledger.reconcile([tab(3, "https://closed.example/")]);
      expect(await ledger.isProtected(3)).toBe(true);
      await ledger.removeTab(3);

      spy.mockReturnValue(now + 2 * savedKeepLifetimeMs);
      await ledger.reconcile([tab(1, "https://open.example/")]);
      await ledger.reconcile([tab(4, "https://closed.example/")]);
      expect(await ledger.isProtected(4)).toBe(false);
      expect(await ledger.isKept(1)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not restore an ordinary deadline while a hidden kept tab has the same URL", async () => {
    const store = createStorage();
    const ledger = new IdleTabLedger(store);
    const kept = tab(1, "https://shared.example/");
    const ordinary = { ...kept, id: 2, index: 1 };
    await ledger.reconcile([kept, ordinary]);
    await ledger.setKept(1, true);
    await ledger.ensureInactive(ordinary, 1);
    const restarted = new IdleTabLedger(store);
    await restarted.reconcile([{ ...kept, id: 3 }]);
    expect(await restarted.isProtected(3)).toBe(true);
    expect((await restarted.getBoundRecord(3))?.deadline).toBeUndefined();
    expect(await restarted.isKept(1)).toBe(true);
  });
  let storage: StorageDouble;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T06:00:00.000Z"));
    storage = createStorage();
  });

  it("preserves the original Keep and protects an uncertain same-URL group tab", async () => {
    const ledger = new IdleTabLedger(storage);
    const original = tab(1, "https://same.example/");
    const other = { ...tab(2, original.url as string), windowId: 2 };
    await ledger.reconcile([original]);
    await ledger.setKept(1, true);
    await ledger.reconcile([other]);
    await ledger.reconcile([original, other]);
    expect(await ledger.isKept(1)).toBe(true);
    expect(await ledger.isProtected(2)).toBe(true);
    expect(await ledger.isKept(2)).toBe(false);
    const restarted = new IdleTabLedger(storage);
    expect(await restarted.isProtected(2)).toBe(true);
  });

  it("releases dependent safety holds when their kept source is closed", async () => {
    const ledger = new IdleTabLedger(storage);
    const original = tab(1, "https://same.example/");
    await ledger.reconcile([original]);
    await ledger.setKept(1, true);
    await ledger.reconcile([{ ...original, id: 2 }]);
    expect(await ledger.isProtected(2)).toBe(true);
    await ledger.removeTab(1);
    expect(await ledger.isProtected(2)).toBe(false);
    await ledger.reconcile([{ ...original, id: 3 }]);
    expect(await ledger.isProtected(3)).toBe(false);
  });

  it("releases a hold only after all of its explicit Keep sources are cleared", async () => {
    const ledger = new IdleTabLedger(storage);
    const original = tab(1, "https://same.example/");
    await ledger.reconcile([original, { ...original, id: 2, index: 1 }]);
    await ledger.setKept(1, true);
    await ledger.setKept(2, true);
    await ledger.reconcile([{ ...original, id: 3 }]);
    await ledger.setKept(1, false);
    expect(await ledger.isProtected(3)).toBe(true);
    await ledger.setKept(2, false);
    expect(await new IdleTabLedger(storage).isProtected(3)).toBe(false);
  });

  it("does not let a legacy orphaned hold protect newly opened tabs", async () => {
    const ledger = new IdleTabLedger(storage);
    const original = tab(1, "https://same.example/");
    await ledger.reconcile([original]);
    const saved = storage.values.idleTabLedger as {
      records: Array<{ uncertainKeep?: boolean }>;
    };
    saved.records[0].uncertainKeep = true;
    await storage.set({ idleTabLedger: saved });
    const restarted = new IdleTabLedger(storage);
    expect(await restarted.isProtected(1)).toBe(false);
    await restarted.reconcile([{ ...original, id: 2 }]);
    expect(await restarted.isProtected(2)).toBe(false);
  });

  it("reads the durable state by key using Chrome storage semantics", async () => {
    const originalGet = storage.get;
    storage.get = vi.fn(async (keys?: unknown) =>
      typeof keys === "string" ? originalGet(keys) : {},
    ) as StorageDouble["get"];
    const originalTab = tab(127, "https://lyrics.example/");
    const firstLedger = new IdleTabLedger(storage);
    await firstLedger.reconcile([originalTab]);
    await firstLedger.ensureInactive(originalTab, 30 * 60_000);

    const restartedLedger = new IdleTabLedger(storage);

    await expect(restartedLedger.getBoundRecord(127)).resolves.toMatchObject({
      tabId: 127,
    });
  });

  it("starts a full countdown when leaving a long-used active tab", async () => {
    const ledger = new IdleTabLedger(storage);
    const active = {
      ...tab(1, "https://active.example/"),
      active: true,
      lastAccessed: Date.now() - 40 * 60_000,
    };
    await ledger.reconcile([active]);
    await ledger.markActive(1);
    await ledger.markInactive(1);
    const record = await ledger.ensureInactive(
      { ...active, active: false },
      30 * 60_000,
    );
    expect(record.deadline).toBe(Date.now() + 30 * 60_000);
  });

  it("resets existing inactive deadlines from the configuration change time", async () => {
    const originalTab = {
      ...tab(127, "https://lyrics.example/"),
      lastAccessed: Date.now() - 10 * 60_000,
    };
    const ledger = new IdleTabLedger(storage);
    await ledger.reconcile([originalTab]);
    const original = await ledger.ensureInactive(originalTab, 30 * 60_000);
    const originalRevision = original.revision;
    vi.advanceTimersByTime(5 * 60_000);

    await ledger.resetDeadlines(5 * 60_000);

    await expect(ledger.getBoundRecord(127)).resolves.toMatchObject({
      deadline: Date.now() + 5 * 60_000,
      revision: originalRevision + 1,
    });
  });

  it("keeps the original deadline when a uniquely matching URL receives a new tab ID", async () => {
    const firstLedger = new IdleTabLedger(storage);
    const originalTab = tab(127, "https://lyrics.example/");

    await firstLedger.reconcile([originalTab]);
    const original = await firstLedger.ensureInactive(originalTab, 30 * 60_000);

    vi.advanceTimersByTime(10 * 60_000);
    const restartedLedger = new IdleTabLedger(storage);
    const restoredTab = tab(63, "https://lyrics.example/");
    await restartedLedger.reconcile([restoredTab]);

    expect(await restartedLedger.getBoundRecord(63)).toMatchObject({
      deadline: original.deadline,
      id: original.id,
      tabId: 63,
    });
  });

  it("does not let a reused numeric tab ID inherit a different URL deadline", async () => {
    const firstLedger = new IdleTabLedger(storage);
    const originalTab = tab(127, "https://lyrics.example/");
    await firstLedger.reconcile([originalTab]);
    const original = await firstLedger.ensureInactive(originalTab, 30 * 60_000);

    vi.advanceTimersByTime(10 * 60_000);
    const restartedLedger = new IdleTabLedger(storage);
    const replacementTab = tab(127, "https://listings.example/");
    await restartedLedger.reconcile([replacementTab]);
    const replacement = await restartedLedger.ensureInactive(
      replacementTab,
      30 * 60_000,
    );

    expect(replacement.id).not.toBe(original.id);
    expect(replacement.deadline).toBe(Date.now() + 30 * 60_000);
    await expect(
      restartedLedger.resolveAlarm(
        original.id,
        original.revision,
        original.deadline as number,
      ),
    ).resolves.toBeNull();
  });

  it("pairs restored duplicate URLs by their occurrence order", async () => {
    const firstLedger = new IdleTabLedger(storage);
    const firstDuplicate = tab(10, "https://example.com/", 0);
    const secondDuplicate = tab(11, "https://example.com/", 1);
    await firstLedger.reconcile([firstDuplicate, secondDuplicate]);
    const firstRecord = await firstLedger.ensureInactive(
      firstDuplicate,
      30 * 60_000,
    );
    vi.advanceTimersByTime(1_000);
    const secondRecord = await firstLedger.ensureInactive(
      secondDuplicate,
      30 * 60_000,
    );

    const restartedLedger = new IdleTabLedger(storage);
    await restartedLedger.reconcile([
      tab(110, "https://example.com/", 0),
      tab(111, "https://example.com/", 1),
    ]);

    expect((await restartedLedger.getBoundRecord(110))?.id).toBe(
      firstRecord.id,
    );
    expect((await restartedLedger.getBoundRecord(111))?.id).toBe(
      secondRecord.id,
    );
  });

  it("invalidates an idle alarm when its bound tab becomes active", async () => {
    const ledger = new IdleTabLedger(storage);
    const inactiveTab = tab(72, "https://example.com/");
    await ledger.reconcile([inactiveTab]);
    const scheduled = await ledger.ensureInactive(inactiveTab, 30 * 60_000);

    await ledger.markActive(72);

    await expect(
      ledger.resolveAlarm(
        scheduled.id,
        scheduled.revision,
        scheduled.deadline as number,
      ),
    ).resolves.toBeNull();
  });

  it("accepts an overdue alarm that iOS delivers after clamping its timestamp", async () => {
    const ledger = new IdleTabLedger(storage);
    const inactiveTab = tab(74, "https://example.com/");
    await ledger.reconcile([inactiveTab]);
    const scheduled = await ledger.ensureInactive(inactiveTab, 5 * 60_000);

    await expect(
      ledger.resolveAlarm(
        scheduled.id,
        scheduled.revision,
        (scheduled.deadline as number) + 3 * 60_000,
      ),
    ).resolves.toMatchObject({
      id: scheduled.id,
      revision: scheduled.revision,
      tabId: inactiveTab.id,
    });
  });

  it("rejects an alarm delivered before its stored deadline", async () => {
    const ledger = new IdleTabLedger(storage);
    const inactiveTab = tab(75, "https://example.com/");
    await ledger.reconcile([inactiveTab]);
    const scheduled = await ledger.ensureInactive(inactiveTab, 5 * 60_000);

    await expect(
      ledger.resolveAlarm(
        scheduled.id,
        scheduled.revision,
        (scheduled.deadline as number) - 2,
      ),
    ).resolves.toBeNull();
  });

  it("removes the durable record when a tab is explicitly closed", async () => {
    const ledger = new IdleTabLedger(storage);
    const inactiveTab = tab(73, "https://example.com/");
    await ledger.reconcile([inactiveTab]);
    await ledger.ensureInactive(inactiveTab, 30 * 60_000);

    await ledger.removeTab(73);

    await expect(ledger.getBoundRecord(73)).resolves.toBeNull();
  });

  it("uses the browser last-accessed time for a newly observed inactive tab", async () => {
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    const ledger = new IdleTabLedger(storage);

    const record = await ledger.ensureInactive(
      {
        ...tab(27, "https://example.com/"),
        lastAccessed: now - 10_000,
      } as chrome.tabs.Tab,
      30_000,
    );

    expect(record.deadline).toBe(now + 20_000);
  });

  it("does not detach another tab's keep state while scheduling a newly observed tab", async () => {
    const ledger = new IdleTabLedger(storage);
    const keptTab = tab(31, "https://kept.example/");
    await ledger.reconcile([keptTab]);
    await ledger.setKept(31, true);
    const keptRecord = await ledger.getBoundRecord(31);

    await ledger.ensureInactive(tab(32, "https://new.example/"), 30_000);

    await expect(ledger.getBoundRecord(31)).resolves.toMatchObject({
      id: keptRecord?.id,
      kept: true,
      tabId: 31,
    });
    await expect(ledger.isKept(31, "https://kept.example/")).resolves.toBe(
      true,
    );
  });

  it("restores keep state and deadlines when a tab-group context returns", async () => {
    const firstLedger = new IdleTabLedger(storage);
    const groupA = Array.from({ length: 10 }, (_, index) =>
      tab(index + 1, `https://a${index}.example/`, index),
    );
    await firstLedger.reconcile(groupA);
    await firstLedger.ensureInactive(groupA[4], 30_000);
    await firstLedger.setKept(groupA[4].id as number, true);

    const groupB = Array.from({ length: 5 }, (_, index) =>
      tab(index + 101, `https://b${index}.example/`, index),
    );
    await new IdleTabLedger(storage).reconcile(groupB);

    const restoredGroupA = groupA.map((entry, index) => ({
      ...entry,
      id: index + 201,
      windowId: 20,
    }));
    const restoredLedger = new IdleTabLedger(storage);
    await restoredLedger.reconcile(restoredGroupA);

    await expect(restoredLedger.getBoundRecord(205)).resolves.toMatchObject({
      kept: false,
      uncertainKeep: true,
      tabId: 205,
    });
    expect(await restoredLedger.isProtected(205)).toBe(true);
  });

  it("does not transfer keep state between indistinguishable restored windows", async () => {
    const firstLedger = new IdleTabLedger(storage);
    const firstWindow = [
      tab(1, "https://one.example/", 0),
      tab(2, "https://kept.example/", 1),
    ];
    const secondWindow = firstWindow.map((entry, index) => ({
      ...entry,
      id: index + 11,
      windowId: 2,
    }));
    await firstLedger.reconcile([...firstWindow, ...secondWindow]);
    await firstLedger.setKept(2, true);

    const restored = [
      ...firstWindow.map((entry, index) => ({
        ...entry,
        id: index + 101,
        windowId: 10,
      })),
      ...secondWindow.map((entry, index) => ({
        ...entry,
        id: index + 111,
        windowId: 11,
      })),
    ];
    const restoredLedger = new IdleTabLedger(storage);
    await restoredLedger.reconcile(restored);

    await expect(restoredLedger.isKept(102)).resolves.toBe(false);
    await expect(restoredLedger.isKept(112)).resolves.toBe(false);
    expect(await restoredLedger.isProtected(102)).toBe(true);
    expect(await restoredLedger.isProtected(112)).toBe(true);
  });

  it("keeps a live kept tab through a redirect", async () => {
    const ledger = new IdleTabLedger(storage);
    const original = tab(71, "https://before.example/");
    await ledger.reconcile([original]);
    await ledger.setKept(71, true);

    await ledger.reconcile(
      [{ ...original, url: "https://after.example/" }],
      new Set([71]),
    );

    await expect(ledger.isKept(71, "https://after.example/")).resolves.toBe(
      true,
    );
  });

  it("keeps another context's Keep when its change event arrives late", async () => {
    const shared = createSharedStorage();
    const firstStorage = shared.context();
    const first = new IdleTabLedger(firstStorage);
    const tabs = [
      tab(81, "https://one.example/"),
      tab(82, "https://two.example/", 1),
    ];
    await first.reconcile(tabs);
    await first.setKept(81, true);

    const second = new IdleTabLedger(shared.context());
    await second.setKept(82, true);
    await first.markInactive(81);
    firstStorage.deliver();

    const fresh = new IdleTabLedger(shared.context());
    await expect(fresh.isKept(81)).resolves.toBe(true);
    await expect(fresh.isKept(82)).resolves.toBe(true);
    await expect(first.isKept(82)).resolves.toBe(true);
  });
});
