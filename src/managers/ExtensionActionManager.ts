import icon16 from '../icons/icon-active-16.png';
import icon32 from '../icons/icon-active-32.png';
import iconGray16 from '../icons/icon-gray-16.png';
import iconGray32 from '../icons/icon-gray-32.png';
import { IBrowserExtensionActionAPI } from '../api/IBrowserExtensionActionAPI';
import { IExtensionActionManager } from './IExtensionActionManager';
import { TabId } from '../types';

const disabledIconPaths = {
  '16': iconGray16,
  '32': iconGray32,
};

const enabledIconPaths = {
  '16': icon16,
  '32': icon32,
};

export class ExtensionActionManager implements IExtensionActionManager {
  constructor(private readonly _extensionActionAPI: IBrowserExtensionActionAPI) {}

  public async disableExtensionIcon(tabId?: TabId): Promise<void[]> {
    return Promise.all([
      this._extensionActionAPI.setTitle({ tabId, title: 'Tab Reaper (off)' }),
      this._extensionActionAPI.setIcon({ tabId, path: disabledIconPaths }),
    ]);
  }

  public async enableExtensionIcon(tabId?: number): Promise<void[]> {
    return Promise.all([
      this._extensionActionAPI.setTitle({ tabId, title: 'Tab Reaper' }),
      this._extensionActionAPI.setIcon({ tabId, path: enabledIconPaths }),
    ]);
  }
}
