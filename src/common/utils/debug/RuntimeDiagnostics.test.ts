import { expect, it } from "vitest";
import { diagnosticRuntimes } from "./RuntimeDiagnostics";

it("probes aliases only once and retains distinct browser runtimes", () => {
  const runtime = {};
  expect(
    diagnosticRuntimes({ browser: { runtime }, chrome: { runtime } }),
  ).toEqual([{ name: "browser", runtime }]);
  expect(
    diagnosticRuntimes({ browser: { runtime }, chrome: { runtime: {} } }),
  ).toHaveLength(2);
  expect(diagnosticRuntimes({})).toEqual([]);
});
