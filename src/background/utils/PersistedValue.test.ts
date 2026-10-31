import { describe, expect, it, vi } from "vitest";
import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import { PersistedValue } from "./PersistedValue";
import { createSharedStorage } from "./SharedStorageDouble";

type StorageApiDouble = IBrowserStorageAPI & {
  values: Record<string, unknown>;
  listeners: Array<(changes: Record<string, { newValue?: unknown }>) => void>;
  get: ReturnType<typeof vi.fn> & IBrowserStorageAPI["get"];
};

const createStorage = (
  initial: Record<string, unknown> = {},
): StorageApiDouble => {
  const storage = {} as StorageApiDouble;
  storage.values = { ...initial };
  storage.listeners = [];
  storage.clear = vi.fn(async () => {
    storage.values = {};
  });
  storage.get = vi.fn(async (defaults?: Record<string, unknown>) => ({
    ...defaults,
    ...storage.values,
  })) as StorageApiDouble["get"];
  storage.onChanged = {
    addListener: vi.fn((listener) => storage.listeners.push(listener)),
    hasListener: vi.fn(),
    hasListeners: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as chrome.storage.StorageChangedEvent;
  storage.remove = vi.fn(async () => undefined);
  storage.set = vi.fn(async (items: Record<string, unknown>) => {
    storage.values = { ...storage.values, ...items };
  });

  return storage;
};

describe("PersistedValue", () => {
  it("caches falsey stored values", async () => {
    const storage = createStorage({ enabled: "false" });
    const persistedValue = new PersistedValue<boolean>(
      storage,
      "enabled",
      true,
    );

    await expect(persistedValue.get()).resolves.toBe(false);
    await expect(persistedValue.get()).resolves.toBe(false);
    expect(storage.get).toHaveBeenCalledTimes(1);
  });

  it("reads by key so Chrome does not discard an undefined default", async () => {
    const storage = createStorage({ enabled: "false" });
    const persistedValue = new PersistedValue<boolean>(
      storage,
      "enabled",
      true,
    );

    await persistedValue.get();

    expect(storage.get).toHaveBeenCalledWith("enabled");
  });

  it("invalidates cached data when its key is deleted", async () => {
    const storage = createStorage({ value: "1" });
    const persistedValue = new PersistedValue<number>(storage, "value", 0);

    await expect(persistedValue.get()).resolves.toBe(1);
    storage.values.value = undefined;
    storage.listeners[0]({ value: { newValue: undefined } });

    await expect(persistedValue.get()).resolves.toBe(0);
    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  it("removes its stored value and resets its cache", async () => {
    const storage = createStorage({ value: "1" });
    storage.remove = vi.fn(async (key: string) => {
      delete storage.values[key];
    });
    const persistedValue = new PersistedValue<number>(storage, "value", 0);

    await expect(persistedValue.get()).resolves.toBe(1);
    await persistedValue.remove();

    expect(storage.remove).toHaveBeenCalledWith("value");
    await expect(persistedValue.get()).resolves.toBe(0);
  });

  it("re-reads storage when its key changes instead of adopting the event", async () => {
    const storage = createStorage({ value: "1" });
    const persistedValue = new PersistedValue<number>(storage, "value", 0);

    await expect(persistedValue.get()).resolves.toBe(1);
    storage.values.value = "3";
    storage.listeners[0]({ value: { newValue: "2" } });

    await expect(persistedValue.get()).resolves.toBe(3);
    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  it("does not restore a stale read after a storage change", async () => {
    const storage = createStorage({ value: "1" });
    let resolveRead: ((value: Record<string, unknown>) => void) | undefined;
    const pendingRead = new Promise<Record<string, unknown>>((resolve) => {
      resolveRead = resolve;
    });
    storage.get.mockImplementationOnce(async () => pendingRead);
    const persistedValue = new PersistedValue<number>(storage, "value", 0);

    const pendingValue = persistedValue.get();
    storage.values.value = "2";
    storage.listeners[0]({ value: { newValue: "2" } });
    if (!resolveRead) throw new Error("Expected pending storage read");
    resolveRead({ value: "1" });

    await expect(pendingValue).resolves.toBe(2);
    await expect(persistedValue.get()).resolves.toBe(2);
  });

  it("reads raw structured values and falls back after invalid serialized data", async () => {
    const rawStorage = createStorage({ values: ["a"] });
    const rawPersistedValue = new PersistedValue<ReadonlyArray<string>>(
      rawStorage,
      "values",
      [],
    );
    const invalidStorage = createStorage({ values: "{" });
    const invalidPersistedValue = new PersistedValue<ReadonlyArray<string>>(
      invalidStorage,
      "values",
      [],
    );

    await expect(rawPersistedValue.get()).resolves.toEqual(["a"]);
    await expect(invalidPersistedValue.get()).resolves.toEqual([]);
  });

  it("ignores a late change event that would replace newer data", async () => {
    const shared = createSharedStorage();
    const storage = shared.context();
    const counter = new PersistedValue<number>(storage, "count", 0);

    await counter.update((value) => value + 1);
    await counter.update((value) => value + 1);
    storage.deliver(1);

    await expect(counter.get()).resolves.toBe(2);
    await counter.update((value) => value + 1);
    expect(shared.values().count).toBe("3");
  });

  it("starts each update from storage, not a cache another context outdated", async () => {
    const shared = createSharedStorage();
    const first = new PersistedValue<number>(shared.context(), "count", 0);
    const second = new PersistedValue<number>(shared.context(), "count", 0);

    await expect(first.get()).resolves.toBe(0);
    await second.update((value) => value + 1);
    await first.update((value) => value + 1);

    expect(shared.values().count).toBe("2");
    await expect(first.get()).resolves.toBe(2);
  });
});
