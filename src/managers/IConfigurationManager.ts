import type { IConfiguration } from "../models/Configuration";

export interface IConfigurationManager {
  get(): Promise<IConfiguration>;
  save(configuration: Partial<IConfiguration>): Promise<void>;
}
