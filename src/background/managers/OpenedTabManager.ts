import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import type { CleanupDiagnostics } from "../../common/models/CleanupDiagnostics";
import {
  type IConfiguration,
  emptyConfiguration,
} from "../../common/models/Configuration";
import type { RemovedTab, TabCloseReason } from "../../common/models/Tab";
import { logInfo } from "../../common/utils/log";
import type { TabId, WindowId } from "../../types";
import { collectCleanupDiagnostics } from "../utils/CleanupDiagnosticsCollector";
import { CleanupDiagnosticsJournal } from "../utils/CleanupDiagnosticsJournal";
import { toCleanupDiagnosticsTab } from "../utils/DiagnosticTabs";
import { PersistedValue } from "../utils/PersistedValue";
import { SequentialTaskQueue } from "../utils/SequentialTaskQueue";
import type { IConfigurationManager } from "./ConfigurationManager";
import type { IExcludedTabManager } from "./ExcludedTabManager";
import type { IExtensionActionManager } from "./ExtensionActionManager";
import { IdleTabLedger } from "./IdleTabLedger";
import type { IProtectedSiteManager } from "./ProtectedSiteManager";
import { RecentlyClosedHistory } from "./RecentlyClosedHistory";
import type { ISnoozeManager } from "./SnoozeManager";
import type { ITabAlarmManager } from "./TabAlarmManager";
import { TabLifecycle } from "./TabLifecycle";

function isRecoverableUrl(url: string | null | undefined): boolean {
  try {
    const protocol = new URL(url ?? "").protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// Before 1.0.0, Keeps lived in session storage and are lost on update.
const firstDurableKeepVersion = "1.0.0";
const browserSessionStorageKey = "browserSessionStartedAt";

function isVersionBelow(version: string, minimum: string): boolean {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  const minimumParts = minimum.split(".").map(Number);
  for (let index = 0; index < minimumParts.length; index += 1) {
    const part = Number.isFinite(parts[index]) ? parts[index] : 0;
    if (part !== minimumParts[index]) return part < minimumParts[index];
  }
  return false;
}

type DuplicateSourceOwnership = {
  tabId: TabId;
  activityRevision: number;
  pendingCreation: boolean;
};

type IdleRemovalOwnership = {
  recordId: string;
  revision: number;
  scheduledTime: number;
};

type RemovalRequest = {
  tabId: TabId;
  reason: TabCloseReason;
  scheduledTime?: number;
  expectedGeneration?: number;
  expectedActivityRevision: number;
  expectedUrl?: string;
  expectedDuplicateSource?: DuplicateSourceOwnership;
  expectedIdleRecord?: IdleRemovalOwnership;
  safetyRevision: number;
};

export interface IOpenedTabManager {
  beginSafetyMutation(): () => void;
  watchTabs(): Promise<void>;
  getCleanupDiagnostics(): Promise<CleanupDiagnostics>;
  recordKeepStateDiagnostic(
    event: string,
    details: Record<string, unknown>,
  ): void;
  clearCleanupDiagnostics(): Promise<void>;
  getRecentlyClosed(): Promise<RemovedTab[]>;
  getHistorySnapshot(): Promise<{ tabs: RemovedTab[]; activityToken: number }>;
  acknowledgeHistory(token: number): Promise<void>;
  restoreHistoryBadge(): Promise<void>;
  clearRecentlyClosed(): Promise<void>;
  syncRecentlyClosedPersistence(): Promise<void>;
  setDiagnosticsEnabled(enabled: boolean): Promise<void>;
  clearScheduledRemovals(): Promise<void>;
  rescheduleOpenTabs(options?: {
    recalculateIdleDeadlines?: boolean;
  }): Promise<void>;
}

export class OpenedTabManager implements IOpenedTabManager {
  private safetyRevision = 0;
  private pendingSafetyMutations = 0;

  public beginSafetyMutation(): () => void {
    this.safetyRevision += 1;
    this.pendingSafetyMutations += 1;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.pendingSafetyMutations -= 1;
    };
  }

  private diagnosticsEnabled = false;
  private registerOpenTabsRetries = 0;
  private registerOpenTabsRetryTimeoutId: number | null = null;
  private readonly removeTabQueue = new SequentialTaskQueue();
  private readonly tabLifecycleQueue = new SequentialTaskQueue();
  private readonly lifecycle: TabLifecycle;
  private readonly backgroundInstanceId: string;
  private readonly diagnosticJournal: CleanupDiagnosticsJournal;
  private readonly previousActiveTabByWindow: PersistedValue<
    Record<WindowId, TabId>
  >;
  private readonly idleTabLedger: IdleTabLedger;

  private readonly history: RecentlyClosedHistory;
  private browserSessionStart: Promise<void> | null = null;

  constructor(
    private readonly browserApiProvider: Pick<
      IBrowserApiProvider,
      | "localStorage"
      | "runtime"
      | "sessionStorage"
      | "sessionStorageKind"
      | "tab"
    >,
    private readonly tabAlarmManager: ITabAlarmManager,
    private readonly excludedTabManager: IExcludedTabManager,
    private readonly protectedSiteManager: IProtectedSiteManager,
    private readonly snoozeManager: ISnoozeManager,
    private readonly configurationManager: IConfigurationManager,
    private readonly extensionActionManager: IExtensionActionManager,
    idleTabLedger?: IdleTabLedger,
  ) {
    this.backgroundInstanceId = this.createBackgroundInstanceId();
    this.diagnosticJournal = new CleanupDiagnosticsJournal(
      this.browserApiProvider.localStorage,
      undefined,
      false,
    );
    this.previousActiveTabByWindow = new PersistedValue<
      Record<WindowId, TabId>
    >(this.browserApiProvider.sessionStorage, "previousActiveTabByWindow", {});

    this.idleTabLedger =
      idleTabLedger ?? new IdleTabLedger(this.browserApiProvider.localStorage);

    this.lifecycle = new TabLifecycle(this.browserApiProvider.sessionStorage);

    this.history = new RecentlyClosedHistory(
      this.browserApiProvider.sessionStorage,
      this.browserApiProvider.localStorage,
      async () =>
        (await this.configurationManager.get()).rememberRecentlyClosedTabs,
    );

    this.registerOpenTabs = this.registerOpenTabs.bind(this);
    this.onInstalled = this.onInstalled.bind(this);
    this.onTabActivated = this.onTabActivated.bind(this);
    this.onTabCreated = this.onTabCreated.bind(this);
    this.onTabUpdated = this.onTabUpdated.bind(this);
    this.onTabRemoved = this.onTabRemoved.bind(this);

    this.tabAlarmManager.onIdleAlarm((recordId, revision, scheduledTime) => {
      this.recordDiagnostic("alarm-fired", {
        recordId,
        revision,
        scheduledTime,
      });
      void this.removeIdleRecord(recordId, revision, scheduledTime).catch(
        () => undefined,
      );
    });
  }

  public async getRecentlyClosed(): Promise<RemovedTab[]> {
    return this.history.get();
  }

  public getHistorySnapshot() {
    return this.history.snapshot();
  }

  public async acknowledgeHistory(token: number): Promise<void> {
    await this.history.acknowledge(token);
    await this.restoreHistoryBadge();
  }

  public async restoreHistoryBadge(): Promise<void> {
    await this.extensionActionManager.setBadgeCounter(
      await this.history.unread(),
    );
  }

  public async setDiagnosticsEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.diagnosticsEnabled) {
      if (!enabled) await this.diagnosticJournal.setEnabled(false);
      return;
    }
    this.diagnosticsEnabled = enabled;
    await this.diagnosticJournal.setEnabled(enabled);
    if (enabled) {
      this.recordDiagnostic("background-instance-started", {
        instanceId: this.backgroundInstanceId,
        sessionStorageKind: this.browserApiProvider.sessionStorageKind,
      });
    }
  }

  public async clearRecentlyClosed(): Promise<void> {
    await this.history.clear();
    await this.restoreHistoryBadge();
  }

  public async syncRecentlyClosedPersistence(): Promise<void> {
    await this.history.sync();
  }

  public getCleanupDiagnostics(): Promise<CleanupDiagnostics> {
    return collectCleanupDiagnostics({
      background: {
        instanceId: this.backgroundInstanceId,
        sessionStorageKind: this.browserApiProvider.sessionStorageKind,
      },
      allTabs: () => this.browserApiProvider.tab.query({}),
      inactiveTabs: () => this.safeQueryTabs(),
      alarms: () => this.tabAlarmManager.getAlarms(),
      events: () => this.diagnosticJournal.list(),
      records: () => this.idleTabLedger.getDiagnosticRecords(),
      recordFailure: (event, details) => this.recordDiagnostic(event, details),
    });
  }

  public recordKeepStateDiagnostic(
    event: string,
    details: Record<string, unknown>,
  ): void {
    this.recordDiagnostic(event, details);
  }

  public async clearCleanupDiagnostics(): Promise<void> {
    await this.diagnosticJournal.clear();
  }

  public async clearScheduledRemovals(): Promise<void> {
    const tabs = await this.safeQueryTabs();
    await Promise.all(
      tabs
        .map((t) => t.id)
        .filter((id): id is TabId => typeof id === "number")
        .map(async (id) => {
          try {
            await this.clearAlarm(id);
          } catch {}
        }),
    );
  }

  public async rescheduleOpenTabs(
    options: { recalculateIdleDeadlines?: boolean } = {},
  ): Promise<void> {
    this.registerOpenTabsRetries = 0;
    if (this.registerOpenTabsRetryTimeoutId) {
      clearTimeout(this.registerOpenTabsRetryTimeoutId);
      this.registerOpenTabsRetryTimeoutId = null;
    }

    if (options.recalculateIdleDeadlines) {
      const tabs = await this.safeQueryTabs();
      await Promise.all(
        tabs
          .map((tab) => tab.id)
          .filter((tabId): tabId is TabId => typeof tabId === "number")
          .map((tabId) => this.clearAlarm(tabId)),
      );
      const configuration = await this.configurationManager.get();
      await this.idleTabLedger.resetDeadlines(
        configuration.tabRemovalDelayMin * 60_000,
      );
    }
    await this.registerOpenTabs();
  }

  public async watchTabs(): Promise<void> {
    this.browserApiProvider.runtime.onInstalled.addListener(this.onInstalled);
    this.browserApiProvider.runtime.onStartup.addListener(() =>
      this.registerOpenTabs(),
    );

    this.browserApiProvider.tab.onActivated.addListener(this.onTabActivated);
    this.browserApiProvider.tab.onCreated.addListener(this.onTabCreated);
    this.browserApiProvider.tab.onUpdated.addListener(this.onTabUpdated);
    this.browserApiProvider.tab.onRemoved.addListener(this.onTabRemoved);
  }

  // Keeps made before 1.0.0 cannot be migrated, so tabs idle for longer than
  // the delay would close right after the update. Give every tab a full delay
  // from the update instead.
  private async onInstalled(
    details?: chrome.runtime.InstalledDetails,
  ): Promise<void> {
    const upgradedFromSessionKeeps =
      details?.reason === "update" &&
      typeof details.previousVersion === "string" &&
      isVersionBelow(details.previousVersion, firstDurableKeepVersion);
    await this.registerOpenTabs(
      upgradedFromSessionKeeps ? { idleSince: Date.now() } : {},
    );
  }

  // Session storage is cleared when the browser restarts but survives worker
  // restarts. Checking it here, instead of waiting for onStartup, means the
  // background's own first reconcile cannot run against stale tab IDs.
  private startBrowserSessionIfNew(): Promise<void> {
    this.browserSessionStart ??= (async () => {
      const stored = (await this.browserApiProvider.sessionStorage.get(
        browserSessionStorageKey,
      )) as unknown as Record<string, unknown> | undefined;
      if (stored?.[browserSessionStorageKey] !== undefined) return;
      await this.excludedTabManager.startBrowserSession();
      await this.browserApiProvider.sessionStorage.set({
        [browserSessionStorageKey]: Date.now(),
      });
    })().catch((error) => {
      this.browserSessionStart = null;
      this.recordDiagnostic("browser-session-start-failed", {
        error: String(error),
      });
    });
    return this.browserSessionStart;
  }

  private async registerOpenTabs(
    options: { idleSince?: number } = {},
  ): Promise<void> {
    await this.startBrowserSessionIfNew();
    await this.tabAlarmManager.clearLegacyAlarms();
    const allTabs = await this.safeQueryAllTabs();
    const tabs = allTabs.filter(
      (tab) => this.isVisibleTab(tab) && tab.active !== true,
    );
    if (allTabs.length > 0) {
      this.lifecycle.forgetTabsExcept(
        new Set(
          allTabs
            .map((tab) => tab.id)
            .filter((id): id is TabId => typeof id === "number"),
        ),
      );
    }
    await this.idleTabLedger.reconcile(allTabs);
    if (options.idleSince !== undefined) {
      await Promise.all(
        allTabs
          .map((tab) => tab.id)
          .filter((tabId): tabId is TabId => typeof tabId === "number")
          .map((tabId) => this.clearAlarm(tabId)),
      );
      await this.idleTabLedger.restartIdleClocks(options.idleSince);
    }
    await this.excludedTabManager.reconcileOpenTabs(allTabs);
    await this.previousActiveTabByWindow.update((previous) => ({
      ...previous,
      ...Object.fromEntries(
        allTabs
          .filter((tab) => tab.active && typeof tab.id === "number")
          .map((tab) => [tab.windowId, tab.id]),
      ),
    }));

    await Promise.allSettled(tabs.map((tab) => this.scheduleTabRemoval(tab)));

    if (tabs.length === 0 && this.registerOpenTabsRetries < 3) {
      this.registerOpenTabsRetries += 1;
      if (this.registerOpenTabsRetryTimeoutId) {
        clearTimeout(this.registerOpenTabsRetryTimeoutId);
      }
      this.registerOpenTabsRetryTimeoutId = setTimeout(() => {
        this.registerOpenTabs(options).catch(() => undefined);
      }, 500 * this.registerOpenTabsRetries) as unknown as number;
    }
  }

  private isVisibleTab(tab: chrome.tabs.Tab): boolean {
    return (tab as chrome.tabs.Tab & { hidden?: boolean }).hidden !== true;
  }

  private async safeQueryTabs(
    windowId?: WindowId,
  ): Promise<ReadonlyArray<chrome.tabs.Tab>> {
    try {
      const tabs = await this.browserApiProvider.tab.query({ active: false });
      const filteredTabs = Array.isArray(tabs)
        ? tabs.filter(
            (tab) =>
              this.isVisibleTab(tab) &&
              (typeof windowId !== "number" || tab.windowId === windowId),
          )
        : [];
      if (typeof windowId !== "number" || filteredTabs.length > 0) {
        return filteredTabs;
      }

      const fallbackTabs = await this.browserApiProvider.tab.query({
        active: false,
        windowId,
      });
      return Array.isArray(fallbackTabs)
        ? fallbackTabs.filter(
            (tab) => this.isVisibleTab(tab) && tab.windowId === windowId,
          )
        : [];
    } catch {
      return [];
    }
  }

  private async safeQueryAllTabs(): Promise<ReadonlyArray<chrome.tabs.Tab>> {
    try {
      const tabs = await this.browserApiProvider.tab.query({});
      return Array.isArray(tabs) ? tabs.filter(this.isVisibleTab) : [];
    } catch {
      return [];
    }
  }

  private async reconcileLiveTab(tabId: TabId): Promise<void> {
    await this.idleTabLedger.reconcile(
      await this.safeQueryAllTabs(),
      new Set([tabId]),
    );
  }

  private async safeQueryVisibleTabsInWindow(
    tab: chrome.tabs.Tab,
  ): Promise<ReadonlyArray<chrome.tabs.Tab> | null> {
    if (typeof tab.id !== "number" || typeof tab.windowId !== "number") {
      return null;
    }

    try {
      const tabs = await this.browserApiProvider.tab.query({});
      if (!Array.isArray(tabs)) {
        this.recordDiagnostic("threshold-window-query", {
          containsCandidate: false,
          queryStrategy: "global-local-window-filter",
          requestedTabId: tab.id,
          requestedWindowId: tab.windowId,
          returnedTabs: [],
          validArray: false,
        });
        return null;
      }

      const visibleTabs = tabs.filter((candidate) =>
        this.isVisibleTab(candidate),
      );
      let windowTabs = visibleTabs.filter(
        (candidate) => candidate.windowId === tab.windowId,
      );
      let containsCandidate = windowTabs.some(
        (candidate) => candidate.id === tab.id,
      );
      let queryStrategy = "global-local-window-filter";

      if (!containsCandidate) {
        const fallbackTabs = await this.browserApiProvider.tab.query({
          windowId: tab.windowId,
        });
        if (Array.isArray(fallbackTabs)) {
          windowTabs = fallbackTabs.filter(
            (candidate) =>
              this.isVisibleTab(candidate) &&
              candidate.windowId === tab.windowId,
          );
          containsCandidate = windowTabs.some(
            (candidate) => candidate.id === tab.id,
          );
          queryStrategy = "exact-window-local-filter-fallback";
        }
      }

      this.recordDiagnostic("threshold-window-query", {
        containsCandidate,
        queryStrategy,
        rawVisibleTabCount: visibleTabs.length,
        rawWindowIds: [
          ...new Set(
            visibleTabs
              .map((candidate) => candidate.windowId)
              .filter(
                (windowId): windowId is number => typeof windowId === "number",
              ),
          ),
        ],
        requestedTabId: tab.id,
        requestedWindowId: tab.windowId,
        returnedTabs: windowTabs.map(toCleanupDiagnosticsTab),
        sameWindow: true,
        visibleTabCount: windowTabs.length,
      });
      return containsCandidate ? windowTabs : null;
    } catch {
      this.recordDiagnostic("threshold-window-query-failed", {
        requestedTabId: tab.id,
        requestedWindowId: tab.windowId,
      });
      return null;
    }
  }

  private async safeGetTab(tabId: TabId): Promise<chrome.tabs.Tab | null> {
    try {
      return (await this.browserApiProvider.tab.get(tabId)) ?? null;
    } catch (e) {
      logInfo("Tab not found", tabId, e);
      return null;
    }
  }

  private async onTabCreated(tab: chrome.tabs.Tab): Promise<void> {
    const tabId = tab.id;
    if (typeof tabId !== "number") return;
    this.recordDiagnostic("tab-created", toCleanupDiagnosticsTab(tab));
    const creationRevision = this.lifecycle.beginTabCreation(tabId);
    const generationUpdate = this.lifecycle.nextTabGeneration(tabId);

    try {
      const { generation } = await generationUpdate;
      if (!this.lifecycle.isPendingCreationOwner(tabId, creationRevision))
        return;

      await this.tabLifecycleQueue
        .addTask(async () => {
          if (
            !this.lifecycle.isPendingCreationOwner(tabId, creationRevision) ||
            !(await this.lifecycle.isCurrentTabGeneration(tabId, generation))
          ) {
            return;
          }

          await this.scheduleTabRemoval(tab, creationRevision);
        })
        .catch(() => undefined);

      if (
        this.lifecycle.isPendingCreationOwner(tabId, creationRevision) &&
        (await this.lifecycle.isCurrentTabGeneration(tabId, generation))
      ) {
        await this.removeDuplicatesIfNecessary(
          tabId,
          tab.url ?? null,
          creationRevision,
          true,
        );
      }
    } finally {
      this.lifecycle.endTabCreation(tabId, creationRevision);
      await this.replayPendingDuplicateUpdate(tabId);

      // When the threshold mode is enabled, ensure other tabs are
      // (re)scheduled once the tab count crosses the threshold.
      this.scheduleThresholdReconcile(tab.windowId);
    }
  }

  private async onTabUpdated(
    tabId: TabId,
    tabUpdateInfo: chrome.tabs.TabChangeInfo,
  ) {
    const isSafetyUpdate = this.isRemovalSafetyUpdate(tabUpdateInfo);
    const activityRevision = isSafetyUpdate
      ? this.lifecycle.advanceTabActivityRevision(tabId)
      : this.lifecycle.getTabActivityRevision(tabId);
    const updatedUrl = tabUpdateInfo.url ?? null;

    if (
      updatedUrl &&
      this.lifecycle.queueDuplicateUpdate(tabId, updatedUrl, activityRevision)
    ) {
      return;
    }

    if (updatedUrl) {
      await this.reconcileLiveTab(tabId);
    }

    await this.removeDuplicatesIfNecessary(
      tabId,
      updatedUrl,
      activityRevision,
    ).catch(() => undefined);

    if (
      isSafetyUpdate &&
      this.lifecycle.isLifecycleOwner(tabId, activityRevision)
    ) {
      void this.scheduleTabRemoval(tabId, activityRevision).catch(
        () => undefined,
      );
    }
  }

  private async replayPendingDuplicateUpdate(tabId: TabId): Promise<void> {
    const update = this.lifecycle.takePendingDuplicateUpdate(tabId);
    if (!update) {
      return;
    }

    await this.reconcileLiveTab(tabId);
    await this.removeDuplicatesIfNecessary(
      tabId,
      update.url,
      update.activityRevision,
    ).catch(() => undefined);
    await this.scheduleTabRemoval(tabId, update.activityRevision).catch(
      () => undefined,
    );
  }

  private async removeDuplicatesIfNecessary(
    tabId: TabId,
    url: string | null,
    sourceActivityRevision = this.lifecycle.getTabActivityRevision(tabId),
    sourceIsPendingCreation = false,
  ): Promise<void> {
    const source: DuplicateSourceOwnership = {
      tabId,
      activityRevision: sourceActivityRevision,
      pendingCreation: sourceIsPendingCreation,
    };
    if (!this.ownsDuplicateSource(source)) return;
    if (await this.snoozeManager.isSnoozed()) return;
    if (!url) return;

    const config = await this.configurationManager.get();
    if (!config?.removeExactDuplicates || !this.ownsDuplicateSource(source)) {
      return;
    }

    const generationSnapshot = await this.lifecycle.generationSnapshot();
    const activityRevisionSnapshot = this.lifecycle.activitySnapshot();
    let duplicates: ReadonlyArray<chrome.tabs.Tab>;
    try {
      // Match URLs here rather than via query({ url }): Safari treats that
      // filter as a match pattern and misses addresses with query strings.
      const queriedTabs = await this.browserApiProvider.tab.query({
        active: false,
      });
      if (!Array.isArray(queriedTabs)) {
        return;
      }
      duplicates = queriedTabs.filter((tab) => tab.url === url);
    } catch {
      return;
    }
    if (!this.ownsDuplicateSource(source)) return;

    const candidates = duplicates
      .filter((tab) => this.isVisibleTab(tab))
      .filter(
        (tab): tab is chrome.tabs.Tab & { id: TabId } =>
          typeof tab.id === "number" && tab.id !== tabId,
      )
      .map((tab) => ({
        tabId: tab.id,
        generation: generationSnapshot[tab.id] ?? 0,
        activityRevision: activityRevisionSnapshot.get(tab.id) ?? 0,
      }));

    this.recordDiagnostic("duplicate-query-completed", {
      candidateIds: candidates.map((candidate) => candidate.tabId),
      matchCount: duplicates.length,
      tabId,
      url,
    });

    // The source tab itself is never removed; only its older duplicates are.
    for (const candidate of candidates) {
      if (!this.ownsDuplicateSource(source)) return;
      await this.removeTab({
        tabId: candidate.tabId,
        reason: "duplicate",
        expectedGeneration: candidate.generation,
        expectedActivityRevision: candidate.activityRevision,
        expectedUrl: url,
        expectedDuplicateSource: source,
        safetyRevision: this.safetyRevision,
      });
    }
  }

  private ownsDuplicateSource(source: DuplicateSourceOwnership): boolean {
    return this.lifecycle.isDuplicateSourceOwner(
      source.tabId,
      source.activityRevision,
      source.pendingCreation,
    );
  }

  // A queued removal acts only if nothing changed since it was requested:
  // no protection change, no newer activity on the tab, and (for duplicates)
  // the tab that triggered it is still the same.
  private isRemovalRequestCurrent(request: RemovalRequest): boolean {
    return (
      this.pendingSafetyMutations === 0 &&
      request.safetyRevision === this.safetyRevision &&
      this.lifecycle.isRemovalLifecycleCurrent(
        request.tabId,
        request.expectedActivityRevision,
      ) &&
      (!request.expectedDuplicateSource ||
        this.ownsDuplicateSource(request.expectedDuplicateSource))
    );
  }

  private async onTabActivated(
    activeInfo: chrome.tabs.TabActiveInfo,
  ): Promise<void> {
    const activatedAt = Date.now();
    const { windowId, tabId } = activeInfo;
    this.lifecycle.advanceTabActivityRevision(tabId);

    await this.clearAlarm(tabId);
    await this.idleTabLedger.markActive(tabId).catch(() => undefined);

    const previousActiveIds = await this.previousActiveTabByWindow.get();
    const previousId = previousActiveIds[windowId];
    if (typeof previousId === "number" && previousId !== tabId) {
      await this.idleTabLedger.markInactive(previousId, activatedAt);
      await this.scheduleTabRemoval(previousId);
    }

    await this.previousActiveTabByWindow.update((previousActiveIds) => ({
      ...previousActiveIds,
      [windowId]: tabId,
    }));
  }

  private async onTabRemoved(
    tabId: TabId,
    removeInfo?: chrome.tabs.TabRemoveInfo,
  ): Promise<void> {
    const pendingCreationRevision =
      this.lifecycle.pendingCreationRevision(tabId);
    if (typeof pendingCreationRevision === "number") {
      this.lifecycle.beginRemovalValidation(tabId, pendingCreationRevision);
      const currentTab = await this.safeGetTab(tabId);
      if (this.lifecycle.creationRevision(tabId) !== pendingCreationRevision) {
        this.lifecycle.endTabRemovalValidation(tabId, pendingCreationRevision);
        await this.replayPendingDuplicateUpdate(tabId);
        this.scheduleThresholdReconcile(removeInfo?.windowId);
        return;
      }
      if (currentTab) {
        this.lifecycle.endTabRemovalValidation(tabId, pendingCreationRevision);
        await this.replayPendingDuplicateUpdate(tabId);
        this.scheduleThresholdReconcile(removeInfo?.windowId);
        return;
      }

      // The pending tab genuinely closed. Its duplicate ownership was blocked
      // before the existence check and cleanup must proceed even if its
      // creation handler reached finally while that check was pending.
      this.lifecycle.endTabCreation(tabId, pendingCreationRevision);
      this.lifecycle.endTabRemovalValidation(tabId, pendingCreationRevision);
    }

    this.lifecycle.forgetCreation(tabId);
    const removalRevision = this.lifecycle.advanceTabActivityRevision(tabId);
    const generationRead = this.lifecycle.getTabGeneration(tabId);
    if (removeInfo?.isWindowClosing) {
      const generation = await generationRead;
      if (this.lifecycle.isLifecycleOwner(tabId, removalRevision)) {
        await this.tabLifecycleQueue.addTask(async () => {
          if (
            !this.lifecycle.isLifecycleOwner(tabId, removalRevision) ||
            !(await this.lifecycle.isCurrentTabGeneration(tabId, generation))
          ) {
            return;
          }
          const detachedRecord = await this.idleTabLedger.detachTab(tabId);
          if (detachedRecord?.deadline !== undefined) {
            await this.tabAlarmManager
              .clearIdleAlarm(detachedRecord.id, detachedRecord.revision)
              .catch(() => undefined);
          }
          this.recordDiagnostic("tab-detached-window-closing", { tabId });
        });
      }
      return;
    }
    // Same-URL tabs held only by this tab's Keep can close once it is gone.
    // Read them before the Keep is deleted below.
    const heldTabIdsRead = this.idleTabLedger
      .getHeldTabIds(tabId)
      .catch((): TabId[] => []);
    // Queue stale exclusion deletion before any later user keep write.
    const staleExclusionCleanup = this.excludedTabManager.forget(tabId);
    const generation = await generationRead;
    await staleExclusionCleanup;
    for (const heldTabId of await heldTabIdsRead) {
      void this.scheduleTabRemoval(heldTabId).catch(() => undefined);
    }
    if (this.lifecycle.isLifecycleOwner(tabId, removalRevision)) {
      await this.tabLifecycleQueue.addTask(async () => {
        if (
          !this.lifecycle.isLifecycleOwner(tabId, removalRevision) ||
          !(await this.lifecycle.isCurrentTabGeneration(tabId, generation))
        ) {
          return;
        }
        await this.clearAlarm(tabId);
        await this.idleTabLedger.removeTab(tabId).catch(() => undefined);
      });
    }
    this.scheduleThresholdReconcile(removeInfo?.windowId);
  }

  private async removeIdleRecord(
    recordId: string,
    revision: number,
    scheduledTime: number,
  ): Promise<void> {
    const record = await this.idleTabLedger.resolveAlarm(
      recordId,
      revision,
      scheduledTime,
    );
    if (!record || typeof record.tabId !== "number") {
      this.recordDiagnostic("remove-skipped-idle-identity", {
        recordId,
        revision,
        scheduledTime,
      });
      return;
    }

    const tab = await this.safeGetTab(record.tabId);
    if (
      !tab ||
      !(await this.idleTabLedger.isCurrentBinding(recordId, revision, tab))
    ) {
      this.recordDiagnostic("remove-skipped-idle-identity", {
        recordId,
        revision,
        scheduledTime,
        tabId: record.tabId,
      });
      return;
    }

    await this.removeTab({
      tabId: record.tabId,
      reason: "idle",
      scheduledTime,
      expectedActivityRevision: this.lifecycle.getTabActivityRevision(
        record.tabId,
      ),
      expectedIdleRecord: { recordId, revision, scheduledTime },
      safetyRevision: this.safetyRevision,
    });
  }

  private async removeTab(request: RemovalRequest): Promise<void> {
    await this.removeTabQueue.addTask(() => this.removeTabNow(request));
  }

  private async removeTabNow(request: RemovalRequest): Promise<void> {
    const {
      tabId,
      reason,
      scheduledTime,
      expectedGeneration,
      expectedUrl,
      expectedIdleRecord,
    } = request;
    if (
      this.pendingSafetyMutations > 0 ||
      request.safetyRevision !== this.safetyRevision
    )
      return;

    this.recordDiagnostic("remove-attempt", { reason, tabId });

    if (!this.isRemovalRequestCurrent(request)) {
      this.recordDiagnostic("remove-skipped-stale-lifecycle", {
        reason,
        tabId,
      });
      return;
    }

    if (await this.snoozeManager.isSnoozed()) {
      this.recordDiagnostic("remove-skipped-snoozed", { reason, tabId });
      return;
    }

    const initialTab = await this.safeGetTab(tabId);
    if (!initialTab) {
      this.recordDiagnostic("remove-skipped-tab-not-found", { reason, tabId });
      return;
    }

    const configuration = await this.configurationManager.get();

    if (!(await this.canRemoveTab(initialTab, configuration))) {
      this.recordDiagnostic("remove-skipped-ineligible", {
        reason,
        tab: toCleanupDiagnosticsTab(initialTab),
      });
      if (!initialTab.active) {
        await this.scheduleTabRemoval(initialTab);
      }
      return;
    }

    // Refresh after eligibility awaits so URL/window/state validation is bound
    // to the latest browser tab incarnation.
    const tab = await this.safeGetTab(tabId);
    if (!tab || !(await this.canRemoveTab(tab, configuration))) {
      this.recordDiagnostic("remove-skipped-refresh-ineligible", {
        reason,
        tab: tab ? toCleanupDiagnosticsTab(tab) : undefined,
        tabId,
      });
      if (tab && !tab.active) {
        await this.scheduleTabRemoval(tab);
      }
      return;
    }

    // All persisted generation/deadline and exact-URL checks complete before
    // the final count query.
    if (
      !(await this.isPersistedRemovalIdentityCurrent(
        tab,
        reason,
        scheduledTime,
        expectedGeneration,
        expectedUrl,
        expectedIdleRecord,
      ))
    ) {
      this.recordDiagnostic("remove-skipped-identity", { reason, tabId });
      return;
    }

    if (
      reason !== "duplicate" &&
      !(await this.isTabWindowAboveThreshold(
        tab,
        configuration?.tabCountThreshold ?? 0,
        true,
      ))
    ) {
      this.recordDiagnostic("remove-skipped-threshold", {
        reason,
        tab: toCleanupDiagnosticsTab(tab),
        threshold: configuration?.tabCountThreshold ?? 0,
      });
      return;
    }

    // No await is permitted between this in-memory check and remove.
    if (!this.isRemovalRequestCurrent(request)) {
      this.recordDiagnostic("remove-skipped-final-lifecycle", {
        reason,
        tabId,
      });
      return;
    }

    await this.browserApiProvider.tab.remove(tabId);
    this.recordDiagnostic("remove-completed", { reason, tabId });
    await Promise.allSettled([this.recordRecentlyClosed(tab, reason)]);
  }

  private async recordRecentlyClosed(
    tab: chrome.tabs.Tab,
    reason: TabCloseReason,
  ): Promise<void> {
    const removedTab: RemovedTab = {
      entryId: globalThis.crypto.randomUUID(),
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      removedAt: new Date().toISOString(),
      reason,
    };
    try {
      await this.history.append(removedTab);
    } finally {
      await this.restoreHistoryBadge();
    }
  }

  private async scheduleTabRemoval(
    tabOrId: chrome.tabs.Tab | TabId | undefined,
    expectedLifecycleRevision?: number,
  ): Promise<void> {
    const tabId = typeof tabOrId === "number" ? tabOrId : tabOrId?.id;
    if (typeof tabId !== "number") return;
    const activityRevision =
      expectedLifecycleRevision ?? this.lifecycle.getTabActivityRevision(tabId);
    const scheduleClaim = this.lifecycle.claimTabSchedule(tabId);
    const generation = await this.lifecycle.getTabGeneration(tabId);
    // Any newer activity or schedule for this tab supersedes this one; check
    // after every await so stale work never writes an alarm or clears one.
    const stillOwned = () =>
      this.lifecycle.isScheduleOwner(
        tabId,
        generation,
        activityRevision,
        scheduleClaim,
      );
    const clearIfOwned = async (clearInactiveAge = false) => {
      if (!(await stillOwned())) return;
      await this.clearAlarm(tabId);
      if (clearInactiveAge) {
        await this.idleTabLedger.markActive(tabId).catch(() => undefined);
      }
    };
    if (!(await stillOwned())) return;

    // Event/query snapshots are advisory only; eligibility and age always bind
    // to a fresh browser state for this lifecycle/schedule claim.
    const tab = await this.safeGetTab(tabId);
    if (!tab) {
      this.recordDiagnostic("schedule-skipped-tab-not-found", { tabId });
      await clearIfOwned();
      return;
    }

    const configuration = await this.configurationManager.get();
    if (!(await stillOwned())) return;

    if (tab.active) {
      this.recordDiagnostic(
        "schedule-skipped-active",
        toCleanupDiagnosticsTab(tab),
      );
      await clearIfOwned(true);
      return;
    }

    // Check eligibility before touching the deadline: time spent unable to
    // close (audible, pinned, protected, paused) never counts as idle.
    if (
      (await this.snoozeManager.isSnoozed()) ||
      !(await this.canRemoveTab(tab, configuration))
    ) {
      this.recordDiagnostic("schedule-skipped-ineligible", {
        tab: toCleanupDiagnosticsTab(tab),
      });
      if (!(await stillOwned())) return;
      await this.clearAlarm(tabId);
      await this.idleTabLedger.holdInactive(tab);
      return;
    }
    if (!(await stillOwned())) return;

    const idleRecord = await this.idleTabLedger.ensureInactive(
      tab,
      configuration.tabRemovalDelayMin * 60_000,
    );
    const deadline = idleRecord.deadline;
    if (!(await stillOwned())) return;

    if (!deadline) {
      this.recordDiagnostic("schedule-skipped-ineligible", {
        deadline,
        tab: toCleanupDiagnosticsTab(tab),
      });
      await clearIfOwned();
      return;
    }

    if (
      !(await this.isTabWindowAboveThreshold(
        tab,
        configuration.tabCountThreshold,
      ))
    ) {
      this.recordDiagnostic("schedule-skipped-threshold", {
        tab: toCleanupDiagnosticsTab(tab),
        threshold: configuration.tabCountThreshold,
      });
      // Ensure there's no stale alarm that could fire after the threshold is met again.
      await clearIfOwned();
      return;
    }

    if (!(await stillOwned())) return;

    await this.tabAlarmManager.setIdleAlarm(
      idleRecord.id,
      deadline,
      idleRecord.revision,
    );
    this.recordDiagnostic("schedule-alarm-set", {
      deadline,
      recordId: idleRecord.id,
      revision: idleRecord.revision,
      tab: toCleanupDiagnosticsTab(tab),
    });
  }

  private scheduleThresholdReconcile(windowId?: WindowId): void {
    // Best-effort: threshold mode is a safety feature, so avoid throwing/awaiting
    // in tab event handlers.
    void this.reconcileThreshold(windowId).catch(() => undefined);
  }

  private async reconcileThreshold(windowId?: WindowId): Promise<void> {
    const configuration = await this.configurationManager.get();
    const threshold = configuration.tabCountThreshold;
    if (!threshold || threshold <= 0) {
      return;
    }

    // Re-run scheduling whenever tabs are created/removed so alarms match the
    // current threshold state. `scheduleTabRemoval` will clear alarms when the
    // threshold isn't met.
    if (typeof windowId === "number") {
      const tabs = await this.safeQueryTabs(windowId);
      await Promise.all(tabs.map((tab) => this.scheduleTabRemoval(tab)));
      return;
    }

    await this.registerOpenTabs();
  }

  private async canRemoveTab(
    tab: chrome.tabs.Tab,
    configuration: IConfiguration,
  ): Promise<boolean> {
    if (!tab || typeof tab.id !== "number") return false;

    if (tab.active) {
      return false;
    }

    if (!isRecoverableUrl(tab.url)) {
      return false;
    }

    if (await this.excludedTabManager.isExcluded(tab.id, tab.url)) {
      return false;
    }

    if (await this.protectedSiteManager.isProtectedUrl(tab.url ?? null)) {
      return false;
    }

    const makesSound = configuration.keepAudibleTabs && Boolean(tab.audible);
    const groupId = typeof tab.groupId === "number" ? tab.groupId : -1;
    const isInGroup = configuration.keepGroupedTabs && groupId !== -1;
    const isPinned = configuration.keepPinnedTabs && tab.pinned;

    return !isPinned && !makesSound && !isInGroup;
  }

  private async isTabWindowAboveThreshold(
    tab: chrome.tabs.Tab | null | undefined,
    threshold: number,
    verifyVisibleCandidate = false,
  ): Promise<boolean> {
    if (typeof tab?.windowId !== "number") {
      return false;
    }

    if ((!threshold || threshold <= 0) && !verifyVisibleCandidate) {
      return true;
    }

    const tabs = await this.safeQueryVisibleTabsInWindow(tab);
    if (tabs === null) {
      return false;
    }

    return !threshold || threshold <= 0 || tabs.length > threshold;
  }

  private async clearAlarm(tabId: TabId): Promise<void> {
    try {
      const record = await this.idleTabLedger.getBoundRecord(tabId);
      if (!record || record.deadline === undefined) return;
      await this.tabAlarmManager.clearIdleAlarm(record.id, record.revision);
      this.recordDiagnostic("alarm-cleared", {
        recordId: record.id,
        revision: record.revision,
        tabId,
      });
    } catch {}
  }

  private isRemovalSafetyUpdate(
    tabUpdateInfo: chrome.tabs.TabChangeInfo,
  ): boolean {
    return (
      "url" in tabUpdateInfo ||
      "pinned" in tabUpdateInfo ||
      "audible" in tabUpdateInfo ||
      "groupId" in tabUpdateInfo
    );
  }

  private async isPersistedRemovalIdentityCurrent(
    tab: chrome.tabs.Tab,
    reason: TabCloseReason,
    scheduledTime?: number,
    expectedGeneration?: number,
    expectedUrl?: string,
    expectedIdleRecord?: IdleRemovalOwnership,
  ): Promise<boolean> {
    const tabId = tab.id;
    if (typeof tabId !== "number") return false;

    if (reason === "idle") {
      return (
        expectedIdleRecord !== undefined &&
        scheduledTime === expectedIdleRecord.scheduledTime &&
        (await this.idleTabLedger.isCurrentBinding(
          expectedIdleRecord.recordId,
          expectedIdleRecord.revision,
          tab,
        ))
      );
    }

    if (reason !== "duplicate") {
      return true;
    }

    return (
      typeof expectedGeneration === "number" &&
      typeof expectedUrl === "string" &&
      tab.url === expectedUrl &&
      (await this.lifecycle.isCurrentTabGeneration(tabId, expectedGeneration))
    );
  }

  private recordDiagnostic(
    event: string,
    details?: Record<string, unknown>,
  ): void {
    this.diagnosticJournal.record({
      at: new Date().toISOString(),
      details,
      event,
    });
  }

  private createBackgroundInstanceId(): string {
    try {
      return globalThis.crypto.randomUUID();
    } catch {
      return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }
}
