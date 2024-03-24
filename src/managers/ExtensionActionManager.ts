import icon16 from "/icons/icon-active-16.png?url";
import icon32 from "/icons/icon-active-32.png?url";
import iconGray16 from "/icons/icon-gray-16.png?url";
import iconGray32 from "/icons/icon-gray-32.png?url";
import type { IBrowserExtensionActionAPI } from "../api/IBrowserExtensionActionAPI";
import type { TabId } from "../types";
import type { IExtensionActionManager } from "./IExtensionActionManager";

const disabledIconPaths = {
  "16": iconGray16,
  "32": iconGray32,
};

const enabledIconPaths = {
  "16": icon16,
  "32": icon32,
};

export class ExtensionActionManager implements IExtensionActionManager {
  constructor(
    private readonly _extensionActionAPI: IBrowserExtensionActionAPI,
  ) {}

  public async disableExtensionIcon(tabId?: TabId): Promise<void> {
    await Promise.all([
      this._extensionActionAPI.setTitle({ tabId, title: "Tab Reaper (off)" }),
      this._extensionActionAPI.setIcon({ tabId, path: disabledIconPaths }),
    ]);
  }

  public async enableExtensionIcon(tabId?: number): Promise<void> {
    await Promise.all([
      this._extensionActionAPI.setTitle({ tabId, title: "Tab Reaper" }),
      this._extensionActionAPI.setIcon({ tabId, path: enabledIconPaths }),
    ]);
  }
}
