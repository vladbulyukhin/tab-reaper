import type { IBrowserStorageAPI } from "../api/IBrowserStorageAPI";
import { CachedValue } from "../helpers/CachedValue";
import {
  type IConfiguration,
  emptyConfiguration,
  toConfiguration,
} from "../models/Configuration";
import type { IConfigurationManager } from "./IConfigurationManager";

export class ConfigurationManager implements IConfigurationManager {
  private static readonly StorageKey: string = "configuration";
  private readonly _configuration: CachedValue<IConfiguration>;

  constructor(private readonly _browserStorageAPI: IBrowserStorageAPI) {
    this._configuration = new CachedValue<IConfiguration>(
      this._browserStorageAPI,
      ConfigurationManager.StorageKey,
      emptyConfiguration,
    );
  }

  public async get(): Promise<IConfiguration> {
    return toConfiguration(await this._configuration.get());
  }

  public async save(configuration: Partial<IConfiguration>): Promise<void> {
    return await this._configuration.put(toConfiguration(configuration));
  }
}
