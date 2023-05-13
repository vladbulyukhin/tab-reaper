import { IBrowserStorageAPI } from '../api/IBrowserStorageAPI';
import { IConfiguration, emptyConfiguration, toConfiguration } from '../models/Configuration';
import { IConfigurationManager } from './IConfigurationManager';

export class ConfigurationManager implements IConfigurationManager {
  constructor(private readonly browserStorageAPI: IBrowserStorageAPI) {}

  public async get(): Promise<IConfiguration> {
    const storage: any = await this.browserStorageAPI.get({ configuration: emptyConfiguration });
    return toConfiguration(storage.configuration);
  }

  public async save(configuration: IConfiguration): Promise<void> {
    return await this.browserStorageAPI.set({ configuration });
  }
}
