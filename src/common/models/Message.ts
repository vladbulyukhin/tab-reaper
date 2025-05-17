import type { SharedKeys } from "../../entrypoints/background/utils/SharedKeys";
import type { IConfiguration } from "./Configuration";
import type { RemovedTab } from "./Tab";

export type MessagePayloads = {
  getConfig: undefined;
  setConfig: Omit<IConfiguration, "version">;
  isCurrentTabExcluded: undefined;
  setCurrentTabExcluded: { excluded: boolean };
  getRecentlyClosedTabs: undefined;
};

export type MessageResponses = {
  getConfig: IConfiguration;
  setConfig: { status: string };
  isCurrentTabExcluded: boolean;
  setCurrentTabExcluded: { status: string };
  getRecentlyClosedTabs: { tabs: RemovedTab[] };
};

export type MessageTypes = SharedKeys<MessagePayloads, MessageResponses>;

export type Message = {
  type: MessageTypes;
  payload: MessagePayloads[MessageTypes];
};
