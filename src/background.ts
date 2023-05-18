import { chromeActionAPI } from './api/chromeActionAPI';
import { chromeLocalStorageAPI } from './api/chromeLocalStorageAPI';
import { chromeRuntimeAPI } from './api/chromeRuntimeAPI';
import { chromeTabAPI } from './api/chromeTabAPI';
import { ExtensionActionManager } from './managers/ExtensionActionManager';
import { OpenedTabManager } from './managers/OpenedTabManager';
import { ExcludedTabManager } from './managers/ExcludedTabManager';
import { TabTimeoutManager } from './managers/TabTimeoutManager';
import { BackgroundService } from './services/BackgroundService';
import { ConsoleLogger } from './services/ConsoleLogger';

const logger = new ConsoleLogger();

const tabTimeoutManager = new TabTimeoutManager();

const extensionIconService = new ExtensionActionManager(chromeActionAPI);

const excludedTabManager = new ExcludedTabManager(chromeLocalStorageAPI, extensionIconService);

const openedTabManager = new OpenedTabManager(chromeRuntimeAPI, chromeTabAPI, tabTimeoutManager, excludedTabManager);

new BackgroundService(chromeRuntimeAPI, chromeTabAPI, chromeActionAPI, openedTabManager, excludedTabManager).start();
