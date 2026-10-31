import { describe, expect, it } from "vitest";
import { createSharedStorage } from "./SharedStorageDouble";
import { SyncedValue } from "./SyncedValue";

const validate = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;

describe("SyncedValue", () => {
  it("starts each update from storage, not a cache another context outdated", async () => {
    const sync = createSharedStorage();
    const local = createSharedStorage();
    const contextValue = () =>
      new SyncedValue<string[]>(
        { syncStorage: sync.context(), localStorage: local.context() },
        "sites",
        [],
        validate,
      );
    const first = contextValue();
    const second = contextValue();

    await expect(first.get()).resolves.toEqual([]);
    await second.update((sites) => [...sites, "a.example"]);
    await first.update((sites) => [...sites, "b.example"]);

    await expect(contextValue().get()).resolves.toEqual([
      "a.example",
      "b.example",
    ]);
  });
});
