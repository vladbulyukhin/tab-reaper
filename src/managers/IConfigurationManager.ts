import { IConfiguration } from '../models/Configuration';

export interface IConfigurationManager {
  get(): Promise<IConfiguration>;
  save(configuration: IConfiguration): Promise<void>;
}
