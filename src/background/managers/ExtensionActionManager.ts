import icon16 from "/icons/icon-active-16.png?url";
import icon32 from "/icons/icon-active-32.png?url";
import iconGray16 from "/icons/icon-gray-16.png?url";
import iconGray32 from "/icons/icon-gray-32.png?url";
import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import type { TabId } from "../../types";
import { PersistedValue } from "../utils/PersistedValue";
import { SequentialTaskQueue } from "../utils/SequentialTaskQueue";
import { abbreviateNumber } from "../utils/abbreviateNumber";

const disabledIconPaths = {
  "16": iconGray16,
  "32": iconGray32,
};

const enabledIconPaths = {
  "16": icon16,
  "32": icon32,
};

export interface IExtensionActionManager {
  disableExtensionIcon(tabId?: TabId): Promise<void>;
  enableExtensionIcon(tabId?: TabId): Promise<void>;
  incrementBadgeCounter(): Promise<void>;
}

export class ExtensionActionManager implements IExtensionActionManager {
  private badgeCount: PersistedValue<number>;
  private badgeUpdateQueue: SequentialTaskQueue;

  constructor(
    private readonly browserApiProvider: Pick<
      IBrowserApiProvider,
      "action" | "sessionStorage"
    >,
  ) {
    this.badgeCount = new PersistedValue(
      browserApiProvider.sessionStorage,
      "badgeCount",
      0,
    );

    this.badgeUpdateQueue = new SequentialTaskQueue();
  }

  public async disableExtensionIcon(tabId?: TabId): Promise<void> {
    await Promise.all([
      this.browserApiProvider.action.setTitle({
        tabId,
        title: "Tab Reaper (off)",
      }),
      this.browserApiProvider.action.setIcon({
        tabId,
        path: disabledIconPaths,
      }),
    ]);
  }

  public async enableExtensionIcon(tabId?: TabId): Promise<void> {
    await Promise.all([
      this.browserApiProvider.action.setTitle({
        tabId,
        title: "Tab Reaper",
      }),
      this.browserApiProvider.action.setIcon({ tabId, path: enabledIconPaths }),
    ]);
  }

  public async incrementBadgeCounter(): Promise<void> {
    const count = await this.badgeCount.update((c) => c + 1);
    await this.badgeUpdateQueue.addTask(() => this.updateBadgeCounter(count));
  }

  private async updateBadgeCounter(newCount: number): Promise<void> {
    await Promise.all([
      this.browserApiProvider.action.setBadgeBackgroundColor({
        color: [106, 106, 106, 255],
      }),
      this.browserApiProvider.action.setBadgeTextColor({
        color: [255, 255, 255, 255],
      }),
      this.browserApiProvider.action.setBadgeText({
        text: abbreviateNumber(newCount),
      }),
    ]);
  }
}
