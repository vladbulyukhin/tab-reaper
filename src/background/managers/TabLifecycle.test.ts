import { describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import { TabLifecycle } from "./TabLifecycle";

const createLifecycle = () => new TabLifecycle(mockDeep<IBrowserStorageAPI>());

describe("TabLifecycle ownership", () => {
  it("does not let an old creation completion release a newer creation", () => {
    const lifecycle = createLifecycle();
    const old = lifecycle.beginTabCreation(1);
    const current = lifecycle.beginTabCreation(1);
    lifecycle.endTabCreation(1, old);
    expect(lifecycle.isPendingCreationOwner(1, current)).toBe(true);
    expect(lifecycle.isPendingCreationOwner(1, old)).toBe(false);
  });

  it("holds duplicate updates until both creation and removal validation finish", () => {
    const lifecycle = createLifecycle();
    const revision = lifecycle.beginTabCreation(1);
    lifecycle.beginRemovalValidation(1, revision);
    expect(
      lifecycle.queueDuplicateUpdate(1, "https://example.com/", revision),
    ).toBe(true);
    lifecycle.endTabCreation(1, revision);
    expect(lifecycle.takePendingDuplicateUpdate(1)).toBeUndefined();
    lifecycle.endTabRemovalValidation(1, revision);
    expect(lifecycle.takePendingDuplicateUpdate(1)).toEqual({
      url: "https://example.com/",
      activityRevision: revision,
    });
    expect(lifecycle.takePendingDuplicateUpdate(1)).toBeUndefined();
  });

  it("invalidates an older schedule as soon as activity advances", () => {
    const lifecycle = createLifecycle();
    const revision = lifecycle.advanceTabActivityRevision(1);
    const claim = lifecycle.claimTabSchedule(1);
    expect(lifecycle.isScheduleOwnerSynchronous(1, revision, claim)).toBe(true);
    lifecycle.advanceTabActivityRevision(1);
    expect(lifecycle.isScheduleOwnerSynchronous(1, revision, claim)).toBe(
      false,
    );
  });

  it("rechecks activity after an asynchronous generation read", async () => {
    const storage = mockDeep<IBrowserStorageAPI>();
    const lifecycle = new TabLifecycle(storage);
    let resolve: ((value: Record<string, unknown>) => void) | undefined;
    storage.get.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const revision = lifecycle.advanceTabActivityRevision(1);
    const claim = lifecycle.claimTabSchedule(1);
    const ownership = lifecycle.isScheduleOwner(1, 1, revision, claim);
    await vi.waitFor(() => expect(storage.get).toHaveBeenCalled());
    lifecycle.advanceTabActivityRevision(1);
    resolve?.({ tabGenerations: JSON.stringify({ 1: 1 }) });
    expect(await ownership).toBe(false);
  });

  it("forgets revisions of closed tabs without touching in-flight creations", () => {
    const lifecycle = createLifecycle();
    lifecycle.advanceTabActivityRevision(1);
    const closed = lifecycle.advanceTabActivityRevision(2);
    const creating = lifecycle.beginTabCreation(3);

    lifecycle.forgetTabsExcept(new Set([1]));

    expect(lifecycle.getTabActivityRevision(1)).toBe(1);
    expect(lifecycle.getTabActivityRevision(2)).toBe(0);
    expect(lifecycle.isLifecycleOwner(2, closed)).toBe(false);
    expect(lifecycle.isPendingCreationOwner(3, creating)).toBe(true);
  });
});
