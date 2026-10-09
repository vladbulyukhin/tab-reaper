import { extensionApi, extensionApiType } from "../../api/extensionApi";

export function logInfo(...args: unknown[]): void {
  if (typeof __DEBUG__ !== "undefined" && __DEBUG__) {
    console.info(`[tab-reaper][${new Date().toISOString()}]`, ...args);
  }
}

export function debugBroadcast(message: string, data?: unknown): void {
  if (typeof __DEBUG__ === "undefined" || !__DEBUG__) {
    return;
  }

  const payload = {
    message,
    data,
    timestamp: new Date().toISOString(),
  };

  try {
    if (extensionApiType === "browser") {
      void extensionApi.runtime?.sendMessage({
        type: "__debug",
        payload,
      });
      return;
    }

    extensionApi.runtime?.sendMessage(
      {
        type: "__debug",
        payload,
      },
      () => undefined,
    );
  } catch {}
}
