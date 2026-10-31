// Zips `dist/` for the Chrome Web Store and checks that the zip loads.
// Run `pnpm build` first. Output: artifacts/tab-reaper-chrome-<version>.zip.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const distPath = path.join(root, "dist");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const { version } = await readJson(path.join(root, "package.json"));
const manifest = await readJson(path.join(distPath, "manifest.json"));
if (manifest.version !== version) {
  throw new Error(
    `dist/manifest.json is ${manifest.version}, package.json is ${version}. Run pnpm build.`,
  );
}

const zipPath = path.join(
  root,
  "artifacts",
  `tab-reaper-chrome-${version}.zip`,
);
execFileSync("mkdir", ["-p", path.dirname(zipPath)]);
await rm(zipPath, { force: true });
execFileSync("zip", ["-qrX", zipPath, ".", "-x", "*.DS_Store"], {
  cwd: distPath,
});

// Load the unzipped copy the way the store will, and wait for the worker.
const unpacked = await mkdtemp(path.join(tmpdir(), "tab-reaper-chrome-"));
try {
  execFileSync("unzip", ["-q", zipPath, "-d", unpacked]);
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${unpacked}`,
      `--load-extension=${unpacked}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
    const loaded = await worker.evaluate(
      () => chrome.runtime.getManifest().version,
    );
    if (loaded !== version) throw new Error(`Zip loaded version ${loaded}`);
  } finally {
    await context.close();
  }
} finally {
  await rm(unpacked, { recursive: true, force: true });
}

console.log(
  `Wrote ${path.relative(root, zipPath)} (manifest ${version}, loads unpacked)`,
);
