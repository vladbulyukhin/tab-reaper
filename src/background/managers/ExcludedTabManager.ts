import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import type { TabId } from "../../types";
import { PersistedValue } from "../utils/PersistedValue";
import type { IExtensionActionManager } from "./ExtensionActionManager";

export interface IExcludedTabManager {
  exclude(tabId: TabId): Promise<void>;
  include(tabId: TabId): Promise<void>;
  isExcluded(tabId: TabId): Promise<boolean>;
}

export class ExcludedTabManager implements IExcludedTabManager {
  private readonly excludedTabs: PersistedValue<ReadonlyArray<TabId>>;

  constructor(
    private readonly browserApiProvider: Pick<
      IBrowserApiProvider,
      "sessionStorage"
    >,
    private readonly extensionIconService: IExtensionActionManager,
  ) {
    this.excludedTabs = new PersistedValue<ReadonlyArray<TabId>>(
      this.browserApiProvider.sessionStorage,
      "excludedTabs",
      [],
    );
  }

  public async isExcluded(tabId: TabId): Promise<boolean> {
    const excludedTabs = await this.excludedTabs.get();
    return excludedTabs.includes(tabId);
  }

  public async exclude(tabId: TabId): Promise<void> {
    const excludedTabs = new Set(await this.excludedTabs.get());
    excludedTabs.add(tabId);
    await this.excludedTabs.put(Array.from(excludedTabs));
    await this.extensionIconService.disableExtensionIcon(tabId);
  }

  public async include(tabId: TabId): Promise<void> {
    const excludedTabs = new Set(await this.excludedTabs.get());
    excludedTabs.delete(tabId);
    await this.excludedTabs.put(Array.from(excludedTabs));
    await this.extensionIconService.enableExtensionIcon(tabId);
  }
}
