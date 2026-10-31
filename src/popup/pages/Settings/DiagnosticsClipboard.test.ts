import { describe, expect, it, vi } from "vitest";
import {
  copyJsonToClipboard,
  sanitizeDiagnosticsForSupport,
} from "./DiagnosticsClipboard";

describe("copyJsonToClipboard", () => {
  it("copies the same formatted JSON shown in diagnostics", async () => {
    const writeText = vi.fn(async () => undefined);
    const snapshot = { events: [{ event: "alarm" }], queries: { allTabs: [] } };

    await copyJsonToClipboard(snapshot, { writeText });

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(snapshot, null, 2));
  });

  it("reports when clipboard access is unavailable", async () => {
    await expect(copyJsonToClipboard({}, undefined)).rejects.toThrow(
      "Clipboard is unavailable",
    );
  });

  it("removes paths, queries, and fragments from nested URLs in a support report", () => {
    expect(
      sanitizeDiagnosticsForSupport({
        queries: {
          allTabs: [
            {
              favIconUrl: "https://icons.example.com/image.png?account=42",
              url: "https://example.com/private/path?token=secret#details",
            },
            { url: "safari-web-extension://extension-id/options.html" },
          ],
        },
      }),
    ).toEqual({
      queries: {
        allTabs: [
          {
            favIconUrl: "https://icons.example.com",
            url: "https://example.com",
          },
          { url: "safari-web-extension:" },
        ],
      },
    });
  });
});
