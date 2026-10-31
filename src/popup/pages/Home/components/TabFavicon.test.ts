import { describe, expect, it } from "vitest";
import { initials, siteName } from "./TabFavicon";

describe("TabFavicon fallback", () => {
  it.each([
    ["en.wikipedia.org", "wikipedia"],
    ["developer.mozilla.org", "mozilla"],
    ["www.bbc.co.uk", "bbc"],
    ["example.com", "example"],
    ["localhost", "localhost"],
  ])("names %s after %s", (host, expected) => {
    expect(siteName(host)).toBe(expected);
  });

  it("uses the site name, then the title, for the initial", () => {
    expect(initials("https://en.wikipedia.org/wiki/Lisbon", "Lisbon")).toBe(
      "W",
    );
    expect(initials(null, "untitled")).toBe("U");
    expect(initials("not a url", "")).toBe("?");
  });
});
