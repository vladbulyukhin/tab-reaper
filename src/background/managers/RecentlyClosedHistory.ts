import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import { RecentlyClosedTabsBufferSize } from "../../common/constants";
import type { RemovedTab, TabCloseReason } from "../../common/models/Tab";
import { CircularQueue } from "../utils/CircularQueue";
import { PersistedValue } from "../utils/PersistedValue";
import { SequentialTaskQueue } from "../utils/SequentialTaskQueue";

const deserialize = (data: unknown): CircularQueue<RemovedTab> => {
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!parsed || !Array.isArray(parsed.elements))
    throw new Error("Invalid history");
  const queue = new CircularQueue<RemovedTab>(RecentlyClosedTabsBufferSize);
  for (const value of parsed.elements) {
    if (
      !value ||
      typeof value.id !== "number" ||
      typeof value.removedAt !== "string" ||
      Number.isNaN(Date.parse(value.removedAt))
    )
      continue;
    queue.enqueue({
      id: value.id,
      removedAt: value.removedAt,
      entryId: typeof value.entryId === "string" ? value.entryId : undefined,
      url: typeof value.url === "string" ? value.url : undefined,
      title: typeof value.title === "string" ? value.title : undefined,
      favIconUrl:
        typeof value.favIconUrl === "string" ? value.favIconUrl : undefined,
      reason: ["idle", "duplicate", "manual", "unknown"].includes(value.reason)
        ? (value.reason as TabCloseReason)
        : "unknown",
    });
  }
  return queue;
};
const entryKey = (entry: RemovedTab) =>
  entry.entryId ?? `${entry.id}:${entry.removedAt}:${entry.url ?? ""}`;
const queueOf = (entries: RemovedTab[]) => {
  const queue = new CircularQueue<RemovedTab>(RecentlyClosedTabsBufferSize);
  for (const entry of entries) queue.enqueue(entry);
  return queue;
};
// Another context can write history at any time, so writes merge into what
// storage holds instead of replacing it with this context's copy.
const merge = (...sources: RemovedTab[][]) =>
  queueOf(
    [
      ...new Map(
        sources.flat().map((entry) => [entryKey(entry), entry]),
      ).values(),
    ].sort((a, b) => Date.parse(a.removedAt) - Date.parse(b.removedAt)),
  );
type Activity = { total: number; seen: number };
const readActivity = (data: unknown): Activity => {
  const value = typeof data === "string" ? JSON.parse(data) : data;
  if (
    !value ||
    !Number.isSafeInteger(value.total) ||
    !Number.isSafeInteger(value.seen) ||
    value.seen < 0 ||
    value.total < value.seen
  )
    throw new Error("Invalid history activity");
  return value;
};

// One serialized interface owns hydration, append, clear and read acknowledgements.
// Viewing a snapshot only acknowledges closures included in that snapshot.
export class RecentlyClosedHistory {
  private readonly tasks = new SequentialTaskQueue();
  private readonly session: PersistedValue<CircularQueue<RemovedTab>>;
  private readonly local: PersistedValue<CircularQueue<RemovedTab>>;
  private readonly activity: PersistedValue<Activity>;
  constructor(
    session: IBrowserStorageAPI,
    local: IBrowserStorageAPI,
    private readonly remember: () => Promise<boolean>,
  ) {
    this.session = new PersistedValue(
      session,
      "recentlyRemovedTabs",
      queueOf([]),
      (queue) => queue.toJSON(),
      deserialize,
      deserialize,
    );
    this.local = new PersistedValue(
      local,
      "recentlyRemovedTabsLocal",
      queueOf([]),
      (queue) => queue.toJSON(),
      deserialize,
      deserialize,
    );
    this.activity = new PersistedValue(
      local,
      "recentlyClosedActivity",
      { total: 0, seen: 0 },
      JSON.stringify,
      readActivity,
      readActivity,
    );
  }

  private async hydrate(): Promise<CircularQueue<RemovedTab>> {
    const session = (await this.session.readFresh()).value;
    if (!(await this.remember())) {
      await this.local.remove();
      return session;
    }
    const saved = (await this.local.readFresh()).value;
    const queue = merge(saved.toArray(), session.toArray());
    if (queue.toJSON() !== queueOf(session.toArray()).toJSON())
      await this.session.update((current) =>
        merge(current.toArray(), queue.toArray()),
      );
    if (queue.toJSON() !== queueOf(saved.toArray()).toJSON())
      await this.local.update((current) =>
        merge(current.toArray(), queue.toArray()),
      );
    return queue;
  }

  public get(): Promise<RemovedTab[]> {
    return this.tasks.addTask(async () =>
      (await this.hydrate()).toArray().reverse(),
    );
  }
  public sync(): Promise<void> {
    return this.tasks.addTask(async () => {
      await this.hydrate();
    });
  }
  public append(entry: RemovedTab): Promise<number> {
    return this.tasks.addTask(async () => {
      const activity = await this.activity.update(({ total, seen }) => ({
        total: total + 1,
        seen,
      }));
      await this.hydrate();
      const queue = await this.session.update((current) =>
        merge(current.toArray(), [entry]),
      );
      if (await this.remember())
        await this.local.update((current) =>
          merge(current.toArray(), queue.toArray()),
        );
      return activity.total - activity.seen;
    });
  }
  public snapshot(): Promise<{ tabs: RemovedTab[]; activityToken: number }> {
    return this.tasks.addTask(async () => ({
      tabs: (await this.hydrate()).toArray().reverse(),
      activityToken: (await this.activity.get()).total,
    }));
  }
  public acknowledge(token: number): Promise<number> {
    return this.tasks.addTask(async () => {
      if (!Number.isSafeInteger(token) || token < 0)
        throw new Error("Invalid activity token");
      const value = await this.activity.update(({ total, seen }) => ({
        total,
        seen: Math.max(seen, Math.min(total, token)),
      }));
      return value.total - value.seen;
    });
  }
  public unread(): Promise<number> {
    return this.tasks.addTask(async () => {
      const { total, seen } = await this.activity.get();
      return total - seen;
    });
  }
  public clear(): Promise<void> {
    return this.tasks.addTask(async () => {
      await this.session.remove();
      await this.local.remove();
      await this.activity.update(({ total }) => ({ total, seen: total }));
    });
  }
}
