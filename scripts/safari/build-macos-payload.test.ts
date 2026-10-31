import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const repositoryRoot = path.resolve(
  new URL("../../", import.meta.url).pathname,
);

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "tab-reaper-builder-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function pathState(filePath: string) {
  try {
    const stats = await lstat(filePath);
    return { exists: true, mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return { exists: false };
  }
}

async function directorySnapshot(
  directory: string,
  relativeDirectory = "",
): Promise<Array<{ hash: string; path: string }>> {
  const snapshot: Array<{ hash: string; path: string }> = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      snapshot.push(...(await directorySnapshot(entryPath, relativePath)));
      continue;
    }

    snapshot.push({
      hash: createHash("sha256")
        .update(await readFile(entryPath))
        .digest("hex"),
      path: relativePath,
    });
  }

  return snapshot.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

it("builds and verifies an isolated complete payload without mutating Chrome or wrapper outputs", async () => {
  const workspace = await createTemporaryDirectory();
  const artifactDirectory = path.join(workspace, "published");
  const payloadDirectory = path.join(artifactDirectory, "payload");
  const stagingDirectory = path.join(workspace, "staging");
  const chromeState = await pathState(path.join(repositoryRoot, "dist"));
  const wrapperState = await pathState(
    path.join(repositoryRoot, "Safari", "TabReaper"),
  );
  const { buildMacosPayload } = await import("./build-macos-payload.mjs");

  await buildMacosPayload({ payloadDirectory, stagingDirectory });

  expect(await readFile(path.join(payloadDirectory, "manifest.json"))).toEqual(
    await readFile(path.join(repositoryRoot, "src/manifest.safari.json")),
  );
  await expect(
    lstat(path.join(payloadDirectory, "background.js")),
  ).resolves.toBeDefined();
  await expect(
    lstat(path.join(payloadDirectory, "src/popup/index.html")),
  ).resolves.toBeDefined();
  await expect(
    lstat(path.join(artifactDirectory, "checksums.sha256")),
  ).resolves.toBeDefined();
  await expect(
    lstat(path.join(artifactDirectory, "provenance.json")),
  ).resolves.toBeDefined();
  const checksumContents = await readFile(
    path.join(artifactDirectory, "checksums.sha256"),
  );
  const provenance = JSON.parse(
    await readFile(path.join(artifactDirectory, "provenance.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const vitePackageJson = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "node_modules/vite/package.json"),
      "utf8",
    ),
  );
  expect(provenance).toEqual({
    schemaVersion: 1,
    target: "safari-macos",
    coreRevision: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(),
    dirty:
      execFileSync(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=normal"],
        { cwd: repositoryRoot, encoding: "utf8" },
      ).length > 0,
    extensionVersion: packageJson.version,
    payloadSha256: createHash("sha256").update(checksumContents).digest("hex"),
    nodeVersion: process.version,
    packageManager: packageJson.packageManager,
    viteVersion: vitePackageJson.version,
  });
  expect(await pathState(path.join(repositoryRoot, "dist"))).toEqual(
    chromeState,
  );
  expect(
    await pathState(path.join(repositoryRoot, "Safari", "TabReaper")),
  ).toEqual(wrapperState);
});

it("preserves the complete published artifact when staged validation fails", async () => {
  const workspace = await createTemporaryDirectory();
  const artifactDirectory = path.join(workspace, "published");
  const payloadDirectory = path.join(artifactDirectory, "payload");
  const stagingDirectory = path.join(workspace, "staging");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(path.join(artifactDirectory, "previous.txt"), "previous");
  const { buildMacosPayload } = await import("./build-macos-payload.mjs");

  await expect(
    buildMacosPayload({
      payloadDirectory,
      stagingDirectory,
      validateArtifact: async () => {
        throw new Error("validation refused staging");
      },
    }),
  ).rejects.toThrow(/validation refused staging/);

  await expect(
    readFile(path.join(artifactDirectory, "previous.txt"), "utf8"),
  ).resolves.toBe("previous");
});

it("restores a preserved complete artifact from an interrupted publication", async () => {
  const workspace = await createTemporaryDirectory();
  const artifactDirectory = path.join(workspace, "published");
  const { previousArtifactDirectory, recoverPublication } = await import(
    "./build-macos-payload.mjs"
  );
  await mkdir(previousArtifactDirectory(artifactDirectory), {
    recursive: true,
  });
  await writeFile(
    path.join(previousArtifactDirectory(artifactDirectory), "previous.txt"),
    "previous",
  );

  await recoverPublication(artifactDirectory);

  await expect(
    readFile(path.join(artifactDirectory, "previous.txt"), "utf8"),
  ).resolves.toBe("previous");
});

it("restores the previous complete artifact when publication rename fails", async () => {
  const workspace = await createTemporaryDirectory();
  const artifactDirectory = path.join(workspace, "published");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(path.join(artifactDirectory, "previous.txt"), "previous");
  const { publishArtifact } = await import("./build-macos-payload.mjs");

  await expect(
    publishArtifact(path.join(workspace, "missing"), artifactDirectory),
  ).rejects.toThrow();
  await expect(
    readFile(path.join(artifactDirectory, "previous.txt"), "utf8"),
  ).resolves.toBe("previous");
});

it("produces byte-for-byte identical complete artifacts in two isolated builds", async () => {
  const firstWorkspace = await createTemporaryDirectory();
  const secondWorkspace = await createTemporaryDirectory();
  const firstArtifact = path.join(firstWorkspace, "artifact");
  const secondArtifact = path.join(secondWorkspace, "artifact");
  const { buildMacosPayload } = await import("./build-macos-payload.mjs");

  await buildMacosPayload({
    payloadDirectory: path.join(firstArtifact, "payload"),
    stagingDirectory: path.join(firstWorkspace, "staging"),
  });
  await buildMacosPayload({
    payloadDirectory: path.join(secondArtifact, "payload"),
    stagingDirectory: path.join(secondWorkspace, "staging"),
  });

  const firstSnapshot = await directorySnapshot(firstArtifact);
  expect(firstSnapshot.map(({ path: filePath }) => filePath)).toContain(
    "checksums.sha256",
  );
  expect(firstSnapshot.map(({ path: filePath }) => filePath)).toContain(
    "provenance.json",
  );
  expect(await directorySnapshot(secondArtifact)).toEqual(firstSnapshot);
}, 20_000);

it("rejects a dirty release build before publishing over the prior complete artifact", async () => {
  const workspace = await createTemporaryDirectory();
  const artifactDirectory = path.join(workspace, "published");
  const payloadDirectory = path.join(artifactDirectory, "payload");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(path.join(artifactDirectory, "previous.txt"), "previous");
  const { buildMacosPayload } = await import("./build-macos-payload.mjs");

  await expect(
    buildMacosPayload({
      payloadDirectory,
      stagingDirectory: path.join(workspace, "staging"),
      release: true,
      getSourceIdentity: async () => ({
        coreRevision: "0123456789abcdef0123456789abcdef01234567",
        dirty: true,
      }),
    }),
  ).rejects.toThrow(/dirty/);
  await expect(
    readFile(path.join(artifactDirectory, "previous.txt"), "utf8"),
  ).resolves.toBe("previous");
});

it("rechecks release identity after staged validation and before publication", async () => {
  const workspace = await createTemporaryDirectory();
  const artifactDirectory = path.join(workspace, "published");
  const payloadDirectory = path.join(artifactDirectory, "payload");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(path.join(artifactDirectory, "previous.txt"), "previous");
  const coreRevision = "0123456789abcdef0123456789abcdef01234567";
  let validationFinished = false;
  const { buildMacosPayload } = await import("./build-macos-payload.mjs");

  await expect(
    buildMacosPayload({
      payloadDirectory,
      stagingDirectory: path.join(workspace, "staging"),
      release: true,
      getSourceIdentity: async () => ({
        coreRevision,
        dirty: validationFinished,
      }),
      validateArtifact: async () => {
        validationFinished = true;
      },
    }),
  ).rejects.toThrow(/became dirty before publication/);
  await expect(
    readFile(path.join(artifactDirectory, "previous.txt"), "utf8"),
  ).resolves.toBe("previous");
});

it("hard-codes the background debug constant to false", async () => {
  const source = await readFile(
    new URL("../../vite.safari.background.config.ts", import.meta.url),
    "utf8",
  );

  expect(source).toContain('__DEBUG__: "false"');
  expect(source).not.toContain("EXTENSION_DEBUG");
});
