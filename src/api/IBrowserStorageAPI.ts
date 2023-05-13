import { BrowserStorageChangedEvent } from '../types';

export interface IBrowserStorageAPI {
  onChanged: BrowserStorageChangedEvent;
  clear(): Promise<void>;
  get(keys?: string | string[] | object): Promise<object>;
  remove(keys: string | string[]): Promise<void>;
  set(items: object): Promise<void>;
}
