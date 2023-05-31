import { IBrowserStorageAPI } from '../api/IBrowserStorageAPI';
import { IConfiguration, emptyConfiguration, toConfiguration } from '../models/Configuration';
import { ConfigurationChange, IConfigurationManager } from './IConfigurationManager';

export class ConfigurationManager implements IConfigurationManager {
  private _configuration: IConfiguration;

  constructor(private readonly browserStorageAPI: IBrowserStorageAPI) {
    this.browserStorageAPI.onChanged.addListener(this.handleConfigurationChanged.bind(this));
  }

  public async get(): Promise<IConfiguration> {
    if (!this._configuration) {
      const storage: any = await this.browserStorageAPI.get({ configuration: emptyConfiguration });
      this._configuration = toConfiguration(storage.configuration);
    }
    return this._configuration;
  }

  public async save(configuration: Partial<IConfiguration>): Promise<void> {
    this._configuration = { ...this._configuration, ...configuration };
    return await this.browserStorageAPI.set({ configuration });
  }

  private handleConfigurationChanged(changes: { [key: string]: ConfigurationChange }): void {
    for (const [property, change] of Object.entries(changes)) {
      if (change.newValue) {
        this._configuration[property] = change.newValue;
      }
    }
  }
}
