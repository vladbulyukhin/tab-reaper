import { debugLog } from "../../common/utils/debug";
import {
  type DiagnosticGlobals,
  diagnosticRuntimes,
  logRuntimeEnvironment,
} from "../../common/utils/debug/RuntimeDiagnostics";
import { debugBroadcast, logInfo } from "./log";

export function initializeBackgroundDiagnostics(): void {
  if (typeof __DEBUG__ !== "undefined" && __DEBUG__) {
    // Keep this outside the service stack so Safari messaging can be tested even
    // when service initialization breaks.
    try {
      const extensionGlobals = globalThis as unknown as DiagnosticGlobals;
      const runtimes = diagnosticRuntimes(extensionGlobals);

      for (const { name, runtime } of runtimes) {
        runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
          if (message?.type !== "__raw_ping") return;
          debugLog(`[tab-reaper][raw][${name}] recv`, message);
          const response = { ok: true, api: name };
          if (typeof sendResponse === "function") {
            sendResponse(response);
            return true;
          }
          return response;
        });
      }
    } catch (error) {
      debugLog("Raw background diagnostics unavailable", error);
    }
  }

  if (typeof __DEBUG__ !== "undefined" && __DEBUG__) {
    logRuntimeEnvironment(globalThis as DiagnosticGlobals);
  }

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("error", (event) => {
      logInfo("Background error event", event?.error ?? event);
      debugBroadcast("background-error-event", {
        message: (event as ErrorEvent)?.message ?? "unknown",
      });
    });
    globalThis.addEventListener("unhandledrejection", (event) => {
      logInfo("Background unhandled rejection", event?.reason ?? event);
      debugBroadcast("background-unhandled-rejection", {
        message: (event as PromiseRejectionEvent)?.reason ?? "unknown",
      });
    });
  }
}
