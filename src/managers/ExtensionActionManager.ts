import iconReaper16 from '../icons/reaper_16.png';
import iconReaper32 from '../icons/reaper_32.png';
import iconReaperGray16 from '../icons/reaper_gray_16.png';
import iconReaperGray32 from '../icons/reaper_gray_32.png';
import { IBrowserExtensionActionAPI } from '../api/IBrowserExtensionActionAPI';
import { IExtensionActionManager } from './IExtensionActionManager';
import { TabId } from '../types';

const disabledIconPaths = {
  '16': iconReaperGray16,
  '32': iconReaperGray32,
};

const enabledIconPaths = {
  '16': iconReaper16,
  '32': iconReaper32,
};

export class ExtensionActionManager implements IExtensionActionManager {
  constructor(private readonly extensionActionAPI: IBrowserExtensionActionAPI) {}

  public async disableExtensionIcon(tabId?: TabId): Promise<void[]> {
    return Promise.all([
      this.extensionActionAPI.setTitle({ tabId, title: 'Tab Reaper (off)' }),
      this.extensionActionAPI.setIcon({ tabId, path: disabledIconPaths }),
    ]);
  }

  public async enableExtensionIcon(tabId?: number): Promise<void[]> {
    return Promise.all([
      this.extensionActionAPI.setTitle({ tabId, title: 'Tab Reaper' }),
      this.extensionActionAPI.setIcon({ tabId, path: enabledIconPaths }),
    ]);
  }
}
