import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import { logInfo } from "./log";

export class PersistedValue<T> {
  private data: T | null = null;

  constructor(
    private readonly browserStorageApi: IBrowserStorageAPI,
    private readonly storageKey: string,
    private readonly defaultValue: T,
    private serialize: (data: T) => string = JSON.stringify,
    private deserialize: (data: string) => T = JSON.parse,
  ) {
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

  public async put(newData: T): Promise<void> {
    this.data = newData;
    await this.browserStorageApi.set({
      [this.storageKey]: this.serialize(newData),
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
