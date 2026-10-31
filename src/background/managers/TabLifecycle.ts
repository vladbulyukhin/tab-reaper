import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import type { TabId } from "../../types";
import { PersistedValue } from "../utils/PersistedValue";

// Owns tokens that invalidate stale asynchronous tab work. Final removal
// safety decisions remain in OpenedTabManager.
export class TabLifecycle {
  private readonly tabActivityRevisions = new Map<TabId, number>();
  private readonly tabCreationRevisions = new Map<TabId, number>();
  private readonly pendingTabCreations = new Map<TabId, number>();
  private readonly pendingDuplicateUpdates = new Map<
    TabId,
    { activityRevision: number; url: string }
  >();
  private readonly pendingTabRemovalValidations = new Map<TabId, number>();
  private readonly tabScheduleClaims = new Map<TabId, number>();
  private readonly tabGenerations: PersistedValue<Record<TabId, number>>;
  constructor(storage: IBrowserStorageAPI) {
    this.tabGenerations = new PersistedValue(storage, "tabGenerations", {});
  }
  public pendingCreationRevision(tabId: TabId) {
    return this.pendingTabCreations.get(tabId);
  }
  public creationRevision(tabId: TabId) {
    return this.tabCreationRevisions.get(tabId);
  }
  public takePendingDuplicateUpdate(tabId: TabId) {
    if (
      this.pendingTabCreations.has(tabId) ||
      this.pendingTabRemovalValidations.has(tabId)
    )
      return undefined;
    const update = this.pendingDuplicateUpdates.get(tabId);
    this.pendingDuplicateUpdates.delete(tabId);
    return update;
  }
  public beginRemovalValidation(tabId: TabId, revision: number) {
    this.pendingTabRemovalValidations.set(tabId, revision);
  }
  public forgetCreation(tabId: TabId) {
    this.tabCreationRevisions.delete(tabId);
    this.pendingDuplicateUpdates.delete(tabId);
  }
  public queueDuplicateUpdate(
    tabId: TabId,
    url: string,
    activityRevision: number,
  ): boolean {
    if (
      !this.pendingTabCreations.has(tabId) &&
      !this.pendingTabRemovalValidations.has(tabId)
    )
      return false;
    this.pendingDuplicateUpdates.set(tabId, { url, activityRevision });
    return true;
  }
  // In-memory revisions for tabs that are gone only grow on a long-lived
  // background. Forgetting one can only make pending work for that tab stale,
  // never let it act, so tabs with in-flight creation/removal are left alone.
  public forgetTabsExcept(liveTabIds: ReadonlySet<TabId>): void {
    for (const map of [
      this.tabActivityRevisions,
      this.tabCreationRevisions,
      this.pendingDuplicateUpdates,
      this.tabScheduleClaims,
    ]) {
      for (const tabId of map.keys()) {
        if (
          !liveTabIds.has(tabId) &&
          !this.pendingTabCreations.has(tabId) &&
          !this.pendingTabRemovalValidations.has(tabId)
        ) {
          map.delete(tabId);
        }
      }
    }
  }

  public activitySnapshot() {
    return new Map(this.tabActivityRevisions);
  }
  public async generationSnapshot() {
    return { ...(await this.tabGenerations.get()) };
  }
  public async getTabGeneration(tabId: TabId): Promise<number> {
    return (await this.tabGenerations.get())[tabId] ?? 0;
  }

  public async nextTabGeneration(
    tabId: TabId,
  ): Promise<{ previousGeneration: number; generation: number }> {
    let previousGeneration = 0;
    let generation = 1;
    await this.tabGenerations.update((generations) => {
      previousGeneration = generations[tabId] ?? 0;
      generation = previousGeneration + 1;
      return { ...generations, [tabId]: generation };
    });
    return { previousGeneration, generation };
  }

  public async isCurrentTabGeneration(
    tabId: TabId,
    generation: number,
  ): Promise<boolean> {
    return (await this.getTabGeneration(tabId)) === generation;
  }

  public getTabActivityRevision(tabId: TabId): number {
    return this.tabActivityRevisions.get(tabId) ?? 0;
  }

  public advanceTabActivityRevision(tabId: TabId): number {
    const revision = this.getTabActivityRevision(tabId) + 1;
    this.tabActivityRevisions.set(tabId, revision);
    this.claimTabSchedule(tabId);
    return revision;
  }

  public beginTabCreation(tabId: TabId): number {
    this.pendingDuplicateUpdates.delete(tabId);
    const revision = this.advanceTabActivityRevision(tabId);
    this.tabCreationRevisions.set(tabId, revision);
    this.pendingTabCreations.set(tabId, revision);
    return revision;
  }

  public endTabCreation(tabId: TabId, revision: number): void {
    if (this.pendingTabCreations.get(tabId) === revision) {
      this.pendingTabCreations.delete(tabId);
    }
  }

  public endTabRemovalValidation(tabId: TabId, revision: number): void {
    if (this.pendingTabRemovalValidations.get(tabId) === revision) {
      this.pendingTabRemovalValidations.delete(tabId);
    }
  }

  public isPendingCreationOwner(tabId: TabId, revision: number): boolean {
    return (
      this.pendingTabCreations.get(tabId) === revision &&
      this.pendingTabRemovalValidations.get(tabId) !== revision &&
      this.getTabActivityRevision(tabId) === revision
    );
  }

  public isDuplicateSourceOwner(
    tabId: TabId,
    revision: number,
    pendingCreation: boolean,
  ): boolean {
    return pendingCreation
      ? this.isPendingCreationOwner(tabId, revision)
      : this.isLifecycleOwner(tabId, revision);
  }

  public isLifecycleOwner(tabId: TabId, revision: number): boolean {
    return (
      !this.pendingTabCreations.has(tabId) &&
      !this.pendingTabRemovalValidations.has(tabId) &&
      this.getTabActivityRevision(tabId) === revision
    );
  }

  public isRemovalLifecycleCurrent(
    tabId: TabId,
    expectedActivityRevision?: number,
  ): boolean {
    return (
      typeof expectedActivityRevision === "number" &&
      this.isLifecycleOwner(tabId, expectedActivityRevision)
    );
  }

  public claimTabSchedule(tabId: TabId): number {
    const claim = (this.tabScheduleClaims.get(tabId) ?? 0) + 1;
    this.tabScheduleClaims.set(tabId, claim);
    return claim;
  }

  public isScheduleOwnerSynchronous(
    tabId: TabId,
    activityRevision: number,
    scheduleClaim: number,
  ): boolean {
    const pendingCreation = this.pendingTabCreations.get(tabId);
    return (
      this.tabScheduleClaims.get(tabId) === scheduleClaim &&
      this.getTabActivityRevision(tabId) === activityRevision &&
      (pendingCreation === undefined || pendingCreation === activityRevision)
    );
  }

  public async isScheduleOwner(
    tabId: TabId,
    generation: number,
    activityRevision: number,
    scheduleClaim: number,
  ): Promise<boolean> {
    if (
      !this.isScheduleOwnerSynchronous(tabId, activityRevision, scheduleClaim)
    ) {
      return false;
    }

    const generationIsCurrent = await this.isCurrentTabGeneration(
      tabId,
      generation,
    );
    return (
      generationIsCurrent &&
      this.isScheduleOwnerSynchronous(tabId, activityRevision, scheduleClaim)
    );
  }
}
