import { IBrowserStorageAPI } from '../api/IBrowserStorageAPI';
import { BrowserStorageChange } from '../types';

export class CachedValue<T> {
  private _data: T | null = null;

  constructor(
    private readonly _browserStorageApi: IBrowserStorageAPI,
    private readonly _storageKey: string,
    private readonly _defaultValue: T
  ) {
    this._browserStorageApi.onChanged.addListener(this.handleStorageChanged.bind(this));
  }

  public async get(): Promise<T> {
    if (!this._data) {
      const storage = await this._browserStorageApi.get({ [this._storageKey]: this._defaultValue });
      this._data = storage[this._storageKey];
    }

    return this._data;
  }

  public async put(newData: T): Promise<void> {
    this._data = newData;
    await this._browserStorageApi.set({ [this._storageKey]: newData });
  }

  private handleStorageChanged(changes: { [key: string]: BrowserStorageChange }): void {
    if (this._storageKey in changes) {
      if (changes[this._storageKey].newValue) {
        this._data = changes[this._storageKey].newValue;
      }
    }
  }
}
