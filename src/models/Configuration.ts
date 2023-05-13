export interface IConfiguration {
  readonly version: '0.0.1';
  readonly tabRemovalTimeoutMin: number;
  readonly tabLimit: number;
}

export const emptyConfiguration: IConfiguration = {
  version: '0.0.1',
  tabRemovalTimeoutMin: 30,
  tabLimit: 0,
};

export const toConfiguration = (obj: Partial<IConfiguration>): IConfiguration => ({
  ...emptyConfiguration,
  version: obj.version ?? emptyConfiguration.version,
  tabRemovalTimeoutMin: obj.tabRemovalTimeoutMin ?? emptyConfiguration.tabRemovalTimeoutMin,
  tabLimit: obj.tabLimit ?? emptyConfiguration.tabLimit,
});
