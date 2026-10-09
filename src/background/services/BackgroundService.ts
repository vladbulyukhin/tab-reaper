import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { emptyConfiguration } from "../../common/models/Configuration";
import type {
  MessagePayloads,
  MessageResponses,
  MessageTypes,
} from "../../common/models/Message";
import {
  type IMessageService,
  MessageService,
} from "../../common/services/MessageService";
import { logInfo } from "../../common/utils/log";
import {
  ConfigurationManager,
  type IConfigurationManager,
} from "../managers/ConfigurationManager";
import {
  ExcludedTabManager,
  type IExcludedTabManager,
} from "../managers/ExcludedTabManager";
import { ExtensionActionManager } from "../managers/ExtensionActionManager";
import { IdleTabLedger } from "../managers/IdleTabLedger";
import {
  type IOpenedTabManager,
  OpenedTabManager,
} from "../managers/OpenedTabManager";
import { ProtectedSiteManager } from "../managers/ProtectedSiteManager";
import { SnoozeManager } from "../managers/SnoozeManager";
import { TabAlarmManager } from "../managers/TabAlarmManager";
import { toKeepDiagnosticsTab } from "../utils/DiagnosticTabs";

type RescheduleOptions = Parameters<
  IOpenedTabManager["rescheduleOpenTabs"]
>[0] &
  object;

export interface IBackgroundService {
  start(): void;
}

export class BackgroundService implements IBackgroundService {
  private readonly openedTabManager: IOpenedTabManager;
  private readonly messageService: IMessageService;
  private readonly configurationManager: IConfigurationManager;
  private readonly excludedTabManager: IExcludedTabManager;
  private readonly protectedSiteManager: ProtectedSiteManager;
  private readonly snoozeManager: SnoozeManager;
  private readonly idleTabLedger: IdleTabLedger;

  constructor(private readonly browserApiProvider: IBrowserApiProvider) {
    logInfo("BackgroundService init");
    const tabAlarmManager = new TabAlarmManager(browserApiProvider);
    const extensionActionManager = new ExtensionActionManager(
      browserApiProvider,
    );
    const idleTabLedger = new IdleTabLedger(browserApiProvider.localStorage);
    this.idleTabLedger = idleTabLedger;

    this.excludedTabManager = new ExcludedTabManager(
      browserApiProvider,
      extensionActionManager,
      idleTabLedger,
    );
    this.protectedSiteManager = new ProtectedSiteManager(browserApiProvider);
    this.snoozeManager = new SnoozeManager(browserApiProvider);
    this.configurationManager = new ConfigurationManager(browserApiProvider);
    this.openedTabManager = new OpenedTabManager(
      browserApiProvider,
      tabAlarmManager,
      this.excludedTabManager,
      this.protectedSiteManager,
      this.snoozeManager,
      this.configurationManager,
      extensionActionManager,
      idleTabLedger,
    );
    this.messageService = new MessageService(browserApiProvider);
  }

  public start(): void {
    this.registerMessageHandlers();
    logInfo("BackgroundService start");
    this.snoozeManager.onEnded(() => {
      void this.openedTabManager.rescheduleOpenTabs().catch((error) => {
        logInfo("Failed to reschedule tabs after snooze ended", error);
      });
    });
    void this.snoozeManager.ensureAlarmScheduled().catch((error) => {
      logInfo("Failed to reconcile snooze state", error);
    });
    this.openedTabManager.watchTabs();
    void this.openedTabManager
      .restoreHistoryBadge()
      .catch((error) => logInfo("Failed to restore history badge", error));
    void (async () => {
      let diagnosticsEnabled = emptyConfiguration.diagnosticsEnabled;
      try {
        diagnosticsEnabled = (await this.configurationManager.get())
          .diagnosticsEnabled;
      } catch {}
      await this.openedTabManager.setDiagnosticsEnabled(diagnosticsEnabled);
      await this.openedTabManager.rescheduleOpenTabs();
    })().catch((error) => {
      logInfo("Failed to reconcile open tabs at background startup", error);
    });
  }

  registerMessageHandlers() {
    logInfo("Registering message handlers");
    this.messageService.onMessage(
      "getConfig",
      async (_payload, _sender, sendResponse) => {
        try {
          const configuration = await this.configurationManager.get();
          sendResponse(configuration);
        } catch (error) {
          logInfo("getConfig failed", error);
          sendResponse(emptyConfiguration);
        }
      },
    );

    this.registerSafetyHandler(
      "setConfig",
      async (payload, _sender, sendResponse) => {
        try {
          const previousConfiguration = await this.configurationManager.get();
          await this.configurationManager.save(payload);
          const nextConfiguration = await this.configurationManager.get();
          await this.openedTabManager.setDiagnosticsEnabled(
            nextConfiguration.diagnosticsEnabled,
          );
          await this.openedTabManager.syncRecentlyClosedPersistence();
          sendResponse({ status: "ok" });
          return {
            recalculateIdleDeadlines:
              typeof payload.tabRemovalDelayMin === "number" &&
              payload.tabRemovalDelayMin !==
                previousConfiguration.tabRemovalDelayMin,
          };
        } catch (error) {
          logInfo("setConfig failed", error);
          sendResponse({ status: "error" });
          return {};
        }
      },
    );

    this.messageService.onMessage(
      "getCurrentTabKeepState",
      async (_payload, _sender, respond) => {
        try {
          const [tab] = await this.browserApiProvider.tab.query({
            active: true,
            currentWindow: true,
          });
          const state =
            typeof tab?.id === "number"
              ? await this.excludedTabManager.getKeepState(tab.id, tab.url)
              : { kept: false, uncertain: false };
          const keepsReset = await this.idleTabLedger
            .hasResetNotice()
            .catch(() => false);
          respond({ status: "ok", ...state, keepsReset });
        } catch {
          respond({
            status: "error",
            kept: false,
            uncertain: false,
            keepsReset: false,
          });
        }
      },
    );

    this.messageService.onMessage(
      "dismissKeepsResetNotice",
      async (_payload, _sender, respond) => {
        try {
          await this.idleTabLedger.dismissResetNotice();
          respond({ status: "ok" });
        } catch {
          respond({ status: "error" });
        }
      },
    );

    this.registerSafetyHandler(
      "setCurrentTabExcluded",
      async (payload, _sender, sendResponse) => {
        try {
          const [currentTab] = await this.browserApiProvider.tab.query({
            active: true,
            currentWindow: true,
          });

          if (typeof currentTab?.id === "number") {
            const diagnosticTab = toKeepDiagnosticsTab(currentTab);
            this.openedTabManager.recordKeepStateDiagnostic(
              "keep-state-write-requested",
              {
                requestedExcluded: payload.excluded,
                tab: diagnosticTab,
              },
            );
            try {
              if (payload.excluded) {
                await this.excludedTabManager.exclude(currentTab.id);
              } else {
                await this.excludedTabManager.include(currentTab.id);
              }
              const storedExcluded = await this.excludedTabManager.isExcluded(
                currentTab.id,
                currentTab.url,
              );
              if (storedExcluded !== payload.excluded) {
                this.openedTabManager.recordKeepStateDiagnostic(
                  "keep-state-write-failed",
                  {
                    requestedExcluded: payload.excluded,
                    storedExcluded,
                    tab: diagnosticTab,
                  },
                );
                sendResponse({ status: "error" });
                return;
              }
              this.openedTabManager.recordKeepStateDiagnostic(
                "keep-state-write-completed",
                {
                  requestedExcluded: payload.excluded,
                  storedExcluded,
                  tab: diagnosticTab,
                },
              );
              sendResponse({ status: "ok" });
            } catch (error) {
              logInfo("setCurrentTabExcluded failed", error);
              this.openedTabManager.recordKeepStateDiagnostic(
                "keep-state-write-failed",
                {
                  message: (error as Error)?.message ?? String(error),
                  requestedExcluded: payload.excluded,
                  tab: diagnosticTab,
                },
              );
              sendResponse({ status: "error" });
            }
          } else {
            this.openedTabManager.recordKeepStateDiagnostic(
              "keep-state-write-failed",
              {
                message: "No active tab resolved",
                requestedExcluded: payload.excluded,
                tab: null,
              },
            );
            sendResponse({ status: "error" });
          }
        } catch (error) {
          logInfo("setCurrentTabExcluded failed", error);
          this.openedTabManager.recordKeepStateDiagnostic(
            "keep-state-write-failed",
            {
              message: (error as Error)?.message ?? String(error),
              requestedExcluded: payload.excluded,
              tab: null,
            },
          );
          sendResponse({ status: "error" });
        }
      },
    );

    this.registerSafetyHandler(
      "forgetCurrentTabSavedKeeps",
      async (_payload, _sender, sendResponse) => {
        try {
          const [active] = await this.browserApiProvider.tab.query({
            active: true,
            currentWindow: true,
          });
          if (active?.id === undefined || !active.url)
            throw new Error("No active tab resolved");
          const visibleTabs = await this.browserApiProvider.tab.query({});
          const cleared = await this.excludedTabManager.forgetSavedKeeps(
            active.id,
            visibleTabs,
            active.url,
          );
          sendResponse({ status: "ok", cleared });
        } catch (error) {
          logInfo("forgetCurrentTabSavedKeeps failed", error);
          sendResponse({ status: "error", cleared: 0 });
        }
      },
    );

    this.messageService.onMessage(
      "getProtectedSites",
      async (_payload, _sender, sendResponse) => {
        try {
          sendResponse({ sites: await this.protectedSiteManager.list() });
        } catch (error) {
          logInfo("getProtectedSites failed", error);
          sendResponse({ sites: [] });
        }
      },
    );

    this.registerSafetyHandler(
      "addProtectedSite",
      async (payload, _sender, sendResponse) => {
        try {
          await this.protectedSiteManager.add(payload.hostname);
          sendResponse({ status: "ok" });
        } catch (error) {
          logInfo("addProtectedSite failed", error);
          sendResponse({ status: "error" });
        }
      },
    );

    this.registerSafetyHandler(
      "removeProtectedSite",
      async (payload, _sender, sendResponse) => {
        try {
          await this.protectedSiteManager.remove(payload.hostname);
          sendResponse({ status: "ok" });
        } catch (error) {
          logInfo("removeProtectedSite failed", error);
          sendResponse({ status: "error" });
        }
      },
    );

    const getCurrentHostname = async (): Promise<string | null> => {
      const [currentTab] = await this.browserApiProvider.tab.query({
        active: true,
        currentWindow: true,
      });

      const url = currentTab?.url ?? null;
      if (!url) return null;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return null;
        }
        return parsed.hostname.toLowerCase().replace(/\.$/, "");
      } catch {
        return null;
      }
    };

    this.messageService.onMessage(
      "isCurrentSiteProtected",
      async (_payload, _sender, sendResponse) => {
        let hostname: string | null = null;
        try {
          hostname = await getCurrentHostname();
          if (!hostname) {
            sendResponse({
              protected: false,
              hostname: null,
              supported: false,
            });
            return;
          }

          const supportedHostname = hostname;
          const protectedNow = (await this.protectedSiteManager.list()).some(
            (rule) =>
              supportedHostname === rule ||
              supportedHostname.endsWith(`.${rule}`),
          );
          sendResponse({ protected: protectedNow, hostname, supported: true });
        } catch (error) {
          logInfo("isCurrentSiteProtected failed", error);
          sendResponse({
            protected: false,
            hostname,
            supported: hostname !== null,
          });
        }
      },
    );

    this.registerSafetyHandler(
      "setCurrentSiteProtected",
      async (payload, _sender, sendResponse) => {
        let hostname: string | null = null;
        try {
          hostname = await getCurrentHostname();
          if (!hostname) {
            sendResponse({
              status: "error",
              protected: false,
              hostname: null,
              supported: false,
            });
            return;
          }

          if (payload.protected) {
            await this.protectedSiteManager.add(hostname);
          } else {
            await this.protectedSiteManager.remove(hostname);
          }

          const supportedHostname = hostname;
          const protectedNow = (await this.protectedSiteManager.list()).some(
            (rule) =>
              supportedHostname === rule ||
              supportedHostname.endsWith(`.${rule}`),
          );

          sendResponse({
            status: "ok",
            protected: protectedNow,
            hostname,
            supported: true,
          });
        } catch (error) {
          logInfo("setCurrentSiteProtected failed", error);
          sendResponse({
            status: "error",
            protected: false,
            hostname,
            supported: hostname !== null,
          });
        }
      },
    );

    this.messageService.onMessage(
      "getRecentlyClosedTabs",
      async (_payload, _sender, sendResponse) => {
        try {
          sendResponse(await this.openedTabManager.getHistorySnapshot());
        } catch (error) {
          logInfo("getRecentlyClosedTabs failed", error);
          sendResponse({ tabs: [] });
        }
      },
    );

    this.messageService.onMessage(
      "acknowledgeRecentlyClosedTabs",
      async (payload, _sender, sendResponse) => {
        try {
          await this.openedTabManager.acknowledgeHistory(payload.activityToken);
          sendResponse({ status: "ok" });
        } catch {
          sendResponse({ status: "error" });
        }
      },
    );

    this.messageService.onMessage(
      "clearRecentlyClosedTabs",
      async (_payload, _sender, sendResponse) => {
        try {
          await this.openedTabManager.clearRecentlyClosed();
          sendResponse({ status: "ok" });
        } catch (error) {
          logInfo("clearRecentlyClosedTabs failed", error);
          sendResponse({ status: "error" });
        }
      },
    );

    this.messageService.onMessage(
      "getCleanupDiagnostics",
      async (_payload, _sender, sendResponse) => {
        try {
          sendResponse(await this.openedTabManager.getCleanupDiagnostics());
        } catch (error) {
          logInfo("getCleanupDiagnostics failed", error);
          sendResponse({
            alarms: [],
            background: {
              instanceId: "unavailable",
              sessionStorageKind:
                this.browserApiProvider.sessionStorageKind ?? "memory-fallback",
            },
            events: [],
            ledger: { records: [] },
            queries: { allTabs: [], inactiveTabs: [] },
          });
        }
      },
    );

    this.messageService.onMessage(
      "clearCleanupDiagnostics",
      async (_payload, _sender, sendResponse) => {
        try {
          await this.openedTabManager.clearCleanupDiagnostics();
          sendResponse({ status: "ok" });
        } catch (error) {
          logInfo("clearCleanupDiagnostics failed", error);
          sendResponse({ status: "error" });
        }
      },
    );

    this.messageService.onMessage(
      "getSnoozeStatus",
      async (_payload, _sender, sendResponse) => {
        try {
          sendResponse(await this.snoozeManager.getStatus());
        } catch (error) {
          logInfo("getSnoozeStatus failed", error);
          sendResponse({
            status: "error",
            snoozed: false,
            until: null,
            remainingMinutes: null,
          });
        }
      },
    );

    this.registerSafetyHandler(
      "setSnooze",
      async (payload, _sender, sendResponse) => {
        try {
          const status = await this.snoozeManager.setSnooze(payload.minutes);
          if (status.snoozed) {
            await this.openedTabManager.clearScheduledRemovals();
          }
          sendResponse({
            status: "ok",
            snoozed: status.snoozed,
            until: status.until,
          });
        } catch (error) {
          logInfo("setSnooze failed", error);
          sendResponse({ status: "error", snoozed: false, until: null });
        }
      },
    );

    this.registerSafetyHandler(
      "clearSnooze",
      async (_payload, _sender, sendResponse) => {
        try {
          await this.snoozeManager.clearSnooze();
          sendResponse({ status: "ok", snoozed: false, until: null });
        } catch (error) {
          logInfo("clearSnooze failed", error);
          sendResponse({ status: "error", snoozed: false, until: null });
        }
      },
    );

    this.messageService.listen();
  }

  private registerSafetyHandler<K extends MessageTypes>(
    type: K,
    handler: (
      payload: MessagePayloads[K],
      sender: chrome.runtime.MessageSender,
      respond: (response: MessageResponses[K]) => void,
    ) => Promise<RescheduleOptions> | Promise<void>,
  ): void {
    // Every policy change ends with exactly one reconcile of open tabs.
    this.messageService.onMessage(type, async (payload, sender, respond) => {
      const finish = this.openedTabManager.beginSafetyMutation();
      let options: RescheduleOptions = {};
      try {
        options = (await handler(payload, sender, respond)) ?? {};
      } finally {
        finish();
        await this.openedTabManager
          .rescheduleOpenTabs(options)
          .catch((error) =>
            logInfo("Failed to reconcile cleanup after a policy change", error),
          );
      }
    });
  }
}
