import { afterEach, expect, it, vi } from "vitest";
import { debugLog, initDebug } from "./debug";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("does not require an injected debug constant when called directly", () => {
  expect(() => initDebug()).not.toThrow();
  expect(() => debugLog("No injected debug constant")).not.toThrow();
});

it("keeps an unavailable development console from breaking message handling", () => {
  vi.stubGlobal("__DEBUG__", true);
  vi.spyOn(console, "info").mockImplementation(() => {
    throw new Error("Console unavailable");
  });
  expect(() => debugLog("Message received")).not.toThrow();
});
