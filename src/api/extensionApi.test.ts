import { describe, expect, it } from "vitest";
import { type ExtensionApi, resolveExtensionApi } from "./extensionApi";

const asApi = (api: object): ExtensionApi => api as ExtensionApi;

describe("resolveExtensionApi", () => {
  it("prefers the browser namespace when both namespaces exist", () => {
    const browser = asApi({ marker: "browser" });
    const chrome = asApi({ marker: "chrome" });

    expect(resolveExtensionApi({ browser, chrome })).toEqual({
      api: browser,
      type: "browser",
    });
  });

  it("selects the chrome namespace when browser is unavailable", () => {
    const chrome = asApi({ marker: "chrome" });

    expect(resolveExtensionApi({ chrome })).toEqual({
      api: chrome,
      type: "chrome",
    });
  });

  it("returns an import-safe chrome fallback when no namespace exists", () => {
    expect(resolveExtensionApi({})).toEqual({ api: {}, type: "chrome" });
  });
});
