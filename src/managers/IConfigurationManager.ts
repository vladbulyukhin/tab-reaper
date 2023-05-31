import { IConfiguration } from '../models/Configuration';
import { CleanUpFunction } from '../types';

export interface ConfigurationChange {
  readonly newValue?: unknown;
  readonly oldValue?: unknown;
}

export type ConfigurationChangedHandler = (changes: { [key: string]: ConfigurationChange }) => CleanUpFunction;

export interface IConfigurationManager {
  get(): Promise<IConfiguration>;
  save(configuration: IConfiguration): Promise<void>;
}
