import { extensionApiType } from "../../../api/extensionApi";
import type { RuntimeMessage } from "../../models/Message";
import { debugLog } from "../debug";
export type { RuntimeMessage } from "../../models/Message";

export type DiagnosticRuntime = {
  readonly lastError?: unknown;
  sendMessage?(
    message: RuntimeMessage,
    callback?: (response: unknown) => void,
  ): unknown;
  readonly onMessage?: {
    addListener(
      listener: (
        message: RuntimeMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse?: (response: unknown) => void,
      ) => boolean | { ok: boolean; api: string } | undefined,
    ): void;
  };
};

export type DiagnosticGlobals = {
  __TAB_REAPER_DIAG_DONE__?: boolean;
  browser?: { runtime?: DiagnosticRuntime };
  chrome?: { runtime?: DiagnosticRuntime };
};

export function diagnosticRuntimes(globals: DiagnosticGlobals) {
  const runtimes: Array<{ name: string; runtime: DiagnosticRuntime }> = [];
  const browser = globals.browser?.runtime;
  const chrome = globals.chrome?.runtime;

  if (browser) runtimes.push({ name: "browser", runtime: browser });
  if (chrome && chrome !== browser)
    runtimes.push({ name: "chrome", runtime: chrome });

  return runtimes;
}

export function logRuntimeEnvironment(globals: DiagnosticGlobals): void {
  debugLog(
    "[tab-reaper][env]",
    `api=${extensionApiType}`,
    `hasBrowser=${typeof globals.browser !== "undefined"}`,
    `hasChrome=${typeof globals.chrome !== "undefined"}`,
  );
}
