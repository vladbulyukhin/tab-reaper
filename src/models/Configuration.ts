export interface IConfiguration {
  readonly version: '0.0.2';
  readonly tabLimit: number;
  readonly tabRemovalDelayMin: number;
  readonly keepPinnedTabs: boolean;
  readonly keepGroupedTabs: boolean;
  readonly keepAudibleTabs: boolean;
}

export const emptyConfiguration: IConfiguration = {
  version: '0.0.2',
  tabLimit: 0,
  tabRemovalDelayMin: 30,
  keepPinnedTabs: true,
  keepGroupedTabs: true,
  keepAudibleTabs: true,
};

export const toConfiguration = (obj: Partial<IConfiguration>): IConfiguration => ({
  ...emptyConfiguration,
  version: obj.version ?? emptyConfiguration.version,
  tabLimit: obj.tabLimit ?? emptyConfiguration.tabLimit,
  tabRemovalDelayMin: obj.tabRemovalDelayMin ?? emptyConfiguration.tabRemovalDelayMin,
  keepPinnedTabs: obj.keepPinnedTabs ?? emptyConfiguration.keepPinnedTabs,
  keepGroupedTabs: obj.keepGroupedTabs ?? emptyConfiguration.keepGroupedTabs,
  keepAudibleTabs: obj.keepAudibleTabs ?? emptyConfiguration.keepAudibleTabs,
});
