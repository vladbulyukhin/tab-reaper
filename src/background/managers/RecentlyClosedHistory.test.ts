import { describe, expect, it, vi } from "vitest";
import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import { createSharedStorage } from "../utils/SharedStorageDouble";
import { RecentlyClosedHistory } from "./RecentlyClosedHistory";

const storage = (): IBrowserStorageAPI => {
  const values: Record<string, unknown> = {};
  return {
    get: async () => structuredClone(values),
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    },
    remove: async (key: string | string[]) => {
      for (const item of [key].flat()) delete values[item];
    },
    onChanged: { addListener: vi.fn() },
  } as unknown as IBrowserStorageAPI;
};
const entry = (id: number) => ({
  id,
  title: `Tab ${id}`,
  removedAt: new Date(id).toISOString(),
  reason: "idle" as const,
});

describe("recent history and unread activity", () => {
  it("serializes concurrent appends and clear without resurrecting old entries", async () => {
    const local = storage();
    const history = new RecentlyClosedHistory(
      storage(),
      local,
      async () => true,
    );
    await Promise.all([history.append(entry(1)), history.append(entry(2))]);
    await Promise.all([history.clear(), history.append(entry(3))]);
    expect((await history.get()).map((tab) => tab.id)).toEqual([3]);
    expect(await history.unread()).toBe(1);
    const restarted = new RecentlyClosedHistory(
      storage(),
      local,
      async () => true,
    );
    expect((await restarted.get()).map((tab) => tab.id)).toEqual([3]);
  });

  it("removes persistent history when remembering is disabled but retains session history", async () => {
    const local = storage();
    let remember = true;
    const history = new RecentlyClosedHistory(
      storage(),
      local,
      async () => remember,
    );
    await history.append(entry(1));
    remember = false;
    await history.sync();
    await history.append(entry(2));
    expect((await history.get()).map((tab) => tab.id)).toEqual([2, 1]);
    const restarted = new RecentlyClosedHistory(
      storage(),
      local,
      async () => false,
    );
    expect(await restarted.get()).toEqual([]);
    expect(await restarted.unread()).toBe(2);
  });
  it("persists unread activity independently of the 50 saved entries and acknowledges only viewed closures", async () => {
    const local = storage();
    const history = new RecentlyClosedHistory(
      storage(),
      local,
      async () => true,
    );
    for (let id = 1; id <= 55; id++) await history.append(entry(id));
    const viewed = await history.snapshot();
    expect(viewed.tabs).toHaveLength(50);
    const restarted = new RecentlyClosedHistory(
      storage(),
      local,
      async () => true,
    );
    expect(await restarted.unread()).toBe(55);
    await restarted.append(entry(56));
    expect(await restarted.acknowledge(viewed.activityToken)).toBe(1);
    expect(await restarted.get()).toHaveLength(50);
    await restarted.clear();
    expect(await restarted.unread()).toBe(0);
    await restarted.append(entry(57));
    expect(await restarted.acknowledge(viewed.activityToken)).toBe(1);
  });
  it("retains old history when cleanup runs before the first read after restart", async () => {
    const local = storage();
    const first = new RecentlyClosedHistory(storage(), local, async () => true);
    await first.append(entry(1));
    const restarted = new RecentlyClosedHistory(
      storage(),
      local,
      async () => true,
    );
    await restarted.append(entry(2));
    expect((await restarted.get()).map((tab) => tab.id)).toEqual([2, 1]);
  });

  it("keeps closures recorded by another context before its change events arrive", async () => {
    const session = createSharedStorage();
    const local = createSharedStorage();
    const first = new RecentlyClosedHistory(
      session.context(),
      local.context(),
      async () => true,
    );
    const second = new RecentlyClosedHistory(
      session.context(),
      local.context(),
      async () => true,
    );

    await expect(first.get()).resolves.toEqual([]);
    await expect(first.unread()).resolves.toBe(0);
    await second.append(entry(1));
    await first.append(entry(2));

    expect((await first.get()).map((tab) => tab.id)).toEqual([2, 1]);
    await expect(first.unread()).resolves.toBe(2);
    const restarted = new RecentlyClosedHistory(
      createSharedStorage().context(),
      local.context(),
      async () => true,
    );
    expect((await restarted.get()).map((tab) => tab.id)).toEqual([2, 1]);
  });
});
