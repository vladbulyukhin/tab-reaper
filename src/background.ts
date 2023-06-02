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

const tabTimeoutManager = new TabAlarmManager(chromeAlarmAPI);
const extensionIconService = new ExtensionActionManager(chromeActionAPI);
const excludedTabManager = new ExcludedTabManager(extensionIconService);
const configurationManager = new ConfigurationManager(chromeSyncStorageAPI);
const openedTabManager = new OpenedTabManager(chromeRuntimeAPI, chromeTabAPI, tabTimeoutManager, excludedTabManager, configurationManager);

new BackgroundService(chromeRuntimeAPI, chromeTabAPI, chromeActionAPI, openedTabManager, excludedTabManager).start();
