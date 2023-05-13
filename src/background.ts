import { chromeActionAPI } from './api/chromeActionAPI';
import { chromeRuntimeAPI } from './api/chromeRuntimeAPI';
import { chromeTabAPI } from './api/chromeTabAPI';
import { ExtensionActionManager } from './managers/ExtensionActionManager';
import { OpenedTabManager } from './managers/OpenedTabManager';
import { PinnedTabManager } from './managers/PinnedTabManager';
import { TabTimeoutManager } from './managers/TabTimeoutManager';
import { BackgroundService } from './services/BackgroundService';
import { ConsoleLogger } from './services/ConsoleLogger';

const logger = new ConsoleLogger();

const tabTimeoutManager = new TabTimeoutManager();

const extensionIconService = new ExtensionActionManager(chromeActionAPI);

const pinnedTabManager = new PinnedTabManager(extensionIconService);

const openedTabManager = new OpenedTabManager(chromeRuntimeAPI, chromeTabAPI, tabTimeoutManager, pinnedTabManager);

new BackgroundService(chromeRuntimeAPI, chromeTabAPI, chromeActionAPI, openedTabManager, pinnedTabManager).start();
