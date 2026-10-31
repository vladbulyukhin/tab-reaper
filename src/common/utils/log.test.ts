import { afterEach, expect, it, vi } from "vitest";
import { logInfo } from "./log";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("does not require an injected debug constant when called directly", () => {
  expect(() => logInfo("No injected debug constant")).not.toThrow();
});

it("keeps an unavailable development console from breaking callers", () => {
  vi.stubGlobal("__DEBUG__", true);
  vi.spyOn(console, "info").mockImplementation(() => {
    throw new Error("Console unavailable");
  });
  expect(() => logInfo("Message received")).not.toThrow();
});
