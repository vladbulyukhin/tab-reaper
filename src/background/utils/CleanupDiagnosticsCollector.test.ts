import { expect, it, vi } from "vitest";
import { collectCleanupDiagnostics } from "./CleanupDiagnosticsCollector";
import {
  toCleanupDiagnosticsTab,
  toKeepDiagnosticsTab,
} from "./DiagnosticTabs";

function tab(
  overrides: Partial<chrome.tabs.Tab> & { lastAccessed?: number },
): chrome.tabs.Tab {
  return {
    groupId: -1,
    index: 0,
    windowId: 1,
    pinned: false,
    highlighted: false,
    active: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    incognito: false,
    ...overrides,
  };
}

it("reports independent failed queries and preserves the remaining snapshot", async () => {
  const recordFailure = vi.fn();
  const snapshot = await collectCleanupDiagnostics({
    background: { instanceId: "instance", sessionStorageKind: "native" },
    allTabs: async () => {
      throw new Error("Tabs unavailable");
    },
    inactiveTabs: async () => [
      tab({ id: 4, active: false, url: "https://example.com" }),
    ],
    alarms: async () => {
      throw new Error("Alarms unavailable");
    },
    events: async () => [],
    records: async () => [{ id: "saved", kept: true, revision: 1 }],
    recordFailure,
  });
  expect(snapshot.queries.allTabs).toEqual([]);
  expect(snapshot.queries.inactiveTabs[0]).toMatchObject({
    id: 4,
    active: false,
  });
  expect(snapshot.ledger.records).toHaveLength(1);
  expect(recordFailure.mock.calls.map(([event]) => event)).toEqual([
    "query-all-tabs-failed",
    "query-alarms-failed",
  ]);
});

it("keeps the minimal Keep projection and filters invalid optional fields", () => {
  expect(toKeepDiagnosticsTab(null)).toBeNull();
  expect(toKeepDiagnosticsTab(tab({ active: true }))).toBeNull();
  expect(
    toKeepDiagnosticsTab(
      tab({ id: 2, url: "https://example.com", groupId: 4 }),
    ),
  ).toMatchObject({ id: 2, url: "https://example.com" });
  expect(
    toCleanupDiagnosticsTab(
      tab({
        id: 2,
        groupId: -1,
        lastAccessed: Number.NaN,
      }),
    ),
  ).not.toHaveProperty("lastAccessed");
});
