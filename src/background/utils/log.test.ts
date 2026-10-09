import { expect, it } from "vitest";
import { debugBroadcast } from "./log";

it("does not require an injected debug constant when called directly", () => {
  expect(() => debugBroadcast("direct-call")).not.toThrow();
});
