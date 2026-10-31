import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "acorn";
import {
  createChecksumEntries,
  createProvenance,
  hasUnsafeUrlCharacters,
  parseChecksums,
  provenanceFields,
  readSourceIdentity,
  sha256,
  validateManifest,
} from "./artifact.mjs";

const toRelativePath = (payloadDirectory, filePath) =>
  path.relative(payloadDirectory, filePath).split(path.sep).join("/");
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const artifactEntries = new Set([
  "checksums.sha256",
  "payload",
  "provenance.json",
]);

const isJavaScriptFile = (filePath) => /\.(?:c|m)?js$/i.test(filePath);

const isWithinPayload = (payloadDirectory, filePath) => {
  const relativePath = path.relative(payloadDirectory, filePath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
};

async function collectFiles(
  payloadDirectory,
  directory = payloadDirectory,
  files = [],
  errors = [],
) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = toRelativePath(payloadDirectory, entryPath);
    const stats = await lstat(entryPath);

    if (stats.isSymbolicLink()) {
      errors.push(`symbolic link is not allowed: ${relativePath}`);
      continue;
    }

    if (stats.isDirectory()) {
      await collectFiles(payloadDirectory, entryPath, files, errors);
      continue;
    }

    if (!stats.isFile()) {
      errors.push(`unsupported payload entry: ${relativePath}`);
      continue;
    }

    files.push(relativePath);

    if (relativePath.split("/").some((segment) => segment.startsWith("."))) {
      errors.push(`hidden temporary file is not allowed: ${relativePath}`);
    }
    if (relativePath.endsWith(".map")) {
      errors.push(`source map is not allowed: ${relativePath}`);
    }
    if (stats.size === 0) {
      errors.push(`empty file is not allowed: ${relativePath}`);
    }
  }

  return { errors, files };
}

function popupReferences(source) {
  return [
    ...source.matchAll(
      /(?:^|[\s<])(?:src|href)\s*=\s*(?:(["'])([\s\S]*?)\1|([^\s"'=<>`]+))/gi,
    ),
  ].map((match) => ({
    quoted: Boolean(match[1]),
    value: match[2] ?? match[3],
  }));
}

function externalReference(value) {
  return (
    hasUnsafeUrlCharacters(value) ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value.trim())
  );
}

function astContains(program, predicate) {
  const values = [program];

  while (values.length > 0) {
    const value = values.pop();
    if (!value || typeof value !== "object") {
      continue;
    }

    if (typeof value.type === "string" && predicate(value)) {
      return true;
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        if (Array.isArray(child)) {
          for (const item of child) {
            values.push(item);
          }
        } else {
          values.push(child);
        }
      }
    }
  }

  return false;
}

function isExternalStaticModuleReference(node) {
  return (
    [
      "ImportDeclaration",
      "ExportAllDeclaration",
      "ExportNamedDeclaration",
    ].includes(node.type) &&
    typeof node.source?.value === "string" &&
    externalReference(node.source.value)
  );
}

function hasExternalScriptImport(program) {
  return astContains(
    program,
    (node) =>
      node.type === "ImportExpression" ||
      (node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        node.callee.name === "importScripts") ||
      isExternalStaticModuleReference(node),
  );
}

function parseJavaScript(filePath, source, errors) {
  try {
    return parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch (error) {
    errors.push(
      `malformed JavaScript is not allowed: ${filePath}: ${error.message}`,
    );
    return undefined;
  }
}

function verifyPopupReferences(
  payloadDirectory,
  popupPath,
  source,
  files,
  errors,
) {
  for (const reference of popupReferences(source)) {
    if (!reference.quoted) {
      errors.push(`popup reference must be quoted: ${reference.value}`);
      continue;
    }

    if (reference.value.includes("&")) {
      errors.push(
        `popup reference contains an unsupported entity: ${reference.value}`,
      );
      continue;
    }

    if (hasUnsafeUrlCharacters(reference.value)) {
      errors.push(`popup reference leaves the payload: ${reference.value}`);
      continue;
    }

    const pathname = reference.value.trim().split(/[?#]/, 1)[0];

    if (!pathname) {
      continue;
    }
    let decodedPathname;
    try {
      decodedPathname = decodeURIComponent(pathname);
    } catch {
      errors.push(`popup reference leaves the payload: ${reference.value}`);
      continue;
    }
    if (
      hasUnsafeUrlCharacters(decodedPathname) ||
      decodedPathname.includes("\\") ||
      decodedPathname.split("/").some((segment) => segment === "..")
    ) {
      errors.push(`popup reference leaves the payload: ${reference.value}`);
      continue;
    }
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(decodedPathname)) {
      errors.push(`popup reference leaves the payload: ${reference.value}`);
      continue;
    }

    const targetPath = path.resolve(path.dirname(popupPath), decodedPathname);
    if (!isWithinPayload(payloadDirectory, targetPath)) {
      errors.push(`popup reference leaves the payload: ${reference.value}`);
      continue;
    }

    const relativePath = toRelativePath(payloadDirectory, targetPath);
    if (!files.includes(relativePath)) {
      errors.push(`popup reference is missing: ${relativePath}`);
    }
  }
}

function verifyScriptImports(filePath, program, errors) {
  if (hasExternalScriptImport(program)) {
    errors.push(`external script import is not allowed: ${filePath}`);
  }
}

function isClassicIife(program) {
  const [statement] = program.body;

  return (
    program.body.length === 1 &&
    statement.type === "ExpressionStatement" &&
    statement.expression.type === "CallExpression" &&
    statement.expression.callee.type === "FunctionExpression"
  );
}

export async function verifyPayload(payloadDirectory) {
  const root = path.resolve(payloadDirectory);
  const errors = [];
  let files = [];

  try {
    if ((await lstat(root)).isSymbolicLink()) {
      throw new Error("payload root must not be a symbolic link");
    }
    ({ files } = await collectFiles(root, root, files, errors));
  } catch (error) {
    throw new Error(`Unable to read Safari payload: ${error.message}`);
  }

  const manifests = files.filter(
    (filePath) => path.posix.basename(filePath) === "manifest.json",
  );
  if (manifests.length !== 1 || manifests[0] !== "manifest.json") {
    errors.push(
      `payload must contain exactly one root manifest.json; found: ${
        manifests.join(", ") || "none"
      }`,
    );
  }

  let manifest;
  if (files.includes("manifest.json")) {
    try {
      manifest = JSON.parse(
        await readFile(path.join(root, "manifest.json"), "utf8"),
      );
      validateManifest(manifest, files);
    } catch (error) {
      errors.push(error.message);
    }
  }

  const popup = manifest?.browser_action?.default_popup;
  if (typeof popup === "string" && files.includes(popup)) {
    const popupPath = path.join(root, popup);
    verifyPopupReferences(
      root,
      popupPath,
      await readFile(popupPath, "utf8"),
      files,
      errors,
    );
  }

  const javaScriptPrograms = new Map();
  for (const filePath of files.filter(isJavaScriptFile)) {
    const program = parseJavaScript(
      filePath,
      await readFile(path.join(root, filePath), "utf8"),
      errors,
    );
    if (program) {
      javaScriptPrograms.set(filePath, program);
      verifyScriptImports(filePath, program, errors);
    }
  }

  const background = manifest?.background?.scripts?.[0];
  const backgroundProgram = javaScriptPrograms.get(background);
  if (backgroundProgram && !isClassicIife(backgroundProgram)) {
    errors.push(`background must be a classic IIFE: ${background}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid Safari macOS payload:\n- ${errors.join("\n- ")}`);
  }
}

async function verifyArtifactLayout(artifactDirectory) {
  const root = path.resolve(artifactDirectory);
  let rootStats;
  try {
    rootStats = await lstat(root);
  } catch (error) {
    throw new Error(`Unable to read Safari macOS artifact: ${error.message}`);
  }
  if (rootStats.isSymbolicLink()) {
    throw new Error("Safari macOS artifact root must not be a symbolic link");
  }
  if (!rootStats.isDirectory()) {
    throw new Error("Safari macOS artifact root must be a directory");
  }

  const entries = await readdir(root, { withFileTypes: true });
  const names = new Set(entries.map(({ name }) => name));
  const unexpected = [...names]
    .filter((name) => !artifactEntries.has(name))
    .sort();
  const missing = [...artifactEntries].filter((name) => !names.has(name));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `Invalid Safari macOS artifact layout:${
        missing.length > 0 ? ` missing ${missing.join(", ")}` : ""
      }${unexpected.length > 0 ? ` unexpected ${unexpected.join(", ")}` : ""}`,
    );
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw new Error(`artifact symbolic link is not allowed: ${entry.name}`);
    }
    if (entry.name === "payload" ? !stats.isDirectory() : !stats.isFile()) {
      throw new Error(`artifact entry has the wrong type: ${entry.name}`);
    }
  }

  return root;
}

function compareChecksumInventories(expected, actual) {
  const expectedByPath = new Map(
    expected.map(({ hash, path: checksumPath }) => [checksumPath, hash]),
  );
  const actualByPath = new Map(
    actual.map(({ hash, path: checksumPath }) => [checksumPath, hash]),
  );
  const errors = [];

  for (const [checksumPath, expectedHash] of expectedByPath) {
    const actualHash = actualByPath.get(checksumPath);
    if (actualHash === undefined) {
      errors.push(`checksum entry is missing a payload file: ${checksumPath}`);
    } else if (actualHash !== expectedHash) {
      errors.push(`payload file checksum does not match: ${checksumPath}`);
    }
  }
  for (const checksumPath of actualByPath.keys()) {
    if (!expectedByPath.has(checksumPath)) {
      errors.push(`payload file is missing from checksums: ${checksumPath}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid Safari checksum inventory:\n- ${errors.join("\n- ")}`,
    );
  }
}

function parseProvenance(contents) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    throw new Error("provenance.json must be valid UTF-8");
  }
  if (!source.endsWith("\n") || source.endsWith("\n\n")) {
    throw new Error("provenance.json must end with exactly one final LF");
  }

  let provenance;
  try {
    provenance = JSON.parse(source);
  } catch (error) {
    throw new Error(`provenance.json must be valid JSON: ${error.message}`);
  }
  if (
    typeof provenance !== "object" ||
    provenance === null ||
    Array.isArray(provenance)
  ) {
    throw new Error("provenance.json must contain an object");
  }

  const keys = Object.keys(provenance);
  for (const field of keys) {
    if (!provenanceFields.includes(field)) {
      throw new Error(`provenance contains an additional field: ${field}`);
    }
  }
  for (const field of provenanceFields) {
    if (!Object.hasOwn(provenance, field)) {
      throw new Error(`provenance is missing required field: ${field}`);
    }
  }

  if (provenance.schemaVersion !== 1) {
    throw new Error("provenance schemaVersion must be 1");
  }
  if (provenance.target !== "safari-macos") {
    throw new Error('provenance target must be "safari-macos"');
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(provenance.coreRevision)) {
    throw new Error("provenance coreRevision must be a lowercase Git revision");
  }
  if (typeof provenance.dirty !== "boolean") {
    throw new Error("provenance dirty must be a boolean");
  }
  for (const field of [
    "extensionVersion",
    "nodeVersion",
    "packageManager",
    "viteVersion",
  ]) {
    if (
      typeof provenance[field] !== "string" ||
      provenance[field].length === 0
    ) {
      throw new Error(`provenance ${field} must be a non-empty string`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(provenance.payloadSha256)) {
    throw new Error(
      "provenance payloadSha256 must be a lowercase SHA-256 digest",
    );
  }
  if (source !== createProvenance(provenance)) {
    throw new Error("provenance.json must use canonical deterministic JSON");
  }

  return provenance;
}

export async function verifyArtifact(
  artifactDirectory,
  {
    release = false,
    currentSourceIdentity,
    sourceRepositoryRoot = repositoryRoot,
  } = {},
) {
  const root = await verifyArtifactLayout(artifactDirectory);
  const payloadDirectory = path.join(root, "payload");

  await verifyPayload(payloadDirectory);

  const checksumContents = await readFile(path.join(root, "checksums.sha256"));
  const declaredChecksums = parseChecksums(checksumContents);
  const actualChecksums = await createChecksumEntries(payloadDirectory);
  compareChecksumInventories(declaredChecksums, actualChecksums);

  const provenance = parseProvenance(
    await readFile(path.join(root, "provenance.json")),
  );
  const expectedPayloadHash = sha256(checksumContents);
  if (provenance.payloadSha256 !== expectedPayloadHash) {
    throw new Error(
      `provenance payloadSha256 does not match checksums.sha256: ${provenance.payloadSha256}`,
    );
  }

  const manifest = JSON.parse(
    await readFile(path.join(payloadDirectory, "manifest.json"), "utf8"),
  );
  if (provenance.extensionVersion !== manifest.version) {
    throw new Error(
      `provenance extensionVersion does not match payload/manifest.json: ${provenance.extensionVersion}`,
    );
  }

  if (release) {
    const current =
      currentSourceIdentity ?? (await readSourceIdentity(sourceRepositoryRoot));
    if (current.dirty) {
      throw new Error(
        "release verification refused: current worktree is dirty",
      );
    }
    if (provenance.dirty) {
      throw new Error(
        "release verification refused: provenance records dirty sources",
      );
    }
    if (provenance.coreRevision !== current.coreRevision) {
      throw new Error(
        `release verification refused: provenance coreRevision ${provenance.coreRevision} differs from current revision ${current.coreRevision}`,
      );
    }
  }
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  const defaultArtifact = fileURLToPath(
    new URL("../../artifacts/safari-macos", import.meta.url),
  );
  const argumentsList = process.argv.slice(2);
  const release = argumentsList.includes("--release");
  const positionalArguments = argumentsList.filter(
    (argument) => argument !== "--release",
  );

  if (positionalArguments.length > 1) {
    console.error(
      "Usage: verify-macos-payload.mjs [artifact-directory] [--release]",
    );
    process.exitCode = 1;
  } else {
    verifyArtifact(positionalArguments[0] ?? defaultArtifact, {
      release,
    }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
