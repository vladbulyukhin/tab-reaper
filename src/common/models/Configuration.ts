export interface IConfiguration {
  readonly diagnosticsEnabled: boolean;
  readonly keepAudibleTabs: boolean;
  readonly keepGroupedTabs: boolean;
  readonly keepPinnedTabs: boolean;
  readonly rememberRecentlyClosedTabs: boolean;
  readonly removeExactDuplicates: boolean;
  // When > 0, idle-tab closing only runs in windows with more tabs than this threshold.
  readonly tabCountThreshold: number;
  readonly tabRemovalDelayMin: number;
  readonly version: number;
}

export const emptyConfiguration: IConfiguration = {
  diagnosticsEnabled: true,
  keepAudibleTabs: true,
  keepGroupedTabs: true,
  keepPinnedTabs: true,
  removeExactDuplicates: false,
  tabCountThreshold: 0,
  tabRemovalDelayMin: 30,
  rememberRecentlyClosedTabs: true,
  version: 6,
};

export const toConfiguration = (
  obj: Partial<IConfiguration>,
): IConfiguration => ({
  ...emptyConfiguration,
  diagnosticsEnabled:
    obj.diagnosticsEnabled ?? emptyConfiguration.diagnosticsEnabled,
  version:
    typeof obj.version === "number" ? obj.version : emptyConfiguration.version,
  tabRemovalDelayMin:
    obj.tabRemovalDelayMin ?? emptyConfiguration.tabRemovalDelayMin,
  tabCountThreshold:
    typeof obj.tabCountThreshold === "number"
      ? obj.tabCountThreshold
      : emptyConfiguration.tabCountThreshold,
  keepPinnedTabs: obj.keepPinnedTabs ?? emptyConfiguration.keepPinnedTabs,
  keepGroupedTabs: obj.keepGroupedTabs ?? emptyConfiguration.keepGroupedTabs,
  keepAudibleTabs: obj.keepAudibleTabs ?? emptyConfiguration.keepAudibleTabs,
  rememberRecentlyClosedTabs:
    obj.rememberRecentlyClosedTabs ??
    emptyConfiguration.rememberRecentlyClosedTabs,
  removeExactDuplicates:
    obj.removeExactDuplicates ?? emptyConfiguration.removeExactDuplicates,
});
