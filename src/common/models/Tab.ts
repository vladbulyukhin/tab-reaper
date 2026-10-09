export type TabCloseReason = "idle" | "duplicate" | "manual" | "unknown";

export type RemovedTab = Pick<
  chrome.tabs.Tab,
  "id" | "url" | "favIconUrl" | "title"
> & {
  entryId?: string;
  removedAt: string;
  reason: TabCloseReason;
};
