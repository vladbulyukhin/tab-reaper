import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyConfiguration } from "../../common/models/Configuration";
import { logInfo } from "../utils/log";
import { BackgroundService } from "./BackgroundService";

vi.mock("../utils/log", () => ({
  debugBroadcast: vi.fn(),
  logInfo: vi.fn(),
}));

type StartHarness = {
  service: BackgroundService;
  ensureAlarmScheduled: ReturnType<typeof vi.fn>;
  onEnded: ReturnType<typeof vi.fn>;
  rescheduleOpenTabs: ReturnType<typeof vi.fn>;
  setDiagnosticsEnabled: ReturnType<typeof vi.fn>;
};

const createStartHarness = (): StartHarness => {
  const service = Object.create(
    BackgroundService.prototype,
  ) as BackgroundService;
  const ensureAlarmScheduled = vi.fn(async () => undefined);
  const onEnded = vi.fn();
  const rescheduleOpenTabs = vi.fn(async () => undefined);
  const setDiagnosticsEnabled = vi.fn(async () => undefined);

  Reflect.set(service, "snoozeManager", {
    ensureAlarmScheduled,
    onEnded,
  });
  Reflect.set(service, "openedTabManager", {
    restoreHistoryBadge: vi.fn(async () => undefined),
    rescheduleOpenTabs,
    setDiagnosticsEnabled,
    watchTabs: vi.fn(async () => undefined),
  });
  Reflect.set(service, "configurationManager", {
    get: vi.fn(async () => emptyConfiguration),
  });
  vi.spyOn(service, "registerMessageHandlers").mockImplementation(() => {});

  return {
    service,
    ensureAlarmScheduled,
    onEnded,
    rescheduleOpenTabs,
    setDiagnosticsEnabled,
  };
};

type MessageHandler = (
  payload: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => Promise<void>;

const createCurrentSiteHarness = (url: string) => {
  const service = Object.create(
    BackgroundService.prototype,
  ) as BackgroundService;
  const onMessage = vi.fn();
  const list = vi.fn(async () => ["example.com"]);
  const add = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  const rescheduleOpenTabs = vi.fn(async () => undefined);
  const exclude = vi.fn(async () => undefined);
  const include = vi.fn(async () => undefined);
  const forgetSavedKeeps = vi.fn(async () => 1);
  const queryTabs = vi.fn(async () => [{ id: 1, url }]);
  const isExcluded = vi.fn(async () => false);
  const keepDiagnostics: Array<{
    details: Record<string, unknown>;
    event: string;
  }> = [];
  const recordKeepStateDiagnostic = vi.fn(
    (event: string, details: Record<string, unknown>) => {
      keepDiagnostics.push({ details, event });
    },
  );
  const clearRecentlyClosed = vi.fn(async () => undefined);
  const syncRecentlyClosedPersistence = vi.fn(async () => undefined);
  const setDiagnosticsEnabled = vi.fn(async () => undefined);
  let configuration = emptyConfiguration;
  const getConfiguration = vi.fn(async () => configuration);
  const saveConfiguration = vi.fn(async (update) => {
    configuration = { ...configuration, ...update };
  });

  Reflect.set(service, "messageService", { onMessage, listen: vi.fn() });
  Reflect.set(service, "browserApiProvider", {
    tab: {
      query: queryTabs,
    },
  });
  Reflect.set(service, "protectedSiteManager", { list, add, remove });
  Reflect.set(service, "excludedTabManager", {
    exclude,
    include,
    isExcluded,
    forgetSavedKeeps,
  });
  Reflect.set(service, "configurationManager", {
    get: getConfiguration,
    save: saveConfiguration,
  });
  Reflect.set(service, "openedTabManager", {
    beginSafetyMutation: vi.fn(() => vi.fn()),
    clearRecentlyClosed,
    recordKeepStateDiagnostic,
    rescheduleOpenTabs,
    setDiagnosticsEnabled,
    syncRecentlyClosedPersistence,
  });

  service.registerMessageHandlers();

  const getHandler = (type: string): MessageHandler => {
    const call = onMessage.mock.calls.find(([messageType]) => {
      return messageType === type;
    });
    if (!call) {
      throw new Error(`Message handler ${type} was not registered`);
    }
    return call[1] as MessageHandler;
  };

  return {
    service,
    forgetSavedKeeps,
    queryTabs,
    getHandler,
    list,
    add,
    remove,
    rescheduleOpenTabs,
    isExcluded,
    exclude,
    include,
    keepDiagnostics,
    clearRecentlyClosed,
    setDiagnosticsEnabled,
  };
};

describe("saved Keep recovery", () => {
  it("does not modify Keeps when the visible-tab query fails", async () => {
    const harness = createCurrentSiteHarness("https://example.com/");
    harness.queryTabs
      .mockResolvedValueOnce([{ id: 1, url: "https://example.com/" }])
      .mockRejectedValueOnce(new Error("query unavailable"));
    const response = vi.fn();
    await harness.getHandler("forgetCurrentTabSavedKeeps")({}, {}, response);
    expect(harness.forgetSavedKeeps).not.toHaveBeenCalled();
    expect(response).toHaveBeenCalledWith({ status: "error", cleared: 0 });
  });

  it("passes the address and visible tabs to explicit recovery", async () => {
    const harness = createCurrentSiteHarness("https://example.com/");
    const response = vi.fn();
    await harness.getHandler("forgetCurrentTabSavedKeeps")({}, {}, response);
    expect(harness.forgetSavedKeeps).toHaveBeenCalledWith(
      1,
      [{ id: 1, url: "https://example.com/" }],
      "https://example.com/",
    );
    expect(response).toHaveBeenCalledWith({ status: "ok", cleared: 1 });
  });

  it("reports unavailable pause status instead of pretending cleanup is unpaused", async () => {
    const harness = createCurrentSiteHarness("https://example.com/");
    Reflect.set(harness.service, "snoozeManager", {
      getStatus: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
    });
    const response = vi.fn();
    await harness.getHandler("getSnoozeStatus")({}, {}, response);
    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });
});

describe("BackgroundService.start snooze integration", () => {
  beforeEach(() => {
    vi.mocked(logInfo).mockClear();
  });

  it("registers the end listener before startup reconciliation", () => {
    const { service, ensureAlarmScheduled, onEnded } = createStartHarness();
    const order: string[] = [];
    onEnded.mockImplementation(() => {
      order.push("listener");
    });
    ensureAlarmScheduled.mockImplementation(async () => {
      order.push("reconcile");
    });

    service.start();

    expect(order).toEqual(["listener", "reconcile"]);
  });

  it("reconciles open tabs when every background instance starts", async () => {
    const { service, rescheduleOpenTabs, setDiagnosticsEnabled } =
      createStartHarness();

    service.start();

    await vi.waitFor(() => expect(rescheduleOpenTabs).toHaveBeenCalledTimes(1));
    expect(setDiagnosticsEnabled).toHaveBeenCalledWith(false);
    expect(setDiagnosticsEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      rescheduleOpenTabs.mock.invocationCallOrder[0],
    );
  });

  it("logs a rejected startup reconciliation", async () => {
    const { service, ensureAlarmScheduled } = createStartHarness();
    const error = new Error("storage unavailable");
    ensureAlarmScheduled.mockRejectedValueOnce(error);

    service.start();

    await vi.waitFor(() =>
      expect(logInfo).toHaveBeenCalledWith(
        "Failed to reconcile snooze state",
        error,
      ),
    );
  });

  it("logs a rejected reschedule after snooze ends", async () => {
    const { service, onEnded, rescheduleOpenTabs } = createStartHarness();
    const error = new Error("reschedule failed");
    rescheduleOpenTabs
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(error);
    service.start();
    await vi.waitFor(() => expect(rescheduleOpenTabs).toHaveBeenCalledOnce());
    const handleEnded = onEnded.mock.calls[0]?.[0] as (() => void) | undefined;

    handleEnded?.();

    await vi.waitFor(() =>
      expect(logInfo).toHaveBeenCalledWith(
        "Failed to reschedule tabs after snooze ended",
        error,
      ),
    );
  });
});

describe("BackgroundService current-site protocol support", () => {
  it("applies a diagnostics preference before rescheduling tabs", async () => {
    const { getHandler, rescheduleOpenTabs, setDiagnosticsEnabled } =
      createCurrentSiteHarness("https://example.com/current");
    const sendResponse = vi.fn();

    await getHandler("setConfig")(
      { diagnosticsEnabled: false },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
    expect(setDiagnosticsEnabled).toHaveBeenCalledWith(false);
    expect(setDiagnosticsEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      rescheduleOpenTabs.mock.invocationCallOrder[0],
    );
    expect(rescheduleOpenTabs).toHaveBeenCalledTimes(2);
  });

  it("clears recently closed tabs through the popup protocol", async () => {
    const { getHandler, clearRecentlyClosed } = createCurrentSiteHarness(
      "https://example.com/current",
    );
    const sendResponse = vi.fn();

    await getHandler("clearRecentlyClosedTabs")(
      {},
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(clearRecentlyClosed).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
  });

  it("checks the current exclusion against the current tab URL", async () => {
    const { getHandler, isExcluded, keepDiagnostics } =
      createCurrentSiteHarness("https://example.com/current");
    const sendResponse = vi.fn();

    await getHandler("isCurrentTabExcluded")(
      {},
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(isExcluded).toHaveBeenCalledWith(1, "https://example.com/current");
    expect(sendResponse).toHaveBeenCalledWith(false);
    expect(keepDiagnostics).toEqual([
      {
        details: {
          excluded: false,
          tab: { id: 1, url: "https://example.com/current" },
        },
        event: "keep-state-read",
      },
    ]);
  });

  it("records the resolved tab and stored state for a Keep write", async () => {
    const service = Object.create(
      BackgroundService.prototype,
    ) as BackgroundService;
    const onMessage = vi.fn();
    let excluded = false;
    const diagnostics: Array<{
      details: Record<string, unknown>;
      event: string;
    }> = [];
    Reflect.set(service, "messageService", { onMessage, listen: vi.fn() });
    Reflect.set(service, "browserApiProvider", {
      tab: {
        query: vi.fn(async () => [
          { id: 231020, url: "https://dashboard.example" },
        ]),
      },
    });
    Reflect.set(service, "excludedTabManager", {
      exclude: vi.fn(async () => {
        excluded = true;
      }),
      include: vi.fn(async () => {
        excluded = false;
      }),
      isExcluded: vi.fn(async () => excluded),
    });
    Reflect.set(service, "openedTabManager", {
      beginSafetyMutation: vi.fn(() => vi.fn()),
      rescheduleOpenTabs: vi.fn(async () => undefined),
      recordKeepStateDiagnostic: (
        event: string,
        details: Record<string, unknown>,
      ) => diagnostics.push({ details, event }),
    });
    Reflect.set(service, "protectedSiteManager", {});
    service.registerMessageHandlers();
    const handler = onMessage.mock.calls.find(
      ([messageType]) => messageType === "setCurrentTabExcluded",
    )?.[1] as MessageHandler;
    const sendResponse = vi.fn();

    await handler(
      { excluded: true },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
    expect(diagnostics).toEqual([
      {
        details: {
          requestedExcluded: true,
          tab: { id: 231020, url: "https://dashboard.example" },
        },
        event: "keep-state-write-requested",
      },
      {
        details: {
          requestedExcluded: true,
          storedExcluded: true,
          tab: { id: 231020, url: "https://dashboard.example" },
        },
        event: "keep-state-write-completed",
      },
    ]);
  });

  it("rejects a Keep write when the stored state differs from the request", async () => {
    const { getHandler, keepDiagnostics } = createCurrentSiteHarness(
      "https://example.com/current",
    );
    const sendResponse = vi.fn();

    await getHandler("setCurrentTabExcluded")(
      { excluded: true },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({ status: "error" });
    expect(keepDiagnostics).toContainEqual({
      details: {
        requestedExcluded: true,
        storedExcluded: false,
        tab: { id: 1, url: "https://example.com/current" },
      },
      event: "keep-state-write-failed",
    });
  });

  it("reports extension pages as unsupported without reading protected sites", async () => {
    const { getHandler, list } = createCurrentSiteHarness(
      "chrome-extension://extension-id/src/popup/index.html",
    );
    const sendResponse = vi.fn();

    await getHandler("isCurrentSiteProtected")(
      {},
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({
      protected: false,
      hostname: null,
      supported: false,
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("normalizes HTTPS hostnames and matches stored parent rules", async () => {
    const { getHandler, list } = createCurrentSiteHarness(
      "https://WWW.Example.COM./article",
    );
    const sendResponse = vi.fn();

    await getHandler("isCurrentSiteProtected")(
      {},
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(list).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      protected: true,
      hostname: "www.example.com",
      supported: true,
    });
  });

  it("reports a valid HTTPS page as supported when protected-site reads fail", async () => {
    const { getHandler, list } = createCurrentSiteHarness(
      "https://www.example.com/article",
    );
    const sendResponse = vi.fn();
    list.mockRejectedValueOnce(new Error("storage unavailable"));

    await getHandler("isCurrentSiteProtected")(
      {},
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({
      protected: false,
      hostname: "www.example.com",
      supported: true,
    });
  });

  it("delegates HTTP protection additions and removals with a normalized hostname", async () => {
    const { getHandler, list, add, remove, rescheduleOpenTabs } =
      createCurrentSiteHarness("http://Sub.Example.COM./path");
    const sendResponse = vi.fn();
    const handler = getHandler("setCurrentSiteProtected");
    list.mockResolvedValueOnce(["example.com"]).mockResolvedValueOnce([]);

    await handler(
      { protected: true },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    await handler(
      { protected: false },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(add).toHaveBeenCalledWith("sub.example.com");
    expect(remove).toHaveBeenCalledWith("sub.example.com");
    expect(rescheduleOpenTabs).toHaveBeenCalledTimes(4);
    expect(sendResponse).toHaveBeenNthCalledWith(1, {
      status: "ok",
      protected: true,
      hostname: "sub.example.com",
      supported: true,
    });
    expect(sendResponse).toHaveBeenNthCalledWith(2, {
      status: "ok",
      protected: false,
      hostname: "sub.example.com",
      supported: true,
    });
  });

  it("reports remaining parent-rule protection after removing a child rule", async () => {
    const { getHandler, list, remove } = createCurrentSiteHarness(
      "https://blog.example.com/article",
    );
    const sendResponse = vi.fn();
    let sites = ["example.com", "blog.example.com"];
    remove.mockImplementation(async () => {
      sites = sites.filter((site) => site !== "blog.example.com");
    });
    list.mockImplementation(async () => sites);

    await getHandler("setCurrentSiteProtected")(
      { protected: false },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(remove).toHaveBeenCalledWith("blog.example.com");
    expect(list).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      status: "ok",
      protected: true,
      hostname: "blog.example.com",
      supported: true,
    });
  });

  it("reschedules inactive tabs before confirming a removed protected rule", async () => {
    const { getHandler, remove, rescheduleOpenTabs } = createCurrentSiteHarness(
      "https://example.com/article",
    );
    const sendResponse = vi.fn();

    await getHandler("removeProtectedSite")(
      { hostname: "example.com" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(remove).toHaveBeenCalledWith("example.com");
    expect(rescheduleOpenTabs).toHaveBeenCalledTimes(2);
    expect(rescheduleOpenTabs.mock.invocationCallOrder[0]).toBeLessThan(
      sendResponse.mock.invocationCallOrder[0],
    );
    expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
  });

  it("returns an error when rescheduling after a current-site unprotect fails", async () => {
    const { getHandler, remove, rescheduleOpenTabs } = createCurrentSiteHarness(
      "https://example.com/article",
    );
    const sendResponse = vi.fn();
    rescheduleOpenTabs.mockRejectedValueOnce(new Error("alarm unavailable"));

    await getHandler("setCurrentSiteProtected")(
      { protected: false },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(remove).toHaveBeenCalledWith("example.com");
    expect(sendResponse).toHaveBeenCalledWith({
      status: "error",
      protected: false,
      hostname: "example.com",
      supported: true,
    });
  });

  it("reports a valid HTTPS page as supported when protection mutation fails", async () => {
    const { getHandler, add } = createCurrentSiteHarness(
      "https://www.example.com/article",
    );
    const sendResponse = vi.fn();
    add.mockRejectedValueOnce(new Error("storage unavailable"));

    await getHandler("setCurrentSiteProtected")(
      { protected: true },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({
      status: "error",
      protected: false,
      hostname: "www.example.com",
      supported: true,
    });
  });

  it("rejects protection changes for browser pages", async () => {
    const { getHandler, add, remove } =
      createCurrentSiteHarness("chrome://settings/");
    const sendResponse = vi.fn();

    await getHandler("setCurrentSiteProtected")(
      { protected: true },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({
      status: "error",
      protected: false,
      hostname: null,
      supported: false,
    });
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("reports malformed current-tab URLs as unsupported", async () => {
    const { getHandler, list } = createCurrentSiteHarness("not a valid URL");
    const sendResponse = vi.fn();

    await getHandler("isCurrentSiteProtected")(
      {},
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({
      protected: false,
      hostname: null,
      supported: false,
    });
    expect(list).not.toHaveBeenCalled();
  });
});

describe("BackgroundService temporary cleanup diagnostics", () => {
  it("returns the cleanup snapshot produced by the tab manager", async () => {
    const service = Object.create(
      BackgroundService.prototype,
    ) as BackgroundService;
    const onMessage = vi.fn();
    const snapshot = {
      events: [],
      queries: { allTabs: [], inactiveTabs: [] },
    };
    Reflect.set(service, "messageService", { onMessage, listen: vi.fn() });
    Reflect.set(service, "openedTabManager", {
      getCleanupDiagnostics: vi.fn(async () => snapshot),
    });

    service.registerMessageHandlers();
    const handler = onMessage.mock.calls.find(
      ([messageType]) => messageType === "getCleanupDiagnostics",
    )?.[1] as MessageHandler | undefined;
    const sendResponse = vi.fn();

    await handler?.({}, {} as chrome.runtime.MessageSender, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(snapshot);
  });

  it("clears the cleanup diagnostic event history", async () => {
    const service = Object.create(
      BackgroundService.prototype,
    ) as BackgroundService;
    const onMessage = vi.fn();
    let resolveClear: (() => void) | undefined;
    const clearCleanupDiagnostics = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveClear = resolve;
        }),
    );
    Reflect.set(service, "messageService", { onMessage, listen: vi.fn() });
    Reflect.set(service, "openedTabManager", { clearCleanupDiagnostics });

    service.registerMessageHandlers();
    const handler = onMessage.mock.calls.find(
      ([messageType]) => messageType === "clearCleanupDiagnostics",
    )?.[1] as MessageHandler | undefined;
    const sendResponse = vi.fn();

    const clearing = handler?.(
      {},
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(clearCleanupDiagnostics).toHaveBeenCalledOnce();
    expect(sendResponse).not.toHaveBeenCalled();
    resolveClear?.();
    await clearing;
    expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
  });
});
