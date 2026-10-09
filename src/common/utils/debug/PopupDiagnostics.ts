import { extensionApi } from "../../../api/extensionApi";
import { debugLog } from "../debug";
import type { RuntimeMessage } from "./RuntimeDiagnostics";
import {
  type DiagnosticGlobals,
  type DiagnosticRuntime,
  diagnosticRuntimes,
  logRuntimeEnvironment,
} from "./RuntimeDiagnostics";

async function probePromise(
  name: string,
  runtime: DiagnosticRuntime,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = runtime.sendMessage?.({
      type: "__raw_ping",
      payload: undefined,
    });
    if (result && typeof (result as Promise<unknown>).then === "function") {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("timeout after 1000ms")),
          1000,
        );
      });
      debugLog(
        `[tab-reaper][diag][${name}] promise resp`,
        await Promise.race([result, timeout]),
      );
    } else {
      debugLog(`[tab-reaper][diag][${name}] promise ret`, result);
    }
  } catch (error) {
    debugLog(`[tab-reaper][diag][${name}] promise err`, error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function probeCallback(
  name: string,
  runtime: DiagnosticRuntime,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish("callback timeout"), 1000);

    function finish(event: string, response?: unknown) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      debugLog(
        `[tab-reaper][diag][${name}] ${event}`,
        response,
        runtime.lastError,
      );
      resolve();
    }

    try {
      runtime.sendMessage?.(
        { type: "__raw_ping", payload: undefined },
        (response) => finish("callback resp", response),
      );
    } catch (error) {
      finish("callback err", error);
    }
  });
}

async function probeRuntime(
  name: string,
  runtime: DiagnosticRuntime,
): Promise<void> {
  await probePromise(name, runtime);
  await probeCallback(name, runtime);
}

export function initializePopupDiagnostics(): void {
  if (typeof __DEBUG__ === "undefined" || !__DEBUG__) return;

  const globals = globalThis as DiagnosticGlobals;
  logRuntimeEnvironment(globals);
  if (globals.__TAB_REAPER_DIAG_DONE__) return;
  globals.__TAB_REAPER_DIAG_DONE__ = true;

  // Run after mount; raw probes deliberately bypass the transport adapter.
  setTimeout(() => {
    for (const { name, runtime } of diagnosticRuntimes(globals)) {
      void probeRuntime(name, runtime).catch((error) =>
        debugLog("Runtime probe failed", error),
      );
    }
  }, 0);
}

export function listenForDebugBroadcasts(): () => void {
  if (typeof __DEBUG__ === "undefined" || !__DEBUG__) return () => undefined;

  function listener(message: RuntimeMessage) {
    if (message?.type === "__debug")
      debugLog("[tab-reaper][debug]", message.payload);
  }

  try {
    extensionApi.runtime?.onMessage?.addListener(listener);
  } catch (error) {
    debugLog("Debug broadcast listener unavailable", error);
  }

  return () => {
    try {
      extensionApi.runtime?.onMessage?.removeListener(listener);
    } catch (error) {
      debugLog("Debug broadcast listener cleanup failed", error);
    }
  };
}
