import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import {
  type IConfiguration,
  emptyConfiguration,
  toConfiguration,
} from "../../common/models/Configuration";
import { PersistedValue } from "../utils/PersistedValue";

export interface IConfigurationManager {
  get(): Promise<IConfiguration>;
  save(configuration: Partial<IConfiguration>): Promise<void>;
}

export class ConfigurationManager implements IConfigurationManager {
  private readonly configuration: PersistedValue<IConfiguration>;

  constructor(
    private readonly browserApiProvider: Pick<
      IBrowserApiProvider,
      "syncStorage"
    >,
  ) {
    this.configuration = new PersistedValue<IConfiguration>(
      this.browserApiProvider.syncStorage,
      "configuration",
      emptyConfiguration,
    );
  }

  public async get(): Promise<IConfiguration> {
    return toConfiguration(await this.configuration.get());
  }

  public async save(configuration: Partial<IConfiguration>): Promise<void> {
    return await this.configuration.put(toConfiguration(configuration));
  }
}
