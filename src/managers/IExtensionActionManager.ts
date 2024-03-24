import type { TabId } from "../types";

export interface IExtensionActionManager {
  disableExtensionIcon(tabId?: TabId): Promise<void>;
  enableExtensionIcon(tabId?: TabId): Promise<void>;
}
