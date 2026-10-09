import { describe, expect, it } from "vitest";
import { isSafeReopenUrl } from "./TabListItem";

describe("isSafeReopenUrl", () => {
  it.each(["https://example.com", "http://example.com/path"])(
    "accepts web URLs: %s",
    (url) => expect(isSafeReopenUrl(url)).toBe(true),
  );

  it.each([undefined, "javascript:alert(1)", "chrome://settings", "not a url"])(
    "rejects non-web URLs: %s",
    (url) => expect(isSafeReopenUrl(url)).toBe(false),
  );
});
