import { expect, it } from "vitest";
import { currentTabPresentation } from "./currentTabPresentation";

it("uses the same safety-hold priority for label and color", () => {
  expect(
    currentTabPresentation(
      { uncertainKeep: true, excluded: false, siteProtected: true },
      false,
      false,
    ),
  ).toEqual({
    label: "Safety hold",
    className: "bg-amber-50 text-amber-700",
  });
});

it("does not show an unknown initial protection state as eligible", () => {
  expect(currentTabPresentation(null, true, false).label).toBe("Loading…");
  expect(currentTabPresentation(null, false, true).label).toBe(
    "Status unavailable",
  );
});
