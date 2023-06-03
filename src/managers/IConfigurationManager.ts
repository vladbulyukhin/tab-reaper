import { IConfiguration } from '../models/Configuration';

export interface ConfigurationChange {
  readonly newValue?: unknown;
  readonly oldValue?: unknown;
}

export interface IConfigurationManager {
  get(): Promise<IConfiguration>;
  save(configuration: Partial<IConfiguration>): Promise<void>;
}
