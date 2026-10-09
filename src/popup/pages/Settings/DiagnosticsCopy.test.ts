import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("support diagnostics copy", () => {
  it("explains that snapshots are optional support data rather than a temporary feature", async () => {
    const source = await readFile(
      new URL("./Diagnostics.tsx", import.meta.url),
      "utf8",
    );

    const copy = source.replace(/\s+/g, " ");

    expect(copy).toContain("Support & diagnostics");
    expect(copy).toContain("border-amber-300 bg-amber-50");
    expect(copy).toContain("flex flex-col gap-3");
    expect(copy).toContain(
      "copy it only when you choose to share it with support",
    );
    expect(copy).not.toContain("Temporary investigation");
  });
});
