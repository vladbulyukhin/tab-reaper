export interface IConfiguration {
  readonly keepAudibleTabs: boolean;
  readonly keepGroupedTabs: boolean;
  readonly keepPinnedTabs: boolean;
  readonly removeExactDuplicates: boolean;
  readonly tabRemovalDelayMin: number;
  readonly version: number;
}

export const emptyConfiguration: IConfiguration = {
  keepAudibleTabs: true,
  keepGroupedTabs: true,
  keepPinnedTabs: true,
  removeExactDuplicates: false,
  tabRemovalDelayMin: 30,
  version: 3,
};

export const toConfiguration = (
  obj: Partial<IConfiguration>,
): IConfiguration => ({
  ...emptyConfiguration,
  version:
    typeof obj.version === "number" ? obj.version : emptyConfiguration.version,
  tabRemovalDelayMin:
    obj.tabRemovalDelayMin ?? emptyConfiguration.tabRemovalDelayMin,
  keepPinnedTabs: obj.keepPinnedTabs ?? emptyConfiguration.keepPinnedTabs,
  keepGroupedTabs: obj.keepGroupedTabs ?? emptyConfiguration.keepGroupedTabs,
  keepAudibleTabs: obj.keepAudibleTabs ?? emptyConfiguration.keepAudibleTabs,
  removeExactDuplicates:
    obj.removeExactDuplicates ?? emptyConfiguration.removeExactDuplicates,
});
