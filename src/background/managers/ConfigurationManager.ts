import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import {
  type IConfiguration,
  emptyConfiguration,
  toConfiguration,
} from "../../common/models/Configuration";
import { SyncedValue } from "../utils/SyncedValue";

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
  private parseConfiguration(value: unknown): IConfiguration | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const configuration = value as Partial<IConfiguration>;
    if (
      (configuration.diagnosticsEnabled !== undefined &&
        typeof configuration.diagnosticsEnabled !== "boolean") ||
      (configuration.keepAudibleTabs !== undefined &&
        typeof configuration.keepAudibleTabs !== "boolean") ||
      (configuration.keepGroupedTabs !== undefined &&
        typeof configuration.keepGroupedTabs !== "boolean") ||
      (configuration.keepPinnedTabs !== undefined &&
        typeof configuration.keepPinnedTabs !== "boolean") ||
      (configuration.rememberRecentlyClosedTabs !== undefined &&
        typeof configuration.rememberRecentlyClosedTabs !== "boolean") ||
      (configuration.removeExactDuplicates !== undefined &&
        typeof configuration.removeExactDuplicates !== "boolean") ||
      (configuration.tabCountThreshold !== undefined &&
        typeof configuration.tabCountThreshold !== "number") ||
      (configuration.tabRemovalDelayMin !== undefined &&
        typeof configuration.tabRemovalDelayMin !== "number") ||
      (configuration.version !== undefined &&
        typeof configuration.version !== "number")
    ) {
      return null;
    }

    return toConfiguration(configuration);
  }
}
