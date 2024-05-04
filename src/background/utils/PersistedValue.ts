import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import { SequentialTaskQueue } from "./SequentialTaskQueue";
import { logInfo } from "./log";

export class PersistedValue<T> {
  private data: T | null = null;
  private updateQueue: SequentialTaskQueue;

  constructor(
    private readonly browserStorageApi: IBrowserStorageAPI,
    private readonly storageKey: string,
    private readonly defaultValue: T,
    private serialize: (data: T) => string = JSON.stringify,
    private deserialize: (data: string) => T = JSON.parse,
  ) {
    this.updateQueue = new SequentialTaskQueue();
    this.browserStorageApi.onChanged.addListener(
      this.handleStorageChanged.bind(this),
    );
  }

  public async get(): Promise<T> {
    if (!this.data) {
      const storage = await this.browserStorageApi.get({
        [this.storageKey]: this.serialize(this.defaultValue),
      });

      try {
        const rawData = storage[this.storageKey];
        this.data =
          typeof rawData === "string" ? this.deserialize(rawData) : rawData;
      } catch (error) {
        logInfo(`Failed to deserialize persisted value: ${error}`);
        this.data = this.defaultValue;
      }
    }

    return this.data;
  }

  public async update(updater: (currentValue: T) => T): Promise<T> {
    // make sure the updates are processed in order to avoid race conditions
    return await this.updateQueue.addTask(async () => {
      const currentValue = await this.get();
      const updatedValue = updater(currentValue);

      this.data = updatedValue;
      await this.browserStorageApi.set({
        [this.storageKey]: this.serialize(updatedValue),
      });

      return updatedValue;
    });
  }

  private handleStorageChanged(changes: {
    [key: string]: chrome.storage.StorageChange;
  }): void {
    if (this.storageKey in changes) {
      if (changes[this.storageKey].newValue) {
        try {
          const rawData = changes[this.storageKey].newValue;
          this.data =
            typeof rawData === "string" ? this.deserialize(rawData) : rawData;
        } catch (error) {
          logInfo(`Failed to deserialize persisted value: ${error}`);
        }
      }
    }
  }
}
