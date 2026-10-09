import { describe, expect, it } from "vitest";
import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { MessageService } from "./MessageService";

type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

class RuntimeHarness {
  private readonly listeners = new Set<RuntimeListener>();
  private response: unknown;

  public addCalls = 0;
  public removeCalls = 0;

  public readonly runtime: Pick<IBrowserApiProvider, "runtime">["runtime"] = {
    onInstalled: {} as chrome.runtime.RuntimeInstalledEvent,
    onMessage: {
      addListener: (listener) => {
        this.addCalls += 1;
        this.listeners.add(listener as RuntimeListener);
      },
      removeListener: (listener) => {
        this.removeCalls += 1;
        this.listeners.delete(listener as RuntimeListener);
      },
    } as chrome.runtime.ExtensionMessageEvent,
    onStartup: {} as chrome.runtime.RuntimeEvent,
    sendMessage: async <M, R>(_message: M) => this.response as R,
  };

  public get listenerCount(): number {
    return this.listeners.size;
  }

  public setSendMessageResponse(response: unknown): void {
    this.response = response;
  }

  public deliver(message: unknown): {
    claimed: boolean | undefined;
    responses: unknown[];
  } {
    const responses: unknown[] = [];
    const [listener] = this.listeners;
    const claimed = listener?.(
      message,
      {} as chrome.runtime.MessageSender,
      (response) => responses.push(response),
    );

    return { claimed, responses };
  }

  public async deliverAsync(message: unknown): Promise<{
    claimed: boolean | undefined;
    responses: unknown[];
  }> {
    const responses: unknown[] = [];
    const [listener] = this.listeners;
    const claimed = listener?.(
      message,
      {} as chrome.runtime.MessageSender,
      (response) => responses.push(response),
    );

    await Promise.resolve();
    return { claimed, responses };
  }
}

const createService = (): [MessageService, RuntimeHarness] => {
  const runtime = new RuntimeHarness();
  return [new MessageService({ runtime: runtime.runtime }), runtime];
};

describe("MessageService", () => {
  it("attaches one runtime listener when listen is called repeatedly", () => {
    const [service, runtime] = createService();

    service.listen();
    service.listen();

    expect(runtime.addCalls).toBe(1);
    expect(runtime.listenerCount).toBe(1);
  });

  it("removes its runtime listener once during cleanup", () => {
    const [service, runtime] = createService();
    const cleanup = service.listen();

    cleanup();
    cleanup();

    expect(runtime.removeCalls).toBe(1);
    expect(runtime.listenerCount).toBe(0);
  });

  it("does not claim malformed messages", () => {
    const [service, runtime] = createService();
    service.listen();

    const result = runtime.deliver({ payload: undefined });

    expect(result.claimed).toBe(false);
    expect(result.responses).toEqual([]);
  });

  it("does not claim unknown string message types", () => {
    const [service, runtime] = createService();
    service.listen();

    const result = runtime.deliver({ type: "not-a-message", payload: null });

    expect(result.claimed).toBe(false);
    expect(result.responses).toEqual([]);
  });

  it("claims a registered synchronous handler and responds once", () => {
    const [service, runtime] = createService();
    service.onMessage(
      "clearCleanupDiagnostics",
      (_payload, _sender, respond) => {
        respond({ status: "ok" });
      },
    );
    service.listen();

    const result = runtime.deliver({
      type: "clearCleanupDiagnostics",
      payload: undefined,
    });

    expect(result.claimed).toBe(true);
    expect(result.responses).toEqual([{ status: "ok" }]);
  });

  it("claims a registered asynchronous handler and responds", async () => {
    const [service, runtime] = createService();
    service.onMessage(
      "clearCleanupDiagnostics",
      async (_payload, _sender, respond) => {
        await Promise.resolve();
        respond({ status: "error" });
      },
    );
    service.listen();

    const result = await runtime.deliverAsync({
      type: "clearCleanupDiagnostics",
      payload: undefined,
    });

    expect(result.claimed).toBe(true);
    expect(result.responses).toEqual([{ status: "error" }]);
  });

  it("returns a transport error when a synchronous handler throws", () => {
    const [service, runtime] = createService();
    service.onMessage("clearCleanupDiagnostics", () => {
      throw new Error("sync handler failed");
    });
    service.listen();

    const result = runtime.deliver({
      type: "clearCleanupDiagnostics",
      payload: undefined,
    });

    expect(result.claimed).toBe(true);
    expect(result.responses).toEqual([
      {
        __tabReaperMessageServiceTransportError: true,
        message: "sync handler failed",
      },
    ]);
  });

  it("returns a transport error when a synchronous handler responds then throws", () => {
    const [service, runtime] = createService();
    service.onMessage(
      "clearCleanupDiagnostics",
      (_payload, _sender, respond) => {
        respond({ status: "ok" });
        throw new Error("sync handler failed after responding");
      },
    );
    service.listen();

    const result = runtime.deliver({
      type: "clearCleanupDiagnostics",
      payload: undefined,
    });

    expect(result.claimed).toBe(true);
    expect(result.responses).toEqual([
      {
        __tabReaperMessageServiceTransportError: true,
        message: "sync handler failed after responding",
      },
    ]);
  });

  it("returns a transport error when an asynchronous handler rejects", async () => {
    const [service, runtime] = createService();
    service.onMessage("clearCleanupDiagnostics", async () => {
      throw new Error("async handler failed");
    });
    service.listen();

    const result = await runtime.deliverAsync({
      type: "clearCleanupDiagnostics",
      payload: undefined,
    });

    expect(result.claimed).toBe(true);
    expect(result.responses).toEqual([
      {
        __tabReaperMessageServiceTransportError: true,
        message: "async handler failed",
      },
    ]);
  });

  it("returns a transport error when an asynchronous handler responds then rejects", async () => {
    const [service, runtime] = createService();
    service.onMessage(
      "clearCleanupDiagnostics",
      async (_payload, _sender, respond) => {
        respond({ status: "error" });
        throw new Error("async handler failed after responding");
      },
    );
    service.listen();

    const result = await runtime.deliverAsync({
      type: "clearCleanupDiagnostics",
      payload: undefined,
    });

    expect(result.claimed).toBe(true);
    expect(result.responses).toEqual([
      {
        __tabReaperMessageServiceTransportError: true,
        message: "async handler failed after responding",
      },
    ]);
  });

  it("uses a fallback transport-error message when rejection conversion throws", async () => {
    const [service, runtime] = createService();
    service.onMessage("clearCleanupDiagnostics", async () => {
      throw {
        toString: () => {
          throw new Error("cannot convert rejection reason");
        },
      };
    });
    service.listen();

    const result = await runtime.deliverAsync({
      type: "clearCleanupDiagnostics",
      payload: undefined,
    });

    expect(result.claimed).toBe(true);
    expect(result.responses).toEqual([
      {
        __tabReaperMessageServiceTransportError: true,
        message: "Message handler failed",
      },
    ]);
  });

  it("returns existing raw successful responses unchanged", async () => {
    const [service, runtime] = createService();
    const response = { status: "ok" };
    runtime.setSendMessageResponse(response);

    await expect(
      service.sendMessage("setConfig", {
        keepAudibleTabs: true,
        keepGroupedTabs: true,
        keepPinnedTabs: true,
        removeExactDuplicates: false,
        tabCountThreshold: 0,
        tabRemovalDelayMin: 10,
      }),
    ).resolves.toBe(response);
  });

  it("rejects received transport errors", async () => {
    const [service, runtime] = createService();
    runtime.setSendMessageResponse({
      __tabReaperMessageServiceTransportError: true,
      message: "background handler failed",
    });

    await expect(
      service.sendMessage("clearCleanupDiagnostics", undefined),
    ).rejects.toThrow("background handler failed");
  });

  it("rejects duplicate live handlers for a message type", () => {
    const [service] = createService();
    service.onMessage("clearCleanupDiagnostics", () => undefined);

    expect(() =>
      service.onMessage("clearCleanupDiagnostics", () => undefined),
    ).toThrow("A handler is already registered for clearCleanupDiagnostics");
  });

  it("allows a type to be registered again after its handler is cleaned up", () => {
    const [service, runtime] = createService();
    const cleanupFirst = service.onMessage(
      "clearCleanupDiagnostics",
      () => undefined,
    );
    cleanupFirst();
    service.onMessage(
      "clearCleanupDiagnostics",
      (_payload, _sender, respond) => {
        respond({ status: "ok" });
      },
    );
    cleanupFirst();
    service.listen();

    const result = runtime.deliver({
      type: "clearCleanupDiagnostics",
      payload: undefined,
    });

    expect(result.responses).toEqual([{ status: "ok" }]);
  });
});
