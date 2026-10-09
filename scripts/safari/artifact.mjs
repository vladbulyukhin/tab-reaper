import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const allowedPermissions = new Set(["alarms", "tabs", "storage"]);
const execFileAsync = promisify(execFile);
export const provenanceFields = [
  "schemaVersion",
  "target",
  "coreRevision",
  "dirty",
  "extensionVersion",
  "payloadSha256",
  "nodeVersion",
  "packageManager",
  "viteVersion",
];

const isRecord = (value) => typeof value === "object" && value !== null;

export function compareCodePointStrings(left, right) {
  const leftCodePoints = [...left].map((character) => character.codePointAt(0));
  const rightCodePoints = [...right].map((character) =>
    character.codePointAt(0),
  );
  const commonLength = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < commonLength; index += 1) {
    if (leftCodePoints[index] !== rightCodePoints[index]) {
      return leftCodePoints[index] - rightCodePoints[index];
    }
  }

  return leftCodePoints.length - rightCodePoints.length;
}

export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

const toPosixRelativePath = (root, entryPath) =>
  path.relative(root, entryPath).split(path.sep).join("/");

function isCanonicalChecksumPath(filePath) {
  if (
    typeof filePath !== "string" ||
    !filePath.startsWith("payload/") ||
    filePath.includes("\\") ||
    hasUnsafeUrlCharacters(filePath)
  ) {
    return false;
  }

  const segments = filePath.split("/");
  return (
    segments.length > 1 &&
    segments[0] === "payload" &&
    segments
      .slice(1)
      .every(
        (segment) => segment.length > 0 && segment !== "." && segment !== "..",
      )
  );
}

async function collectRegularPayloadFiles(
  payloadDirectory,
  directory = payloadDirectory,
  files = [],
) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = toPosixRelativePath(payloadDirectory, entryPath);
    const checksumPath = `payload/${relativePath}`;
    const stats = await lstat(entryPath);

    if (stats.isSymbolicLink()) {
      throw new Error(`symbolic link is not allowed: ${checksumPath}`);
    }
    if (stats.isDirectory()) {
      await collectRegularPayloadFiles(payloadDirectory, entryPath, files);
      continue;
    }
    if (!stats.isFile()) {
      throw new Error(`unsupported payload entry: ${checksumPath}`);
    }
    if (!isCanonicalChecksumPath(checksumPath)) {
      throw new Error(`noncanonical payload path: ${checksumPath}`);
    }

    files.push({
      path: checksumPath,
      sourcePath: entryPath,
    });
  }

  return files;
}

export async function createChecksumEntries(payloadDirectory) {
  const root = path.resolve(payloadDirectory);
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink()) {
    throw new Error("payload root must not be a symbolic link");
  }
  if (!rootStats.isDirectory()) {
    throw new Error("payload root must be a directory");
  }

  const files = await collectRegularPayloadFiles(root);
  files.sort((left, right) => compareCodePointStrings(left.path, right.path));

  return Promise.all(
    files.map(async ({ path: checksumPath, sourcePath }) => ({
      hash: sha256(await readFile(sourcePath)),
      path: checksumPath,
    })),
  );
}

export async function createChecksums(payloadDirectory) {
  const entries = await createChecksumEntries(payloadDirectory);
  return `${entries
    .map(({ hash, path: checksumPath }) => `${hash}  ${checksumPath}`)
    .join("\n")}\n`;
}

export function parseChecksums(contents) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(
      typeof contents === "string" ? Buffer.from(contents) : contents,
    );
  } catch {
    throw new Error("checksums.sha256 must be valid UTF-8");
  }

  if (!source.endsWith("\n") || source.endsWith("\n\n")) {
    throw new Error("checksums.sha256 must end with exactly one final LF");
  }

  const lines = source.slice(0, -1).split("\n");
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new Error("checksums.sha256 must contain canonical checksum lines");
  }

  const entries = [];
  const paths = new Set();

  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!match) {
      throw new Error(`malformed checksum line: ${line}`);
    }
    const [, hash, checksumPath] = match;
    if (!isCanonicalChecksumPath(checksumPath)) {
      throw new Error(`noncanonical checksum path: ${checksumPath}`);
    }
    if (paths.has(checksumPath)) {
      throw new Error(`duplicate checksum path: ${checksumPath}`);
    }

    paths.add(checksumPath);
    entries.push({ hash, path: checksumPath });
  }

  for (let index = 1; index < entries.length; index += 1) {
    if (
      compareCodePointStrings(entries[index - 1].path, entries[index].path) >= 0
    ) {
      throw new Error("checksum entries must be sorted by lexical POSIX path");
    }
  }

  return entries;
}

export function createProvenance({
  coreRevision,
  dirty,
  extensionVersion,
  payloadSha256,
  nodeVersion,
  packageManager,
  viteVersion,
}) {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      target: "safari-macos",
      coreRevision,
      dirty,
      extensionVersion,
      payloadSha256,
      nodeVersion,
      packageManager,
      viteVersion,
    },
    null,
    2,
  )}\n`;
}

export async function readSourceIdentity(repositoryRoot) {
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
    execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    ),
  ]);

  return {
    coreRevision: revision.trim(),
    dirty: status.length > 0,
  };
}

export function hasUnsafeUrlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x20 || codePoint === 0x7f;
  });
}

const isPayloadPath = (value) => {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  try {
    return [value, decodeURIComponent(value)].every((candidate) => {
      const normalized = candidate.trim();
      return (
        !hasUnsafeUrlCharacters(candidate) &&
        !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(normalized) &&
        !normalized.startsWith("/") &&
        !normalized.includes("\\") &&
        normalized
          .split("/")
          .every(
            (segment) =>
              segment.length > 0 && segment !== "." && segment !== "..",
          )
      );
    });
  } catch {
    return false;
  }
};

export function enumerateReferencedResources(manifest) {
  if (!isRecord(manifest)) {
    return [];
  }

  const resources = [];
  const popup = manifest.browser_action?.default_popup;

  if (typeof popup === "string") {
    resources.push(popup);
  }

  if (Array.isArray(manifest.background?.scripts)) {
    resources.push(
      ...manifest.background.scripts.filter(
        (script) => typeof script === "string",
      ),
    );
  }

  if (isRecord(manifest.icons)) {
    resources.push(
      ...Object.values(manifest.icons).filter(
        (icon) => typeof icon === "string",
      ),
    );
  }

  return [...new Set(resources)];
}

export function validateManifest(manifest, availableResources) {
  const errors = [];

  if (!isRecord(manifest)) {
    throw new Error("Safari manifest must be an object");
  }

  if (manifest.manifest_version !== 2) {
    errors.push("manifest_version must be 2");
  }

  // App Store Connect rejects Safari extensions whose description is longer.
  if (
    typeof manifest.description !== "string" ||
    manifest.description.length > 112
  ) {
    errors.push("description must be a string of 112 or fewer characters");
  }

  if ("action" in manifest) {
    errors.push("action is not supported; use browser_action");
  }

  const background = manifest.background;
  if (!isRecord(background)) {
    errors.push("background must be an object");
  } else {
    if ("service_worker" in background) {
      errors.push("background.service_worker is not supported");
    }
    if ("type" in background) {
      errors.push("background.type is not supported");
    }
    if (background.persistent !== true) {
      errors.push("background.persistent must be true");
    }
    if (
      !Array.isArray(background.scripts) ||
      background.scripts.length === 0 ||
      background.scripts.some((script) => typeof script !== "string")
    ) {
      errors.push("background.scripts must contain at least one path");
    }
  }

  if (
    !Array.isArray(manifest.permissions) ||
    manifest.permissions.some(
      (permission) => !allowedPermissions.has(permission),
    )
  ) {
    errors.push("permissions must be limited to alarms, tabs, and storage");
  }

  if (
    !isRecord(manifest.browser_action) ||
    typeof manifest.browser_action.default_popup !== "string"
  ) {
    errors.push("browser_action.default_popup must be a path");
  }

  if (
    !isRecord(manifest.icons) ||
    Object.values(manifest.icons).length === 0 ||
    Object.values(manifest.icons).some((icon) => typeof icon !== "string")
  ) {
    errors.push("icons must declare at least one icon path");
  }

  const available =
    availableResources === undefined ? undefined : new Set(availableResources);
  for (const resource of enumerateReferencedResources(manifest)) {
    if (!isPayloadPath(resource)) {
      errors.push(`referenced resource escapes the payload: ${resource}`);
    }
    if (available !== undefined) {
      if (!available.has(resource)) {
        errors.push(`referenced resource is missing: ${resource}`);
      }
    }
  }

  if (Array.isArray(background?.scripts) && background.scripts.length !== 1) {
    errors.push("background.scripts must declare exactly one file");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid Safari manifest:\n- ${errors.join("\n- ")}`);
  }
}
