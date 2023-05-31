import { chromeActionAPI } from './api/chromeActionAPI';
import { chromeLocalStorageAPI } from './api/chromeLocalStorageAPI';
import { chromeRuntimeAPI } from './api/chromeRuntimeAPI';
import { chromeTabAPI } from './api/chromeTabAPI';
import { ConfigurationManager } from './managers/ConfigurationManager';
import { ExcludedTabManager } from './managers/ExcludedTabManager';
import { ExtensionActionManager } from './managers/ExtensionActionManager';
import { OpenedTabManager } from './managers/OpenedTabManager';
import { TabTimeoutManager } from './managers/TabTimeoutManager';
import { BackgroundService } from './services/BackgroundService';

const tabTimeoutManager = new TabTimeoutManager();
const extensionIconService = new ExtensionActionManager(chromeActionAPI);
const excludedTabManager = new ExcludedTabManager(chromeLocalStorageAPI, extensionIconService);
const configurationManager = new ConfigurationManager(chromeLocalStorageAPI);
const openedTabManager = new OpenedTabManager(
  chromeRuntimeAPI,
  chromeTabAPI,
  tabTimeoutManager,
  excludedTabManager,
  configurationManager
);

new BackgroundService(chromeRuntimeAPI, chromeTabAPI, chromeActionAPI, openedTabManager, excludedTabManager).start();
