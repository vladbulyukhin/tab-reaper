import { describe, expect, it } from "vitest";
import { SettingsAutosave } from "./SettingsAutosave";

describe("acknowledged settings saves", () => {
  it("serializes edits and reports failure without confirming unsaved values", async () => {
    const writes: number[] = [];
    const confirmed: number[] = [];
    const statuses: string[] = [];
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saves = new SettingsAutosave<number>(
      async (value) => {
        writes.push(value);
        if (value === 1) await pending;
        return { status: value === 2 ? "error" : "ok" };
      },
      (value) => confirmed.push(value),
      (status) => statuses.push(status),
    );
    const first = saves.save(1);
    const second = saves.save(2);
    await Promise.resolve();
    expect(writes).toEqual([1]);
    release();
    await first;
    await second;
    expect(confirmed).toEqual([1]);
    expect(statuses[statuses.length - 1]).toBe("error");
    await saves.save(3);
    expect(confirmed).toEqual([1, 3]);
    expect(statuses[statuses.length - 1]).toBe("saved");
  });
});
