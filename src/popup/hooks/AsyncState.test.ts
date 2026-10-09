import { describe, expect, it } from "vitest";
import { mutationReducer } from "./useAsyncMutation";
import { resourceReducer } from "./useAsyncResource";

describe("popup asynchronous state", () => {
  it("retains the last confirmed resource during refresh and read failure", () => {
    const loaded = { data: { kept: true }, loading: false, error: null };
    const pending = resourceReducer(loaded, { type: "loading" });
    expect(pending).toEqual({ ...loaded, loading: true });
    expect(
      resourceReducer(pending, { type: "failed", error: "Unavailable" }),
    ).toEqual({
      ...loaded,
      error: "Unavailable",
    });
  });

  it("clears a read error only when retry starts or succeeds", () => {
    const failed = { data: null, loading: false, error: "Unavailable" };
    expect(resourceReducer(failed, { type: "loading" }).error).toBeNull();
    expect(resourceReducer(failed, { type: "loaded", data: 42 })).toEqual({
      data: 42,
      loading: false,
      error: null,
    });
  });

  it("keeps mutation feedback mutually consistent through failure and retry", () => {
    const pending = mutationReducer(
      { pending: false, error: "Old failure" },
      { type: "started" },
    );
    expect(pending).toEqual({ pending: true, error: null });
    const failed = mutationReducer(pending, {
      type: "failed",
      error: "Write failed",
    });
    expect(failed).toEqual({ pending: false, error: "Write failed" });
    expect(mutationReducer(failed, { type: "completed" })).toEqual({
      pending: false,
      error: null,
    });
  });
});
