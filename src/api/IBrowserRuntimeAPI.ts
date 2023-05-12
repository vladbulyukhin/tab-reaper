import { ExtensionInstalledEvent, ExtensionStartupEvent } from '../types';

export interface IBrowserRuntimeAPI {
  onInstalled: ExtensionInstalledEvent;
  onStartup: ExtensionStartupEvent;
}
