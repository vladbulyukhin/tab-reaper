import type { BrowserStorageChangedEvent } from "../types";

export interface IBrowserStorageAPI {
  onChanged: BrowserStorageChangedEvent;
  clear(): Promise<void>;
  get<T>(keys?: T): Promise<T>;
  remove(keys: string | string[]): Promise<void>;
  set(items: object): Promise<void>;
}
