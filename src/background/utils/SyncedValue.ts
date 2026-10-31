import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { PersistedValue } from "./PersistedValue";
import { SequentialTaskQueue } from "./SequentialTaskQueue";

// Owns the sync/local authority policy, including recovery after a failed sync
// write. Callers provide validation and decide whether unknown data is safe.
export class SyncedValue<T> {
  private readonly sync: PersistedValue<T>;
  private readonly local: PersistedValue<T>;
  private readonly authority: PersistedValue<boolean>;
  private localIsAuthoritative = false;
  private readonly mutations = new SequentialTaskQueue();

  constructor(
    storage: Pick<IBrowserApiProvider, "syncStorage" | "localStorage">,
    key: string,
    private readonly fallback: T,
    private readonly validate: (value: unknown) => T | null,
    private readonly blockUnknown = false,
  ) {
    this.sync = new PersistedValue(storage.syncStorage, key, fallback);
    this.local = new PersistedValue(storage.localStorage, key, fallback);
    this.authority = new PersistedValue(
      storage.localStorage,
      `${key}LocalFallbackAuthority`,
      false,
    );
  }

  public get(): Promise<T> {
    return this.load(false);
  }

  // Updates read storage, not the cache: another context may have written
  // since, with its change event still in flight.
  private async load(fresh: boolean): Promise<T> {
    const read = <V>(value: PersistedValue<V>) =>
      fresh ? value.readFresh() : value.read();
    if (!this.localIsAuthoritative) {
      const authority = await read(this.authority);
      this.localIsAuthoritative = authority.isValid && authority.value === true;
    }
    if (this.localIsAuthoritative)
      return this.readLocal(false, true, false, fresh);

    let missingSync = false;
    try {
      const sync = await read(this.sync);
      const value = sync.isValid ? this.validate(sync.value) : null;
      if (sync.hasStoredValue && value !== null) return value;
      missingSync = !sync.hasStoredValue;
    } catch {
      // A valid local copy can still be used, but an unreadable sync store is
      // not evidence that this is a first install with no rules.
    }
    return this.readLocal(missingSync, false, missingSync, fresh);
  }

  public update(updater: (current: T) => T): Promise<void> {
    return this.mutations.addTask(async () => {
      const next = updater(await this.load(true));
      if (this.localIsAuthoritative) {
        await this.local.update(() => next);
        try {
          await this.sync.update(() => next);
        } catch {
          return;
        }
        await this.setAuthority(false).catch(() => undefined);
        return;
      }
      const [sync, local] = await Promise.allSettled([
        this.sync.update(() => next),
        this.local.update(() => next),
      ]);
      if (sync.status === "rejected") {
        if (local.status === "rejected") throw sync.reason;
        await this.setAuthority(true);
      }
    });
  }

  private async readLocal(
    migrate: boolean,
    reconcileAuthority: boolean,
    allowMissing: boolean,
    fresh: boolean,
  ): Promise<T> {
    const local = await (fresh ? this.local.readFresh() : this.local.read());
    const value = local.isValid ? this.validate(local.value) : null;
    if (!local.hasStoredValue || value === null) {
      if (this.blockUnknown && (local.hasStoredValue || !allowMissing)) {
        throw new Error("Protection rules unavailable; cleanup is blocked");
      }
      return this.fallback;
    }
    if (migrate || reconcileAuthority) {
      try {
        await this.sync.update(() => value);
        if (reconcileAuthority) await this.setAuthority(false);
      } catch {
        // The verified local copy remains authoritative if recovery fails.
      }
    }
    return value;
  }

  private async setAuthority(value: boolean): Promise<void> {
    await this.authority.update(() => value);
    this.localIsAuthoritative = value;
  }
}
