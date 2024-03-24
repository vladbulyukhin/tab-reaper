import type {
  BrowserLastError,
  ExtensionInstalledEvent,
  ExtensionStartupEvent,
} from "../types";

export interface IBrowserRuntimeAPI {
  getLastError: () => BrowserLastError | undefined;
  onInstalled: ExtensionInstalledEvent;
  onStartup: ExtensionStartupEvent;
}
