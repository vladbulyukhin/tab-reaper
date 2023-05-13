import { BrowserLastError, ExtensionInstalledEvent, ExtensionStartupEvent } from '../types';

export interface IBrowserRuntimeAPI {
  lastError: BrowserLastError | undefined;
  onInstalled: ExtensionInstalledEvent;
  onStartup: ExtensionStartupEvent;
}
