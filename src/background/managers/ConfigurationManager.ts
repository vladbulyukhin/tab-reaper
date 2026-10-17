import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import {
  type IConfiguration,
  emptyConfiguration,
  toConfiguration,
} from "../../common/models/Configuration";
import { SyncedValue } from "../utils/SyncedValue";

const booleanFields = [
  "diagnosticsEnabled",
  "keepAudibleTabs",
  "keepGroupedTabs",
  "keepPinnedTabs",
  "rememberRecentlyClosedTabs",
  "removeExactDuplicates",
] as const satisfies ReadonlyArray<keyof IConfiguration>;

const numberFields = [
  "tabCountThreshold",
  "tabRemovalDelayMin",
  "version",
] as const satisfies ReadonlyArray<keyof IConfiguration>;

export interface IConfigurationManager {
  get(): Promise<IConfiguration>;
  save(configuration: Partial<IConfiguration>): Promise<void>;
}

export class ConfigurationManager implements IConfigurationManager {
  private readonly configuration: SyncedValue<IConfiguration>;
  constructor(
    storage: Pick<IBrowserApiProvider, "syncStorage" | "localStorage">,
  ) {
    this.configuration = new SyncedValue(
      storage,
      "configuration",
      emptyConfiguration,
      (value) => this.parseConfiguration(value),
    );
  }
  public get(): Promise<IConfiguration> {
    return this.configuration.get();
  }
  public save(configuration: Partial<IConfiguration>): Promise<void> {
    return this.configuration.update((current) =>
      toConfiguration({ ...current, ...configuration }),
    );
  }
  // Older versions stored fields with other types (v0.0.x kept `version` as a
  // string, and a NaN delay serializes as null). Keep the valid fields and let
  // defaults fill in the rest instead of discarding the whole configuration.
  private parseConfiguration(value: unknown): IConfiguration | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const stored = value as Record<string, unknown>;
    const configuration: Partial<Record<keyof IConfiguration, unknown>> = {};
    for (const key of booleanFields) {
      if (typeof stored[key] === "boolean") configuration[key] = stored[key];
    }
    for (const key of numberFields) {
      if (typeof stored[key] === "number" && Number.isFinite(stored[key]))
        configuration[key] = stored[key];
    }

    return toConfiguration(configuration as Partial<IConfiguration>);
  }
}
