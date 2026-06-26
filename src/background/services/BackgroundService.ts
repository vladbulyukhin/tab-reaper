import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import {
  type IMessageService,
  MessageService,
} from "../../common/services/MessageService";
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
      browserApiProvider,
    );

    this.excludedTabManager = new ExcludedTabManager(
      browserApiProvider,
      extensionActionManager,
    );
    this.configurationManager = new ConfigurationManager(browserApiProvider);
    this.openedTabManager = new OpenedTabManager(
      browserApiProvider,
      tabAlarmManager,
      this.excludedTabManager,
      this.configurationManager,
      extensionActionManager,
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
      },
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
      },
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
            currentTab.id,
          );
          sendResponse(isExcluded);
        } else {
          sendResponse(false);
        }
      },
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
      },
    );

    this.messageService.onMessage(
      "getRecentlyClosedTabs",
      async (_payload, _sender, sendResponse) => {
        const recentlyClosedTabs =
          await this.openedTabManager.getRecentlyClosed();
        sendResponse({ tabs: recentlyClosedTabs });
      },
    );

    this.messageService.onMessage(
      "sweepDuplicates",
      async (_payload, _sender, sendResponse) => {
        const tabs = await this.browserApiProvider.tab.query({
          currentWindow: true,
        });
        const eligible = tabs.filter(
          (t) =>
            !t.pinned &&
            !t.audible &&
            (t.groupId === undefined || t.groupId === -1) &&
            typeof t.url === "string" &&
            t.url.length > 0 &&
            typeof t.id === "number",
        );
        const groups = new Map<string, chrome.tabs.Tab[]>();
        for (const t of eligible) {
          const url = t.url as string;
          const list = groups.get(url) ?? [];
          list.push(t);
          groups.set(url, list);
        }
        let closed = 0;
        let kept = 0;
        for (const list of groups.values()) {
          if (list.length === 1) {
            kept += 1;
            continue;
          }
          list.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
          kept += 1;
          for (let i = 1; i < list.length; i++) {
            const id = list[i].id;
            if (typeof id === "number") {
              try {
                await this.browserApiProvider.tab.remove(id);
                closed += 1;
              } catch {
                // tab may have closed between query and remove; ignore
              }
            }
          }
        }
        sendResponse({ closed, kept });
      },
    );

    this.messageService.listen();
  }
}
