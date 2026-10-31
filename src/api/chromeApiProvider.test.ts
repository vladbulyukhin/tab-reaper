import { describe, expect, it, vi } from "vitest";
import { createBrowserApiProvider } from "./chromeApiProvider";
import type { ExtensionApi, ResolvedExtensionApi } from "./extensionApi";

const asResolved = (
  api: object,
  type: ResolvedExtensionApi["type"],
): ResolvedExtensionApi => ({ api: api as ExtensionApi, type });

const createEvent = () => ({ addListener: () => undefined });

const createApi = (overrides: object = {}) => ({
  action: {},
  alarms: { onAlarm: createEvent() },
  runtime: {
    onInstalled: createEvent(),
    onMessage: createEvent(),
    onStartup: createEvent(),
  },
  storage: {
    local: { onChanged: createEvent() },
  },
  tabs: {
    onActivated: createEvent(),
    onCreated: createEvent(),
    onRemoved: createEvent(),
    onUpdated: createEvent(),
  },
  ...overrides,
});

describe("createBrowserApiProvider", () => {
  it("binds browser Promise methods to their owning object", async () => {
    const tabs = {
      ...createApi().tabs,
      query(this: { marker: string }) {
        return Promise.resolve(this.marker);
      },
      marker: "tabs",
    };

    const provider = createBrowserApiProvider(
      asResolved(createApi({ tabs }), "browser"),
    );

    await expect(provider.tab.query({})).resolves.toBe("tabs");
  });

  it("binds Chrome callback methods to their owning object", async () => {
    const tabs = {
      ...createApi().tabs,
      query(
        this: { marker: string },
        _query: object,
        callback: (value: string) => void,
      ) {
        callback(this.marker);
      },
      marker: "tabs",
    };

    const provider = createBrowserApiProvider(
      asResolved(createApi({ tabs }), "chrome"),
    );

    await expect(provider.tab.query({})).resolves.toBe("tabs");
  });

  it("rejects synchronous API throws", async () => {
    const tabs = {
      ...createApi().tabs,
      query() {
        throw new Error("sync failure");
      },
    };

    const provider = createBrowserApiProvider(
      asResolved(createApi({ tabs }), "browser"),
    );

    await expect(provider.tab.query({})).rejects.toThrow("sync failure");
  });

  it("rejects Chrome callback operations with runtime.lastError", async () => {
    const error = { message: "Chrome failed" };
    const runtime = {
      ...createApi().runtime,
      lastError: error,
    };
    const tabs = {
      ...createApi().tabs,
      query(_query: object, callback: (value: string) => void) {
        callback("ignored");
      },
    };

    const provider = createBrowserApiProvider(
      asResolved(createApi({ runtime, tabs }), "chrome"),
    );

    await expect(provider.tab.query({})).rejects.toThrow("Chrome failed");
    await expect(provider.tab.query({})).rejects.toBeInstanceOf(Error);
  });

  it("settles once when a Chrome API returns a Promise and invokes its callback", async () => {
    const tabs = {
      ...createApi().tabs,
      query(_query: object, callback: (value: string) => void) {
        callback("callback result");
        return Promise.resolve("Promise result");
      },
    };

    const provider = createBrowserApiProvider(
      asResolved(createApi({ tabs }), "chrome"),
    );

    await expect(provider.tab.query({})).resolves.toBe("callback result");
  });

  it("resolves a no-callback void API", async () => {
    let calls = 0;
    const alarms = {
      onAlarm: createEvent(),
      create() {
        calls += 1;
      },
    };

    const provider = createBrowserApiProvider(
      asResolved(createApi({ alarms }), "chrome"),
    );

    await expect(provider.alarm.create("alarm", {})).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it("uses isolated worker-memory session storage when session is unavailable", async () => {
    const onChanged = createEvent();
    const getLocal = vi.fn(async () => ({ durable: true }));
    const setLocal = vi.fn(async () => undefined);
    const local = {
      get: getLocal,
      onChanged,
      set: setLocal,
    };
    const resolved = asResolved(createApi({ storage: { local } }), "browser");
    const provider = createBrowserApiProvider(resolved);

    expect(provider.sessionStorageKind).toBe("memory-fallback");

    await expect(
      provider.sessionStorage.get({ missing: "default" }),
    ).resolves.toEqual({ missing: "default" });
    await provider.sessionStorage.set({ transient: 7 });
    await expect(
      provider.sessionStorage.get({
        transient: 0,
        missing: "default",
      }),
    ).resolves.toEqual({ transient: 7, missing: "default" });
    expect(getLocal).not.toHaveBeenCalled();
    expect(setLocal).not.toHaveBeenCalled();

    const restartedProvider = createBrowserApiProvider(resolved);
    await expect(
      restartedProvider.sessionStorage.get({ transient: "empty" }),
    ).resolves.toEqual({ transient: "empty" });
  });

  it("reports native session storage when Safari exposes it", async () => {
    const session = {
      get: vi.fn(async () => ({ transient: 7 })),
      onChanged: createEvent(),
    };
    const local = { onChanged: createEvent() };
    const provider = createBrowserApiProvider(
      asResolved(createApi({ storage: { local, session } }), "browser"),
    );

    expect(provider.sessionStorageKind).toBe("native");
    await expect(provider.sessionStorage.get()).resolves.toEqual({
      transient: 7,
    });
  });

  it("returns the current browser alarm inventory", async () => {
    const alarms = {
      getAll: vi.fn(async () => [
        { name: "tab:7:2", scheduledTime: 1_700_000_000_000 },
      ]),
      onAlarm: createEvent(),
    };
    const provider = createBrowserApiProvider(
      asResolved(createApi({ alarms }), "browser"),
    );

    await expect(provider.alarm.getAll()).resolves.toEqual([
      { name: "tab:7:2", scheduledTime: 1_700_000_000_000 },
    ]);
  });

  it("implements memory session remove, clear, and change events", async () => {
    const provider = createBrowserApiProvider(
      asResolved(createApi(), "browser"),
    );
    const listener = vi.fn();
    provider.sessionStorage.onChanged.addListener(listener);

    await provider.sessionStorage.set({ first: 1, second: 2 });
    await provider.sessionStorage.remove("first");
    await expect(
      provider.sessionStorage.get({ first: 0, second: 0 }),
    ).resolves.toEqual({ first: 0, second: 2 });
    await provider.sessionStorage.clear();
    await expect(
      provider.sessionStorage.get({ second: "empty" }),
    ).resolves.toEqual({ second: "empty" });

    expect(listener).toHaveBeenNthCalledWith(
      1,
      {
        first: { oldValue: undefined, newValue: 1 },
        second: { oldValue: undefined, newValue: 2 },
      },
      "session",
    );
    expect(listener).toHaveBeenNthCalledWith(
      2,
      { first: { oldValue: 1, newValue: undefined } },
      "session",
    );
    expect(listener).toHaveBeenNthCalledWith(
      3,
      { second: { oldValue: 2, newValue: undefined } },
      "session",
    );
  });

  it("uses local storage when sync storage is unavailable", async () => {
    const onChanged = createEvent();
    const local = {
      get() {
        return Promise.resolve("local");
      },
      onChanged,
    };
    const provider = createBrowserApiProvider(
      asResolved(createApi({ storage: { local } }), "browser"),
    );

    expect(provider.syncStorage.onChanged).toBe(onChanged);
    await expect(provider.syncStorage.get()).resolves.toBe("local");
  });

  it("uses browserAction when action is unavailable", async () => {
    let title = "";
    const browserAction = {
      setTitle(details: { title: string }) {
        title = details.title;
        return Promise.resolve();
      },
    };

    const provider = createBrowserApiProvider(
      asResolved(createApi({ action: undefined, browserAction }), "browser"),
    );

    await provider.action.setTitle({ title: "Fallback" });
    expect(title).toBe("Fallback");
  });

  it("resolves missing setBadgeTextColor as a no-op", async () => {
    const provider = createBrowserApiProvider(
      asResolved(createApi({ action: {} }), "browser"),
    );

    await expect(
      provider.action.setBadgeTextColor({ color: "red" }),
    ).resolves.toBeUndefined();
  });

  it("constructs when optional action namespaces are missing", () => {
    expect(() =>
      createBrowserApiProvider(
        asResolved(
          createApi({ action: undefined, browserAction: undefined }),
          "browser",
        ),
      ),
    ).not.toThrow();
  });
});
