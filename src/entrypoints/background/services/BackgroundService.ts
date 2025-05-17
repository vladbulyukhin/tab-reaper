import type { IBrowserApiProvider } from "../../../api/IBrowserApiProvider";
import {
  type IMessageService,
  MessageService,
} from "../../../common/services/MessageService";
import {
  ConfigurationManager,
  type IConfigurationManager,
} from "../managers/ConfigurationManager";
import {
  ExcludedTabManager,
  type IExcludedTabManager,
} from "../managers/ExcludedTabManager";
import { ExtensionActionManager } from "../managers/ExtensionActionManager";
import {
  type IOpenedTabManager,
  OpenedTabManager,
} from "../managers/OpenedTabManager";
import { TabAlarmManager } from "../managers/TabAlarmManager";

export interface IBackgroundService {
  start(): void;
}

export class BackgroundService implements IBackgroundService {
  private readonly openedTabManager: IOpenedTabManager;
  private readonly messageService: IMessageService;
  private readonly configurationManager: IConfigurationManager;
  private readonly excludedTabManager: IExcludedTabManager;

  constructor(private readonly browserApiProvider: IBrowserApiProvider) {
    const tabAlarmManager = new TabAlarmManager(browserApiProvider);
    const extensionActionManager = new ExtensionActionManager(
      browserApiProvider
    );

    this.excludedTabManager = new ExcludedTabManager(
      browserApiProvider,
      extensionActionManager
    );
    this.configurationManager = new ConfigurationManager(browserApiProvider);
    this.openedTabManager = new OpenedTabManager(
      browserApiProvider,
      tabAlarmManager,
      this.excludedTabManager,
      this.configurationManager,
      extensionActionManager
    );
    this.messageService = new MessageService(browserApiProvider);
  }

  public start(): void {
    this.openedTabManager.watchTabs();
    this.registerMessageHandlers();
  }

  registerMessageHandlers() {
    this.messageService.onMessage(
      "getConfig",
      async (_payload, _sender, sendResponse) => {
        const configuration = await this.configurationManager.get();
        sendResponse(configuration);
      }
    );

    this.messageService.onMessage(
      "setConfig",
      async (payload, _sender, sendResponse) => {
        try {
          await this.configurationManager.save(payload);
          sendResponse({ status: "ok" });
        } catch (e) {
          sendResponse({ status: "error" });
        }
      }
    );

    this.messageService.onMessage(
      "isCurrentTabExcluded",
      async (_payload, _sender, sendResponse) => {
        const [currentTab] = await this.browserApiProvider.tab.query({
          active: true,
          currentWindow: true,
        });

        if (currentTab?.id) {
          const isExcluded = await this.excludedTabManager.isExcluded(
            currentTab.id
          );
          sendResponse(isExcluded);
        } else {
          sendResponse(false);
        }
      }
    );

    this.messageService.onMessage(
      "setCurrentTabExcluded",
      async (payload, _sender, sendResponse) => {
        const [currentTab] = await this.browserApiProvider.tab.query({
          active: true,
          currentWindow: true,
        });

        if (currentTab?.id) {
          try {
            if (payload.excluded) {
              await this.excludedTabManager.exclude(currentTab.id);
            } else {
              await this.excludedTabManager.include(currentTab.id);
            }
            sendResponse({ status: "ok" });
          } catch (e) {
            sendResponse({ status: "error" });
          }
        } else {
          sendResponse({ status: "error" });
        }
      }
    );

    this.messageService.onMessage(
      "getRecentlyClosedTabs",
      async (_payload, _sender, sendResponse) => {
        const recentlyClosedTabs =
          await this.openedTabManager.getRecentlyClosed();
        sendResponse({ tabs: recentlyClosedTabs });
      }
    );

    this.messageService.listen();
  }
}
