import { BrowserLastError, ExtensionInstalledEvent, ExtensionStartupEvent } from '../types';

export interface IBrowserRuntimeAPI {
  getLastError: () => BrowserLastError | undefined;
  onInstalled: ExtensionInstalledEvent;
  onStartup: ExtensionStartupEvent;
}
