import type { TabId, WindowId } from "../../types";

export type CleanupDiagnosticEvent = {
  at: string;
  details?: Record<string, unknown>;
  event: string;
};

export type CleanupDiagnosticsTab = {
  id?: TabId;
  windowId?: WindowId;
  index?: number;
  active?: boolean;
  lastAccessed?: number;
  groupId?: number;
  hidden?: boolean;
  url?: string;
};

export type CleanupDiagnostics = {
  alarms: ReadonlyArray<{
    name: string;
    periodInMinutes?: number;
    scheduledTime: number;
  }>;
  background: {
    instanceId: string;
    sessionStorageKind: "memory-fallback" | "native";
  };
  events: ReadonlyArray<CleanupDiagnosticEvent>;
  ledger: {
    records: ReadonlyArray<{
      id: string;
      kept: boolean;
      uncertainKeep?: boolean;
      revision: number;
      deadline?: number;
      tabId?: TabId;
    }>;
  };
  queries: {
    allTabs: ReadonlyArray<CleanupDiagnosticsTab>;
    inactiveTabs: ReadonlyArray<CleanupDiagnosticsTab>;
  };
};
