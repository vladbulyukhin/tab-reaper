import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  new URL("../../", import.meta.url).pathname,
);

const legacyReferences = [
  "scripts/patch-safari-manifest.mjs",
  "scripts/copy-safari-dist.mjs",
  "scripts/build-safari-background.mjs",
  "service-worker-loader.js",
  "Safari/TabReaper",
];

const temporaryDirectories: string[] = [];

async function activeSafariBuildGraph(
  packageJsonPath = path.join(repositoryRoot, "package.json"),
) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const packageScripts = packageJson.scripts;
  const safariScripts = Object.fromEntries(
    Object.entries(packageScripts).filter(([name]) => name.includes("safari")),
  );
  const viteConfigs = [
    "vite.config.ts",
    "vite.safari.background.config.ts",
    "vite.safari.popup.config.ts",
  ];
  const safariScriptsDirectory = path.join(repositoryRoot, "scripts/safari");
  const safariBuildSources = (await readdir(safariScriptsDirectory))
    .filter((name) => name.endsWith(".mjs"))
    .sort();
  const sourcePaths = [
    ...viteConfigs.map((name) => path.join(repositoryRoot, name)),
    ...safariBuildSources.map((name) =>
      path.join(safariScriptsDirectory, name),
    ),
  ];

  return {
    packageScripts,
    safariScripts,
    sourceText: await Promise.all(
      sourcePaths.map((sourcePath) => readFile(sourcePath, "utf8")),
    ),
  };
}

function expectIsolatedSafariBuildGraph({
  packageScripts,
  safariScripts,
  sourceText,
}: Awaited<ReturnType<typeof activeSafariBuildGraph>>) {
  expect(safariScripts).toEqual({
    "build:safari:macos": "node scripts/safari/build-macos-payload.mjs",
    "test:safari:build":
      "vitest --config vitest.config.ts --run scripts/safari",
    "verify:safari:macos": "node scripts/safari/verify-macos-payload.mjs",
  });

  const activeSourceText = [
    ...Object.values(packageScripts),
    ...sourceText,
  ].join("\n");
  for (const legacyReference of legacyReferences) {
    expect(activeSourceText).not.toContain(legacyReference);
  }
}

async function packageWithGenericLegacyScript() {
  const directory = await mkdtemp(path.join(tmpdir(), "tab-reaper-safari-"));
  temporaryDirectories.push(directory);
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  packageJson.scripts.prebuild = "node scripts/patch-safari-manifest.mjs";
  const packageJsonPath = path.join(directory, "package.json");
  await writeFile(packageJsonPath, JSON.stringify(packageJson));
  return packageJsonPath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

it("keeps the active Safari build graph on the isolated macOS artifact pipeline", async () => {
  expectIsolatedSafariBuildGraph(await activeSafariBuildGraph());
});

it("rejects a legacy Safari invocation hidden in a generic lifecycle command", async () => {
  const packageJsonPath = await packageWithGenericLegacyScript();

  await expect(
    (async () =>
      expectIsolatedSafariBuildGraph(
        await activeSafariBuildGraph(packageJsonPath),
      ))(),
  ).rejects.toThrow("scripts/patch-safari-manifest.mjs");
});
