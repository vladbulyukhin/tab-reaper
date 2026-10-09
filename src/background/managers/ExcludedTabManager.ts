import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import type { TabId } from "../../types";
import { PersistedValue } from "../utils/PersistedValue";
import { SequentialTaskQueue } from "../utils/SequentialTaskQueue";
import type { IExtensionActionManager } from "./ExtensionActionManager";
import { IdleTabLedger } from "./IdleTabLedger";

export interface IExcludedTabManager {
  exclude(tabId: TabId): Promise<void>;
  include(tabId: TabId): Promise<void>;
  forget(tabId: TabId): Promise<void>;
  forgetSavedKeeps(
    tabId: TabId,
    visibleTabs: ReadonlyArray<chrome.tabs.Tab>,
    url: string,
  ): Promise<number>;
  isExcluded(tabId: TabId, tabUrl?: string | null): Promise<boolean>;
  getKeepState(
    tabId: TabId,
    tabUrl?: string | null,
  ): Promise<{ kept: boolean; uncertain: boolean }>;
  reconcileOpenTabs(tabs: ReadonlyArray<chrome.tabs.Tab>): Promise<void>;
}

type ExcludedTabInfo = {
  url: string | null;
  excludedAt: string;
};

const isMissingTabError = (error: unknown, tabId: TabId) =>
  error instanceof Error &&
  new RegExp(`^No tab with id: ${tabId}\\.?$`).test(error.message);

export class ExcludedTabManager implements IExcludedTabManager {
  public forgetSavedKeeps(
    tabId: TabId,
    visibleTabs: ReadonlyArray<chrome.tabs.Tab>,
    url: string,
  ): Promise<number> {
    return this.lifecycleQueue.addTask(async () => {
      const visibleIds = new Set(
        visibleTabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id])),
      );
      return this.idleTabLedger.forgetSavedKeeps(tabId, visibleIds, url);
    });
  }
  public async getKeepState(
    tabId: TabId,
    tabUrl?: string | null,
  ): Promise<{ kept: boolean; uncertain: boolean }> {
    const protectedTab = await this.isExcluded(tabId, tabUrl);
    const record = await this.idleTabLedger.getBoundRecord(tabId);
    const uncertain =
      protectedTab && Boolean(record?.uncertainKeep) && !record?.kept;
    return { kept: protectedTab && !uncertain, uncertain };
  }
  private readonly lifecycleQueue = new SequentialTaskQueue();
  private readonly excludedTabsById: PersistedValue<
    Record<string, ExcludedTabInfo>
  >;
  private readonly idleTabLedger: IdleTabLedger;

  constructor(
    private readonly browserApiProvider: Pick<
      IBrowserApiProvider,
      "localStorage" | "tab"
    >,
    private readonly extensionIconService: IExtensionActionManager,
    idleTabLedger?: IdleTabLedger,
  ) {
    this.idleTabLedger =
      idleTabLedger ?? new IdleTabLedger(browserApiProvider.localStorage);
    this.excludedTabsById = new PersistedValue<Record<string, ExcludedTabInfo>>(
      // Use durable storage so exclusions survive Safari tab group switches / browser restarts.
      this.browserApiProvider.localStorage,
      "excludedTabs",
      {},
    );
  }

  public async isExcluded(
    tabId: TabId,
    tabUrl?: string | null,
  ): Promise<boolean> {
    return await this.lifecycleQueue.addTask(() =>
      this.isExcludedNow(tabId, tabUrl),
    );
  }

  private async isExcludedNow(
    tabId: TabId,
    tabUrl?: string | null,
  ): Promise<boolean> {
    const record = await this.idleTabLedger.getBoundRecord(tabId);
    if (record?.uncertainKeep) {
      const excluded = await this.getMap();
      const records = await this.idleTabLedger.getDiagnosticRecords();
      for (const sourceId of record.keepSourceIds ?? []) {
        const source = records.find(
          (candidate) => candidate.id === sourceId && candidate.kept,
        );
        // Only probe explicit runtime bindings, not URL-only recovery records.
        // An old session's ID cannot prove a restored Keep was closed.
        if (source?.tabId === undefined || !excluded[String(source.tabId)])
          continue;
        try {
          await this.browserApiProvider.tab.get(source.tabId);
        } catch (error) {
          if (isMissingTabError(error, source.tabId)) {
            await this.forgetNow(source.tabId);
          }
        }
      }
    }
    if (await this.idleTabLedger.isProtected(tabId, tabUrl)) return true;
    const excluded = await this.getMap();
    const entry = excluded[String(tabId)];
    if (!entry) return false;
    // Legacy `excludedTabs` entries are keyed only by a runtime tab ID. They
    // cannot safely survive a browser/tab-group recreation, so never use one
    // to protect a current tab. Remove it after the ledger lookup fails.
    await this.excludedTabsById.update((current) => {
      const next = { ...current };
      delete next[String(tabId)];
      return next;
    });
    await Promise.resolve(
      this.extensionIconService.enableExtensionIcon(tabId),
    ).catch(() => undefined);
    return false;
  }

  public async exclude(tabId: TabId): Promise<void> {
    await this.lifecycleQueue.addTask(() => this.excludeNow(tabId));
  }

  public async include(tabId: TabId): Promise<void> {
    await this.lifecycleQueue.addTask(() => this.includeNow(tabId));
  }

  public async forget(tabId: TabId): Promise<void> {
    await this.lifecycleQueue.addTask(() => this.forgetNow(tabId));
  }

  public async reconcileOpenTabs(
    tabs: ReadonlyArray<chrome.tabs.Tab>,
  ): Promise<void> {
    await this.lifecycleQueue.addTask(() => this.reconcileOpenTabsNow(tabs));
  }

  private async excludeNow(tabId: TabId): Promise<void> {
    const tab = await this.browserApiProvider.tab.get(tabId).catch(() => null);
    if (!tab) {
      throw new Error(`Cannot keep unavailable tab ${tabId}`);
    }
    let tabs: ReadonlyArray<chrome.tabs.Tab> = [];
    try {
      tabs = (await this.browserApiProvider.tab.query({})) ?? [];
    } catch {}
    await this.idleTabLedger.reconcile(
      [...tabs.filter((candidate) => candidate.id !== tabId), tab],
      new Set([tabId]),
    );
    await this.idleTabLedger.setKept(tabId, true);
    // Ensure storage is migrated before writing.
    await this.getMap();
    await this.excludedTabsById.update((excluded) => ({
      ...excluded,
      [String(tabId)]: {
        url: tab?.url ?? null,
        excludedAt: new Date().toISOString(),
      },
    }));
    await this.extensionIconService.disableExtensionIcon(tabId);
  }

  private async includeNow(tabId: TabId): Promise<void> {
    await this.idleTabLedger.setKept(tabId, false);
    await this.extensionIconService.enableExtensionIcon(tabId);
    await this.excludedTabsById.update((excluded) => {
      const next = { ...excluded };
      delete next[String(tabId)];
      return next;
    });
  }

  private async forgetNow(tabId: TabId): Promise<void> {
    // Ensure storage is migrated before writing.
    await this.getMap();
    await this.excludedTabsById.update((excluded) => {
      const next = { ...excluded };
      delete next[String(tabId)];
      return next;
    });
    await this.idleTabLedger.removeTab(tabId);
  }

  private async reconcileOpenTabsNow(
    tabs: ReadonlyArray<chrome.tabs.Tab>,
  ): Promise<void> {
    await this.idleTabLedger.reconcile(tabs);
    const queriedTabs = new Map(
      tabs
        .filter(
          (tab): tab is chrome.tabs.Tab & { id: TabId } =>
            typeof tab.id === "number",
        )
        .map((tab) => [tab.id, tab]),
    );
    const excluded = await this.getMap();

    for (const storedTabId of Object.keys(excluded)) {
      const tabId = Number(storedTabId);
      if (!Number.isInteger(tabId)) continue;

      const queriedTab = queriedTabs.get(tabId);
      if (queriedTab) {
        if (await this.isExcludedNow(tabId, queriedTab.url)) {
          await this.extensionIconService.disableExtensionIcon(tabId);
        }
        continue;
      }

      let tab: chrome.tabs.Tab | null | undefined;
      let confirmedMissing = false;
      try {
        tab = await this.browserApiProvider.tab.get(tabId);
      } catch (error) {
        confirmedMissing = isMissingTabError(error, tabId);
      }

      if (tab) {
        if (await this.isExcludedNow(tabId, tab.url)) {
          await this.extensionIconService.disableExtensionIcon(tabId);
        }
      } else if (confirmedMissing) {
        await this.forgetNow(tabId);
      }
    }

    for (const tab of queriedTabs.values()) {
      if (await this.idleTabLedger.isProtected(tab.id, tab.url)) {
        await this.extensionIconService.disableExtensionIcon(tab.id);
      }
    }
  }

  private async getMap(): Promise<Record<string, ExcludedTabInfo>> {
    const value = (await this.excludedTabsById.get()) as unknown;
    if (Array.isArray(value)) {
      // Migration from older versions where we stored `TabId[]`.
      const migrated: Record<string, ExcludedTabInfo> = {};
      for (const id of value) {
        migrated[String(id)] = {
          url: null,
          excludedAt: new Date(0).toISOString(),
        };
      }
      await this.excludedTabsById.update(() => migrated);
      return migrated;
    }

    if (value && typeof value === "object") {
      return value as Record<string, ExcludedTabInfo>;
    }

    return {};
  }
}
