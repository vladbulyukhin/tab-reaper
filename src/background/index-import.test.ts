import { expect, it } from "vitest";

it("does not require an injected debug constant when imported directly", async () => {
  await expect(import("./index")).resolves.toBeDefined();
});
