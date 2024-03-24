import type { BrowserClickedEvent } from "../types";

export interface IBrowserExtensionActionAPI {
  setIcon(details: chrome.action.TabIconDetails): Promise<void>;
  setTitle(details: chrome.action.TitleDetails): Promise<void>;
  onClicked: BrowserClickedEvent;
}
