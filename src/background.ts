import { chromeActionAPI } from './api/chromeActionAPI';
import { chromeRuntimeAPI } from './api/chromeRuntimeAPI';
import { chromeSyncStorageAPI } from './api/chromeSyncStorageAPI';
import { chromeTabAPI } from './api/chromeTabAPI';
import { ConfigurationManager } from './managers/ConfigurationManager';
import { ExcludedTabManager } from './managers/ExcludedTabManager';
import { ExtensionActionManager } from './managers/ExtensionActionManager';
import { OpenedTabManager } from './managers/OpenedTabManager';
import { TabAlarmManager } from './managers/TabAlarmManager';
import { BackgroundService } from './services/BackgroundService';
import { chromeAlarmAPI } from './api/chromeAlarmAPI';
import { chromeSessionStorageAPI } from './api/chromeSessionStorageAPI';

const tabAlarmManager = new TabAlarmManager(chromeAlarmAPI);
const extensionActionManager = new ExtensionActionManager(chromeActionAPI);
const excludedTabManager = new ExcludedTabManager(chromeSessionStorageAPI, extensionActionManager);
const configurationManager = new ConfigurationManager(chromeSyncStorageAPI);
const openedTabManager = new OpenedTabManager(
  chromeRuntimeAPI,
  chromeTabAPI,
  chromeSessionStorageAPI,
  tabAlarmManager,
  excludedTabManager,
  configurationManager
);

new BackgroundService(chromeRuntimeAPI, chromeTabAPI, chromeActionAPI, openedTabManager, excludedTabManager).start();
