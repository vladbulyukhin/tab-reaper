import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import type { TabId } from "../../types";
import { SequentialTaskQueue } from "../utils/SequentialTaskQueue";

const storageKey = "idleTabLedger";
const maximumRecords = 1_000;

export type IdleTabRecord = {
  contextKey: string;
  deadline?: number;
  id: string;
  kept: boolean;
  uncertainKeep?: boolean;
  keepSourceIds?: string[];
  inactiveSince?: number;
  lastSeenAt: number;
  ordinal: number;
  revision: number;
  tabId?: TabId;
  urlKey: string;
};

export type IdleTabDiagnosticRecord = Pick<
  IdleTabRecord,
  "deadline" | "id" | "kept" | "uncertainKeep" | "revision" | "tabId"
>;

type IdleTabLedgerState = {
  records: IdleTabRecord[];
  salt: string;
  version: 1;
};

type TabIdentity = {
  contextKey: string;
  ordinal: number;
  tab: chrome.tabs.Tab;
  urlKey: string;
};

const normalizeUrl = (url: string): string => {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
};

const createId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

const hash = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const emptyState = (): IdleTabLedgerState => ({
  records: [],
  salt: createId(),
  version: 1,
});

const trimRecords = (records: IdleTabRecord[]) => [
  ...records.filter((record) => record.kept || record.uncertainKeep),
  ...records
    .filter((record) => !record.kept && !record.uncertainKeep)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, maximumRecords),
];

const keepSources = (records: IdleTabRecord[], urlKey: string) =>
  records.filter((record) => record.kept && record.urlKey === urlKey);

// A safety hold is derived evidence, never a new Keep. Older ledgers did not
// record its sources; migrate them using explicit Keeps only.
const refreshSafetyHolds = (state: IdleTabLedgerState) => {
  for (const record of state.records) {
    if (!record.uncertainKeep) continue;
    const sources = keepSources(state.records, record.urlKey).filter(
      (source) =>
        !record.keepSourceIds || record.keepSourceIds.includes(source.id),
    );
    record.keepSourceIds = sources.map((source) => source.id);
    record.uncertainKeep = sources.length > 0;
  }
  return state;
};

export class IdleTabLedger {
  private readonly updates = new SequentialTaskQueue();
  private readonly observedRecords = new Set<string>();

  public constructor(private readonly storage: IBrowserStorageAPI) {}

  public async reconcile(
    tabs: ReadonlyArray<chrome.tabs.Tab>,
    trustedTabIds: ReadonlySet<TabId> = new Set(),
  ): Promise<ReadonlyArray<IdleTabRecord>> {
    const state = await this.updateState(async (state) => {
      const identities = await this.identifyTabs(tabs, state.salt);
      const unmatchedRecordIds = new Set(
        state.records.map((record) => record.id),
      );
      const matchedRecordByTabId = new Map<TabId, IdleTabRecord>();

      for (const identity of identities) {
        const tabId = identity.tab.id;
        if (typeof tabId !== "number") continue;
        const direct = state.records.find(
          (record) =>
            record.tabId === tabId &&
            (record.urlKey === identity.urlKey || trustedTabIds.has(tabId)),
        );
        if (!direct || !unmatchedRecordIds.delete(direct.id)) continue;
        matchedRecordByTabId.set(tabId, direct);
      }

      for (const identity of identities) {
        const tabId = identity.tab.id;
        if (typeof tabId !== "number" || matchedRecordByTabId.has(tabId)) {
          continue;
        }
        // An ordinary saved tab with this URL is not proof that the candidate
        // is not the hidden kept tab. Never restore an ordinary timer here.
        if (
          state.records.some(
            (record) =>
              record.urlKey === identity.urlKey &&
              (record.kept || record.uncertainKeep),
          )
        )
          continue;
        const candidates = state.records.filter(
          (record) =>
            unmatchedRecordIds.has(record.id) &&
            !this.observedRecords.has(record.id) &&
            !record.kept &&
            !record.uncertainKeep &&
            record.urlKey === identity.urlKey &&
            record.contextKey === identity.contextKey &&
            record.ordinal === identity.ordinal,
        );
        const currentMatches = identities.filter(
          (other) =>
            other.contextKey === identity.contextKey &&
            other.urlKey === identity.urlKey &&
            other.ordinal === identity.ordinal,
        );
        if (currentMatches.length !== 1) continue;
        if (candidates.length !== 1) continue;
        unmatchedRecordIds.delete(candidates[0].id);
        matchedRecordByTabId.set(tabId, candidates[0]);
      }

      for (const identity of identities) {
        const tabId = identity.tab.id;
        if (typeof tabId !== "number" || matchedRecordByTabId.has(tabId)) {
          continue;
        }
        if (
          state.records.some(
            (record) =>
              record.urlKey === identity.urlKey &&
              (record.kept || record.uncertainKeep),
          )
        )
          continue;
        const candidates = state.records.filter(
          (record) =>
            unmatchedRecordIds.has(record.id) &&
            !this.observedRecords.has(record.id) &&
            !record.kept &&
            !record.uncertainKeep &&
            record.urlKey === identity.urlKey,
        );
        if (
          identities.filter((other) => other.urlKey === identity.urlKey)
            .length !== 1
        )
          continue;
        if (candidates.length !== 1) continue;
        unmatchedRecordIds.delete(candidates[0].id);
        matchedRecordByTabId.set(tabId, candidates[0]);
      }

      // Absence from Safari's query can mean a hidden group, not a closed tab.
      // Retain bindings so returning tabs cannot lose their explicit Keep.

      const now = Date.now();
      for (const identity of identities) {
        const tabId = identity.tab.id;
        if (typeof tabId !== "number") continue;
        const existing = matchedRecordByTabId.get(tabId);
        if (existing) {
          this.observedRecords.add(existing.id);
          existing.tabId = tabId;
          existing.contextKey = identity.contextKey;
          existing.ordinal = identity.ordinal;
          existing.urlKey = identity.urlKey;
          existing.lastSeenAt = now;
          if (identity.tab.active && existing.deadline !== undefined) {
            existing.deadline = undefined;
            existing.revision += 1;
          }
          continue;
        }
        const uncertainKeep = state.records.some(
          (record) => record.urlKey === identity.urlKey && record.kept,
        );
        const id = createId();
        this.observedRecords.add(id);
        state.records.push({
          id,
          contextKey: identity.contextKey,
          kept: false,
          ...(uncertainKeep ? { uncertainKeep: true } : {}),
          ...(uncertainKeep
            ? {
                keepSourceIds: keepSources(state.records, identity.urlKey).map(
                  (source) => source.id,
                ),
              }
            : {}),
          lastSeenAt: now,
          ordinal: identity.ordinal,
          revision: 0,
          tabId,
          urlKey: identity.urlKey,
        });
      }

      state.records = trimRecords(state.records);
      return state;
    });
    return state.records;
  }

  public async ensureInactive(
    tab: chrome.tabs.Tab,
    delayInMilliseconds: number,
  ): Promise<IdleTabRecord> {
    const tabId = tab.id;
    if (typeof tabId !== "number") {
      throw new Error("Idle tab records require a tab ID");
    }
    return await this.updateResult(async (state) => {
      const identity = await this.identifyTab(tab, state.salt, 0);
      for (const candidate of state.records) {
        if (candidate.tabId === tabId && candidate.urlKey !== identity.urlKey) {
          candidate.tabId = undefined;
        }
      }
      let record = state.records.find(
        (candidate) =>
          candidate.tabId === tabId && candidate.urlKey === identity.urlKey,
      );
      if (!record) {
        record = {
          id: createId(),
          contextKey: identity.contextKey,
          kept: false,
          uncertainKeep: state.records.some(
            (candidate) =>
              candidate.urlKey === identity.urlKey && candidate.kept,
          ),
          keepSourceIds: keepSources(state.records, identity.urlKey).map(
            (source) => source.id,
          ),
          lastSeenAt: Date.now(),
          ordinal: identity.ordinal,
          revision: 0,
          tabId,
          urlKey: identity.urlKey,
        };
        state.records.push(record);
      }
      if (record.deadline === undefined) {
        const lastAccessed = (
          tab as chrome.tabs.Tab & {
            lastAccessed?: unknown;
          }
        ).lastAccessed;
        const inactiveSince =
          typeof lastAccessed === "number" &&
          Number.isFinite(lastAccessed) &&
          lastAccessed <= Date.now()
            ? lastAccessed
            : Date.now();
        record.deadline =
          (record.inactiveSince ?? inactiveSince) + delayInMilliseconds;
        record.revision += 1;
      }
      record.lastSeenAt = Date.now();
      this.observedRecords.add(record.id);
      state.records = trimRecords(state.records);
      return { result: record, state };
    });
  }

  public async getBoundRecord(tabId: TabId): Promise<IdleTabRecord | null> {
    const state = await this.read();
    return state.records.find((record) => record.tabId === tabId) ?? null;
  }

  public async getDiagnosticRecords(): Promise<
    ReadonlyArray<IdleTabDiagnosticRecord>
  > {
    const state = await this.read();
    return state.records.map(
      ({ deadline, id, kept, uncertainKeep, revision, tabId }) => ({
        ...(deadline !== undefined ? { deadline } : {}),
        id,
        kept,
        ...(uncertainKeep ? { uncertainKeep } : {}),
        revision,
        ...(tabId !== undefined ? { tabId } : {}),
      }),
    );
  }

  public async setKept(tabId: TabId, kept: boolean): Promise<void> {
    await this.updateState(async (state) => {
      const record = state.records.find(
        (candidate) => candidate.tabId === tabId,
      );
      if (record) {
        record.kept = kept;
        record.uncertainKeep = false;
        record.keepSourceIds = undefined;
        record.lastSeenAt = Date.now();
      }
      return state;
    });
  }

  // Explicit user recovery only: query absence alone must never expire a Keep,
  // because Safari may omit tabs in another group. Preserve visible Keeps.
  public async forgetSavedKeeps(
    tabId: TabId,
    visibleTabIds: ReadonlySet<TabId>,
    url: string,
  ): Promise<number> {
    return this.updateResult(async (state) => {
      const current = state.records.find((record) => record.tabId === tabId);
      if (
        !current?.uncertainKeep ||
        current.urlKey !== (await hash(`${state.salt}:${normalizeUrl(url)}`))
      )
        return { result: 0, state };
      const before = state.records.length;
      state.records = state.records.filter(
        (record) =>
          !record.kept ||
          record.urlKey !== current.urlKey ||
          (record.tabId !== undefined && visibleTabIds.has(record.tabId)),
      );
      return { result: before - state.records.length, state };
    });
  }

  public async isKept(tabId: TabId, url?: string | null): Promise<boolean> {
    const state = await this.read();
    const record = state.records.find((candidate) => candidate.tabId === tabId);
    if (!record?.kept) return false;
    return (
      typeof url !== "string" ||
      record.urlKey === (await hash(`${state.salt}:${normalizeUrl(url)}`))
    );
  }

  public async isProtected(
    tabId: TabId,
    url?: string | null,
  ): Promise<boolean> {
    const record = await this.getBoundRecord(tabId);
    if (!record?.uncertainKeep) return this.isKept(tabId, url);
    const state = await this.read();
    return (
      typeof url !== "string" ||
      record.urlKey === (await hash(`${state.salt}:${normalizeUrl(url)}`))
    );
  }

  public async markInactive(tabId: TabId, at = Date.now()): Promise<void> {
    await this.updateState((state) => {
      const record = state.records.find(
        (candidate) => candidate.tabId === tabId,
      );
      if (record) {
        record.inactiveSince = at;
        record.deadline = undefined;
        record.revision += 1;
      }
      return state;
    });
  }

  public async markActive(tabId: TabId): Promise<void> {
    await this.updateState(async (state) => {
      const record = state.records.find(
        (candidate) => candidate.tabId === tabId,
      );
      if (record) record.inactiveSince = undefined;
      if (record?.deadline !== undefined) {
        record.deadline = undefined;
        record.revision += 1;
        record.lastSeenAt = Date.now();
      }
      return state;
    });
  }

  public async detachTab(tabId: TabId): Promise<IdleTabRecord | null> {
    return await this.updateResult(async (state) => {
      const record = state.records.find(
        (candidate) => candidate.tabId === tabId,
      );
      if (record) {
        record.tabId = undefined;
      }
      return { result: record ?? null, state };
    });
  }

  public async removeTab(tabId: TabId): Promise<void> {
    await this.updateState(async (state) => ({
      ...state,
      records: state.records.filter((record) => record.tabId !== tabId),
    }));
  }

  public async resetDeadlines(delayInMilliseconds: number): Promise<void> {
    await this.updateState(async (state) => {
      for (const record of state.records) {
        if (record.deadline !== undefined) {
          record.deadline = Date.now() + delayInMilliseconds;
          record.revision += 1;
        }
      }
      return state;
    });
  }

  public async isCurrentBinding(
    recordId: string,
    revision: number,
    tab: chrome.tabs.Tab,
  ): Promise<boolean> {
    const tabId = tab.id;
    if (typeof tabId !== "number" || typeof tab.url !== "string") {
      return false;
    }
    const state = await this.read();
    const record = state.records.find((candidate) => candidate.id === recordId);
    return (
      record?.tabId === tabId &&
      record.revision === revision &&
      record.deadline !== undefined &&
      record.urlKey === (await hash(`${state.salt}:${normalizeUrl(tab.url)}`))
    );
  }

  public async resolveAlarm(
    recordId: string,
    revision: number,
    scheduledTime: number,
  ): Promise<IdleTabRecord | null> {
    const state = await this.read();
    const record = state.records.find((candidate) => candidate.id === recordId);
    if (
      !record ||
      typeof record.tabId !== "number" ||
      record.revision !== revision ||
      record.deadline === undefined ||
      record.deadline - scheduledTime > 1
    ) {
      return null;
    }
    return record;
  }

  private async identifyTabs(
    tabs: ReadonlyArray<chrome.tabs.Tab>,
    salt: string,
  ): Promise<ReadonlyArray<TabIdentity>> {
    const validTabs = [...tabs].filter(
      (tab) => typeof tab.id === "number" && typeof tab.url === "string",
    );
    const tabsByWindow = new Map<number, chrome.tabs.Tab[]>();
    for (const tab of validTabs) {
      const windowId = typeof tab.windowId === "number" ? tab.windowId : -1;
      tabsByWindow.set(windowId, [...(tabsByWindow.get(windowId) ?? []), tab]);
    }
    const identities: TabIdentity[] = [];
    for (const windowTabs of tabsByWindow.values()) {
      const orderedTabs = windowTabs.sort(
        (left, right) => (left.index ?? 0) - (right.index ?? 0),
      );
      const urlKeys = await Promise.all(
        orderedTabs.map((tab) =>
          hash(`${salt}:${normalizeUrl(tab.url as string)}`),
        ),
      );
      const contextKey = await hash(`${salt}:window:${urlKeys.join("|")}`);
      const ordinals = new Map<string, number>();
      orderedTabs.forEach((tab, index) => {
        const urlKey = urlKeys[index];
        const ordinal = ordinals.get(urlKey) ?? 0;
        ordinals.set(urlKey, ordinal + 1);
        identities.push({ contextKey, ordinal, tab, urlKey });
      });
    }
    return identities;
  }

  private async identifyTab(
    tab: chrome.tabs.Tab,
    salt: string,
    ordinal: number,
  ): Promise<TabIdentity> {
    if (typeof tab.url !== "string") {
      throw new Error("Idle tab records require a URL");
    }
    const urlKey = await hash(`${salt}:${normalizeUrl(tab.url)}`);
    return {
      contextKey: await hash(`${salt}:window:${urlKey}`),
      ordinal,
      tab,
      urlKey,
    };
  }

  private async read(): Promise<IdleTabLedgerState> {
    const stored = (await this.storage.get(storageKey)) as unknown as Record<
      string,
      unknown
    >;
    const value = stored[storageKey];
    if (value === undefined) return emptyState();
    if (
      !value ||
      typeof value !== "object" ||
      !Array.isArray((value as Partial<IdleTabLedgerState>).records) ||
      typeof (value as Partial<IdleTabLedgerState>).salt !== "string"
    ) {
      throw new Error(
        "Invalid idle ledger; cleanup is blocked to preserve protection",
      );
    }
    const state = value as IdleTabLedgerState;
    const ids = new Set<string>();
    if (
      state.version !== 1 ||
      state.records.some((record) => {
        if (
          !record ||
          typeof record.id !== "string" ||
          ids.has(record.id) ||
          typeof record.kept !== "boolean" ||
          typeof record.urlKey !== "string" ||
          typeof record.contextKey !== "string" ||
          !Number.isFinite(record.lastSeenAt) ||
          !Number.isInteger(record.ordinal) ||
          !Number.isInteger(record.revision) ||
          (record.deadline !== undefined &&
            !Number.isFinite(record.deadline)) ||
          (record.tabId !== undefined && !Number.isInteger(record.tabId)) ||
          (record.inactiveSince !== undefined &&
            !Number.isFinite(record.inactiveSince)) ||
          (record.uncertainKeep !== undefined &&
            typeof record.uncertainKeep !== "boolean") ||
          (record.keepSourceIds !== undefined &&
            (!Array.isArray(record.keepSourceIds) ||
              record.keepSourceIds.some((id) => typeof id !== "string")))
        )
          return true;
        ids.add(record.id);
        return false;
      })
    )
      throw new Error(
        "Invalid idle ledger records; cleanup is blocked to preserve protection",
      );
    return refreshSafetyHolds(structuredClone(state));
  }

  private async updateState(
    updater: (
      state: IdleTabLedgerState,
    ) => Promise<IdleTabLedgerState> | IdleTabLedgerState,
  ): Promise<IdleTabLedgerState> {
    return await this.updates.addTask(async () => {
      const current = await this.read();
      const state = refreshSafetyHolds(await updater(current));
      await this.storage.set({ [storageKey]: state });
      return state;
    });
  }

  private async updateResult<T>(
    updater: (state: IdleTabLedgerState) =>
      | Promise<{ result: T; state: IdleTabLedgerState }>
      | {
          result: T;
          state: IdleTabLedgerState;
        },
  ): Promise<T> {
    return await this.updates.addTask(async () => {
      const updated = await updater(await this.read());
      await this.storage.set({
        [storageKey]: refreshSafetyHolds(updated.state),
      });
      return updated.result;
    });
  }
}
