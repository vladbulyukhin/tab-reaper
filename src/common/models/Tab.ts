export type RemovedTab = Pick<
  chrome.tabs.Tab,
  "id" | "url" | "favIconUrl" | "title"
> & {
  removedAt: string;
};
