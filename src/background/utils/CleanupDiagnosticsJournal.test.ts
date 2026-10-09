import { describe, expect, it, vi } from "vitest";
import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import { CleanupDiagnosticsJournal } from "./CleanupDiagnosticsJournal";

type StorageDouble = IBrowserStorageAPI & {
  values: Record<string, unknown>;
};

const createStorage = (): StorageDouble => {
  const storage = {} as StorageDouble;
  storage.values = {};
  storage.clear = vi.fn(async () => {
    storage.values = {};
  });
  storage.get = vi.fn(async (defaults?: Record<string, unknown>) => ({
    ...defaults,
    ...storage.values,
  })) as StorageDouble["get"];
  storage.onChanged = {
    addListener: vi.fn(),
    hasListener: vi.fn(),
    hasListeners: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as chrome.storage.StorageChangedEvent;
  storage.remove = vi.fn(async (keys: string | string[]) => {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      delete storage.values[key];
    }
  });
  storage.set = vi.fn(async (items: Record<string, unknown>) => {
    storage.values = { ...storage.values, ...items };
  });
  return storage;
};

describe("CleanupDiagnosticsJournal", () => {
  it("does not read or write event storage while disabled", async () => {
    const storage = createStorage();
    const journal = new CleanupDiagnosticsJournal(storage, 100, false);

    journal.record({ at: "time", event: "ignored" });

    await expect(journal.list()).resolves.toEqual([]);
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("clears prior events and ignores later records when disabled", async () => {
    const storage = createStorage();
    const journal = new CleanupDiagnosticsJournal(storage);
    journal.record({ at: "time", event: "scheduled" });
    await journal.list();

    await journal.setEnabled(false);
    journal.record({ at: "later", event: "ignored" });

    await expect(journal.list()).resolves.toEqual([]);
    expect(storage.values.cleanupDiagnosticsEvents).toBeUndefined();
  });

  it("restores ordered events in a new background instance", async () => {
    const storage = createStorage();
    const first = new CleanupDiagnosticsJournal(storage);
    first.record({ at: "2026-08-13T20:00:00.000Z", event: "scheduled" });
    first.record({ at: "2026-08-13T20:01:00.000Z", event: "alarm-fired" });
    await first.list();

    const reloaded = new CleanupDiagnosticsJournal(storage);

    await expect(reloaded.list()).resolves.toEqual([
      { at: "2026-08-13T20:00:00.000Z", event: "scheduled" },
      { at: "2026-08-13T20:01:00.000Z", event: "alarm-fired" },
    ]);
  });

  it("keeps only the 100 most recent events", async () => {
    const journal = new CleanupDiagnosticsJournal(createStorage());
    for (let index = 0; index < 101; index++) {
      journal.record({ at: `time-${index}`, event: `event-${index}` });
    }

    const events = await journal.list();

    expect(events).toHaveLength(100);
    expect(events[0]).toEqual({ at: "time-1", event: "event-1" });
    expect(events[99]).toEqual({ at: "time-100", event: "event-100" });
  });

  it("clears persisted events after pending writes", async () => {
    const storage = createStorage();
    const journal = new CleanupDiagnosticsJournal(storage);
    journal.record({ at: "time", event: "scheduled" });

    await journal.clear();

    await expect(
      new CleanupDiagnosticsJournal(storage).list(),
    ).resolves.toEqual([]);
  });

  it("sanitizes nested URLs before writing them to storage", async () => {
    const storage = createStorage();
    const journal = new CleanupDiagnosticsJournal(storage);
    journal.record({
      at: "time",
      details: {
        tabs: [
          { url: "https://example.com/private/path?q=secret#fragment" },
          { url: "safari-web-extension://identifier/page.html" },
        ],
      },
      event: "query",
    });

    await journal.list();

    expect(storage.values.cleanupDiagnosticsEvents).toBe(
      JSON.stringify([
        {
          at: "time",
          details: {
            tabs: [
              { url: "https://example.com" },
              { url: "safari-web-extension:" },
            ],
          },
          event: "query",
        },
      ]),
    );
  });

  it("keeps current-process evidence when storage is unavailable", async () => {
    const storage = createStorage();
    storage.get = vi.fn(async () => {
      throw new Error("storage unavailable");
    }) as StorageDouble["get"];
    const journal = new CleanupDiagnosticsJournal(storage);
    journal.record({ at: "time", event: "alarm-fired" });

    await expect(journal.list()).resolves.toEqual([
      { at: "time", event: "alarm-fired" },
    ]);
  });
});
