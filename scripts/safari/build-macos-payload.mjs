import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChecksums,
  createProvenance,
  readSourceIdentity,
  sha256,
} from "./artifact.mjs";
import { verifyArtifact, verifyPayload } from "./verify-macos-payload.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const stagingParent = path.join(repositoryRoot, ".build", "safari-macos");
const publishedArtifact = path.join(
  repositoryRoot,
  "artifacts",
  "safari-macos",
);
const publishedPayload = path.join(publishedArtifact, "payload");

function run(command, argumentsList, environment) {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(command, argumentsList, {
      cwd: repositoryRoot,
      env: environment,
      stdio: "inherit",
    });

    processHandle.on("error", reject);
    processHandle.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with status ${code}`));
      }
    });
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export const previousArtifactDirectory = (artifactDirectory) =>
  `${artifactDirectory}.previous`;
export const previousPayloadDirectory = previousArtifactDirectory;

export async function recoverPublication(artifactDirectory) {
  const previousArtifact = previousArtifactDirectory(artifactDirectory);
  const hasArtifact = await exists(artifactDirectory);
  const hasPreviousArtifact = await exists(previousArtifact);

  if (!hasArtifact && hasPreviousArtifact) {
    await mkdir(path.dirname(artifactDirectory), { recursive: true });
    await rename(previousArtifact, artifactDirectory);
  } else if (hasArtifact && hasPreviousArtifact) {
    await rm(previousArtifact, { force: true, recursive: true });
  }
}

export async function publishArtifact(stagingDirectory, artifactDirectory) {
  await mkdir(path.dirname(artifactDirectory), { recursive: true });
  await recoverPublication(artifactDirectory);
  const previousArtifact = previousArtifactDirectory(artifactDirectory);

  if (await exists(artifactDirectory)) {
    await rename(artifactDirectory, previousArtifact);
  }

  try {
    await rename(stagingDirectory, artifactDirectory);
  } catch (error) {
    await recoverPublication(artifactDirectory);
    throw error;
  }

  await rm(previousArtifact, { force: true, recursive: true });
}
export const publishPayload = publishArtifact;

async function writeArtifactMetadata(
  artifactDirectory,
  sourceIdentity,
  sourceRepositoryRoot,
) {
  const payloadDirectory = path.join(artifactDirectory, "payload");
  const checksumContents = await createChecksums(payloadDirectory);
  await writeFile(
    path.join(artifactDirectory, "checksums.sha256"),
    checksumContents,
  );

  const [manifest, packageJson, vitePackageJson] = await Promise.all([
    readFile(path.join(payloadDirectory, "manifest.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(path.join(sourceRepositoryRoot, "package.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(
      path.join(sourceRepositoryRoot, "node_modules", "vite", "package.json"),
      "utf8",
    ).then(JSON.parse),
  ]);
  const provenance = createProvenance({
    ...sourceIdentity,
    extensionVersion: manifest.version,
    payloadSha256: sha256(checksumContents),
    nodeVersion: process.version,
    packageManager: packageJson.packageManager,
    viteVersion: vitePackageJson.version,
  });
  await writeFile(path.join(artifactDirectory, "provenance.json"), provenance);
}

export async function buildMacosPayload({
  payloadDirectory = publishedPayload,
  stagingDirectory = stagingParent,
  validatePayload = verifyPayload,
  validateArtifact = verifyArtifact,
  release = false,
  getSourceIdentity = readSourceIdentity,
  sourceRepositoryRoot = repositoryRoot,
} = {}) {
  if (path.basename(payloadDirectory) !== "payload") {
    throw new Error("payloadDirectory must end with payload");
  }
  const artifactDirectory = path.dirname(payloadDirectory);
  const relativeStagingPath = path.relative(
    artifactDirectory,
    path.resolve(stagingDirectory),
  );
  if (
    relativeStagingPath === "" ||
    (!relativeStagingPath.startsWith("..") &&
      !path.isAbsolute(relativeStagingPath))
  ) {
    throw new Error("stagingDirectory must be outside the published artifact");
  }

  const sourceIdentity = await getSourceIdentity(sourceRepositoryRoot);
  if (release && sourceIdentity.dirty) {
    throw new Error("release build refused: current worktree is dirty");
  }

  await recoverPublication(artifactDirectory);
  await mkdir(stagingDirectory, { recursive: true });
  const stagingArtifact = await mkdtemp(
    path.join(stagingDirectory, "artifact-"),
  );
  const stagingPayload = path.join(stagingArtifact, "payload");
  await mkdir(stagingPayload);
  const environment = { ...process.env, EXTENSION_DEBUG: "false" };

  try {
    await run(
      "pnpm",
      [
        "exec",
        "vite",
        "build",
        "--config",
        "vite.safari.popup.config.ts",
        "--outDir",
        stagingPayload,
      ],
      environment,
    );
    await mkdir(path.join(stagingPayload, "src", "popup"), {
      recursive: true,
    });
    await rename(
      path.join(stagingPayload, "index.html"),
      path.join(stagingPayload, "src", "popup", "index.html"),
    );
    if (await exists(path.join(stagingPayload, "assets"))) {
      await rename(
        path.join(stagingPayload, "assets"),
        path.join(stagingPayload, "src", "popup", "assets"),
      );
    }
    await run(
      "pnpm",
      [
        "exec",
        "vite",
        "build",
        "--config",
        "vite.safari.background.config.ts",
        "--outDir",
        stagingPayload,
      ],
      environment,
    );
    await copyFile(
      path.join(repositoryRoot, "src", "manifest.safari.json"),
      path.join(stagingPayload, "manifest.json"),
    );
    await validatePayload(stagingPayload);
    await writeArtifactMetadata(
      stagingArtifact,
      sourceIdentity,
      sourceRepositoryRoot,
    );

    const publicationSourceIdentity = release
      ? await getSourceIdentity(sourceRepositoryRoot)
      : sourceIdentity;
    if (
      release &&
      (publicationSourceIdentity.dirty ||
        publicationSourceIdentity.coreRevision !== sourceIdentity.coreRevision)
    ) {
      throw new Error(
        publicationSourceIdentity.dirty
          ? "release build refused: current worktree became dirty before publication"
          : "release build refused: current revision changed before publication",
      );
    }
    await validateArtifact(stagingArtifact, {
      release,
      currentSourceIdentity: publicationSourceIdentity,
      sourceRepositoryRoot,
    });
    if (release) {
      const finalSourceIdentity = await getSourceIdentity(sourceRepositoryRoot);
      if (
        finalSourceIdentity.dirty ||
        finalSourceIdentity.coreRevision !== sourceIdentity.coreRevision
      ) {
        throw new Error(
          finalSourceIdentity.dirty
            ? "release build refused: current worktree became dirty before publication"
            : "release build refused: current revision changed before publication",
        );
      }
    }
    await publishArtifact(stagingArtifact, artifactDirectory);
  } finally {
    if (await exists(stagingArtifact)) {
      await rm(stagingArtifact, { force: true, recursive: true });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argumentsList = process.argv.slice(2);
  const release = argumentsList.includes("--release");
  const unknownArguments = argumentsList.filter(
    (argument) => argument !== "--release",
  );

  const build =
    unknownArguments.length === 0
      ? buildMacosPayload({ release })
      : Promise.reject(new Error("Usage: build-macos-payload.mjs [--release]"));
  build.catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
