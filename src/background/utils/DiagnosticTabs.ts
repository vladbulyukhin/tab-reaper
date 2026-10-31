import type { CleanupDiagnosticsTab } from "../../common/models/CleanupDiagnostics";

function basicDiagnosticTab(tab: chrome.tabs.Tab): CleanupDiagnosticsTab {
  return {
    ...(typeof tab.id === "number" ? { id: tab.id } : {}),
    ...(typeof tab.windowId === "number" ? { windowId: tab.windowId } : {}),
    ...(typeof tab.index === "number" ? { index: tab.index } : {}),
    ...(typeof tab.active === "boolean" ? { active: tab.active } : {}),
    ...(typeof tab.url === "string" ? { url: tab.url } : {}),
  };
}

export function toKeepDiagnosticsTab(
  tab: chrome.tabs.Tab | null | undefined,
): Record<string, unknown> | null {
  return typeof tab?.id === "number" ? basicDiagnosticTab(tab) : null;
}

export function toCleanupDiagnosticsTab(
  tab: chrome.tabs.Tab,
): CleanupDiagnosticsTab {
  const extended = tab as chrome.tabs.Tab & {
    lastAccessed?: unknown;
    hidden?: unknown;
  };
  const result = basicDiagnosticTab(tab);

  if (
    typeof extended.lastAccessed === "number" &&
    Number.isFinite(extended.lastAccessed)
  ) {
    result.lastAccessed = extended.lastAccessed;
  }
  if (typeof tab.groupId === "number" && tab.groupId >= 0)
    result.groupId = tab.groupId;
  if (typeof extended.hidden === "boolean") result.hidden = extended.hidden;

  return result;
}
