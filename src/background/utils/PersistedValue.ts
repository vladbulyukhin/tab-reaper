import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import { logInfo } from "../../common/utils/log";
import { SequentialTaskQueue } from "./SequentialTaskQueue";

export interface PersistedValueReadResult<T> {
  // Missing and malformed data both expose a default, but callers such as the
  // sync/local fallback manager must distinguish them from confirmed storage.
  readonly hasStoredValue: boolean;
  readonly isValid: boolean;
  readonly value: T;
}

export class PersistedValue<T> {
  private cachedResult: PersistedValueReadResult<T> | null = null;
  // Storage events and writes advance this generation so an old read cannot
  // replace them.
  private cacheGeneration = 0;
  private updateQueue = new SequentialTaskQueue();

  constructor(
    private readonly browserStorageApi: IBrowserStorageAPI,
    private readonly storageKey: string,
    private readonly defaultValue: T,
    private serialize: (data: T) => string = JSON.stringify,
    private deserialize: (data: string) => T = JSON.parse,
    private deserializeRaw?: (data: unknown) => T,
  ) {
    this.browserStorageApi.onChanged.addListener(
      this.handleStorageChanged.bind(this),
    );
  }

  public async get(): Promise<T> {
    return (await this.read()).value;
  }

  public async read(): Promise<PersistedValueReadResult<T>> {
    while (!this.cachedResult) {
      const cacheGeneration = this.cacheGeneration;
      const storage = (await this.browserStorageApi.get(
        this.storageKey,
      )) as unknown as Record<string, unknown>;
      if (cacheGeneration !== this.cacheGeneration) continue;

      this.cachedResult = this.parseStoredValue(storage[this.storageKey]);
    }

    return this.cachedResult;
  }

  // Bypasses the cache: another context may have written since it was filled,
  // and its change event can arrive late. Read-modify-write callers use this.
  public async readFresh(): Promise<PersistedValueReadResult<T>> {
    this.invalidate();
    return await this.read();
  }

  public async update(updater: (currentValue: T) => T): Promise<T> {
    // Serialize writes so each updater starts from the most recently saved value.
    return await this.updateQueue.addTask(async () => {
      const currentValue = (await this.readFresh()).value;
      const updatedValue = updater(currentValue);
      // Reads that started before this write must not restore older data.
      const cacheGeneration = ++this.cacheGeneration;
      await this.browserStorageApi.set({
        [this.storageKey]: this.serialize(updatedValue),
      });
      if (cacheGeneration === this.cacheGeneration) {
        this.cachedResult = {
          hasStoredValue: true,
          isValid: true,
          value: updatedValue,
        };
      } else {
        this.invalidate();
      }

      return updatedValue;
    });
  }

  public async remove(): Promise<void> {
    await this.updateQueue.addTask(async () => {
      await this.browserStorageApi.remove(this.storageKey);
      this.invalidate();
    });
  }

  private parseStoredValue(rawData: unknown): PersistedValueReadResult<T> {
    if (rawData === undefined) {
      return {
        hasStoredValue: false,
        isValid: false,
        value: this.defaultValue,
      };
    }

    try {
      return {
        hasStoredValue: true,
        isValid: true,
        value:
          typeof rawData === "string"
            ? this.deserialize(rawData)
            : this.deserializeRaw
              ? this.deserializeRaw(rawData)
              : (rawData as T),
      };
    } catch (error) {
      logInfo(`Failed to deserialize persisted value: ${error}`);
      return { hasStoredValue: true, isValid: false, value: this.defaultValue };
    }
  }

  private invalidate(): void {
    this.cacheGeneration++;
    this.cachedResult = null;
  }

  // Only invalidate: an event can describe a write older than what storage
  // now holds, so its value must never replace the cache.
  private handleStorageChanged(changes: {
    [key: string]: chrome.storage.StorageChange;
  }): void {
    if (this.storageKey in changes) this.invalidate();
  }
}
