import type { SharedKeys } from "../../background/utils/SharedKeys";
import type { CleanupDiagnostics } from "./CleanupDiagnostics";
import type { IConfiguration } from "./Configuration";
import type { RemovedTab } from "./Tab";

export type MessagePayloads = {
  getConfig: undefined;
  setConfig: Partial<Omit<IConfiguration, "version">>;
  getCurrentTabKeepState: undefined;
  setCurrentTabExcluded: { excluded: boolean };
  forgetCurrentTabSavedKeeps: undefined;
  dismissKeepsResetNotice: undefined;
  getProtectedSites: undefined;
  addProtectedSite: { hostname: string };
  removeProtectedSite: { hostname: string };
  isCurrentSiteProtected: undefined;
  setCurrentSiteProtected: { protected: boolean };
  getSnoozeStatus: undefined;
  setSnooze: { minutes: number };
  clearSnooze: undefined;
  getRecentlyClosedTabs: undefined;
  // Snapshot closure counter: acknowledging it must not clear newer activity.
  acknowledgeRecentlyClosedTabs: { activityToken: number };
  clearRecentlyClosedTabs: undefined;
  getCleanupDiagnostics: undefined;
  clearCleanupDiagnostics: undefined;
};

export type MessageResponses = {
  getConfig: IConfiguration;
  setConfig: { status: string };
  getCurrentTabKeepState: {
    status: "ok" | "error";
    kept: boolean;
    uncertain: boolean;
    keepsReset: boolean;
  };
  setCurrentTabExcluded: { status: string };
  forgetCurrentTabSavedKeeps: { status: "ok" | "error"; cleared: number };
  dismissKeepsResetNotice: { status: "ok" | "error" };
  getProtectedSites: { sites: ReadonlyArray<string> };
  addProtectedSite: { status: string };
  removeProtectedSite: { status: string };
  isCurrentSiteProtected: {
    protected: boolean;
    hostname: string | null;
    supported: boolean;
  };
  setCurrentSiteProtected: {
    status: string;
    protected: boolean;
    hostname: string | null;
    supported: boolean;
  };
  getSnoozeStatus: {
    status?: "ok" | "error";
    snoozed: boolean;
    until: string | null;
    remainingMinutes: number | null;
  };
  setSnooze: {
    status: string;
    snoozed: boolean;
    until: string | null;
  };
  clearSnooze: {
    status: string;
    snoozed: boolean;
    until: string | null;
  };
  getRecentlyClosedTabs: { tabs: RemovedTab[]; activityToken?: number };
  acknowledgeRecentlyClosedTabs: { status: "ok" | "error" };
  clearRecentlyClosedTabs: { status: "ok" | "error" };
  getCleanupDiagnostics: CleanupDiagnostics;
  clearCleanupDiagnostics: { status: "ok" | "error" };
};

export type MessageTypes = SharedKeys<MessagePayloads, MessageResponses>;

// Incoming browser traffic can also contain unknown or debug message types.
export type RuntimeMessage = { type?: string; payload?: unknown };

export type Message = {
  type: MessageTypes;
  payload: MessagePayloads[MessageTypes];
};
