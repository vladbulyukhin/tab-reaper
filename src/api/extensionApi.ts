export type ExtensionApi = typeof chrome;

export type ExtensionApiType = "browser" | "chrome";

export interface ResolvedExtensionApi {
  api: ExtensionApi;
  type: ExtensionApiType;
}

export interface ExtensionApiGlobals {
  browser?: ExtensionApi;
  chrome?: ExtensionApi;
}

export function resolveExtensionApi(
  globals: ExtensionApiGlobals,
): ResolvedExtensionApi {
  if (globals.browser) {
    return { api: globals.browser, type: "browser" };
  }

  if (globals.chrome) {
    return { api: globals.chrome, type: "chrome" };
  }

  return { api: {} as ExtensionApi, type: "chrome" };
}

const resolved = resolveExtensionApi({
  browser: (globalThis as typeof globalThis & { browser?: ExtensionApi })
    .browser,
  chrome: (globalThis as typeof globalThis & { chrome?: ExtensionApi }).chrome,
});
export const extensionApi = resolved.api;
export const extensionApiType = resolved.type;

// Keep environment probing and its browser-specific types out of UI modules.
export function getTabGroupCapabilities(
  globals: ExtensionApiGlobals = globalThis as unknown as ExtensionApiGlobals,
) {
  return {
    extensionApi: typeof extensionApi.tabGroups !== "undefined",
    browserQuery: typeof globals.browser?.tabGroups?.query === "function",
    chromeQuery: typeof globals.chrome?.tabGroups?.query === "function",
  };
}
