export interface IConfiguration {
  readonly version: '0.0.1';
  readonly tabRemovalDelayMin: number;
  readonly keepPinnedTabs: boolean;
  readonly keepGroupedTabs: boolean;
  readonly keepAudibleTabs: boolean;
}

export const emptyConfiguration: IConfiguration = {
  version: '0.0.1',
  tabRemovalDelayMin: 30,
  keepPinnedTabs: true,
  keepGroupedTabs: true,
  keepAudibleTabs: true,
};

export const toConfiguration = (obj: Partial<IConfiguration>): IConfiguration => ({
  ...emptyConfiguration,
  version: obj.version ?? emptyConfiguration.version,
  tabRemovalDelayMin: obj.tabRemovalDelayMin ?? emptyConfiguration.tabRemovalDelayMin,
  keepPinnedTabs: obj.keepPinnedTabs ?? emptyConfiguration.keepPinnedTabs,
  keepGroupedTabs: obj.keepGroupedTabs ?? emptyConfiguration.keepGroupedTabs,
  keepAudibleTabs: obj.keepAudibleTabs ?? emptyConfiguration.keepAudibleTabs,
});
