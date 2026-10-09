import { expect, it } from "vitest";
import { isAppleMobilePlatform } from "./viewport";

it("identifies iPhones and desktop-mode iPads without resizing macOS or Chrome", () => {
  expect(
    isAppleMobilePlatform({
      userAgent: "iPhone",
      platform: "iPhone",
      maxTouchPoints: 5,
    }),
  ).toBe(true);
  expect(
    isAppleMobilePlatform({
      userAgent: "Macintosh",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
  ).toBe(true);
  expect(
    isAppleMobilePlatform({
      userAgent: "Macintosh",
      platform: "MacIntel",
      maxTouchPoints: 0,
    }),
  ).toBe(false);
  expect(
    isAppleMobilePlatform({
      userAgent: "Chrome",
      platform: "Win32",
      maxTouchPoints: 5,
    }),
  ).toBe(false);
});
