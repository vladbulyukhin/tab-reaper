import { IBrowserExtensionActionAPI } from './IBrowserExtensionActionAPI';

export const chromeActionAPI: IBrowserExtensionActionAPI = {
  setIcon: chrome.action?.setIcon,
  setTitle: chrome.action?.setTitle,
  onClicked: chrome.action?.onClicked,
};
