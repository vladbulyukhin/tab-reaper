import type { CleanupDiagnostics } from "../../common/models/CleanupDiagnostics";
import { toCleanupDiagnosticsTab } from "./DiagnosticTabs";

type DiagnosticSources = {
  background: CleanupDiagnostics["background"];
  allTabs: () => Promise<ReadonlyArray<chrome.tabs.Tab>>;
  inactiveTabs: () => Promise<ReadonlyArray<chrome.tabs.Tab>>;
  alarms: () => Promise<ReadonlyArray<chrome.alarms.Alarm>>;
  events: () => Promise<CleanupDiagnostics["events"]>;
  records: () => Promise<CleanupDiagnostics["ledger"]["records"]>;
  recordFailure: (event: string, details: Record<string, unknown>) => void;
};

// Snapshot acquisition and formatting are read-only; cleanup policy stays with
// the manager. A failing browser query is reported without hiding other sources.
export async function collectCleanupDiagnostics(
  sources: DiagnosticSources,
): Promise<CleanupDiagnostics> {
  async function query<T>(
    read: () => Promise<ReadonlyArray<T>>,
    event: string,
  ): Promise<ReadonlyArray<T>> {
    try {
      const result = await read();
      return Array.isArray(result) ? result : [];
    } catch (error) {
      sources.recordFailure(event, {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  const allTabs = await query(sources.allTabs, "query-all-tabs-failed");
  const inactiveTabs = await sources.inactiveTabs();
  const alarms = await query(sources.alarms, "query-alarms-failed");

  return {
    alarms: alarms.map((alarm) => ({
      name: alarm.name,
      ...(typeof alarm.periodInMinutes === "number"
        ? { periodInMinutes: alarm.periodInMinutes }
        : {}),
      scheduledTime: alarm.scheduledTime,
    })),
    background: sources.background,
    events: await sources.events(),
    ledger: { records: await sources.records() },
    queries: {
      allTabs: allTabs.map(toCleanupDiagnosticsTab),
      inactiveTabs: inactiveTabs.map(toCleanupDiagnosticsTab),
    },
  };
}
