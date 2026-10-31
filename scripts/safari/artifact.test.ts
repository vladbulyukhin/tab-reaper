import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const validManifest = {
  manifest_version: 2,
  version: "0.2.1",
  description: "Closes idle tabs.",
  permissions: ["alarms", "tabs", "storage"],
  browser_action: { default_popup: "src/popup/index.html" },
  background: { persistent: true, scripts: ["background.js"] },
  icons: {
    16: "icons/icon-active-16.png",
    32: "icons/icon-active-32.png",
    48: "icons/icon-active-48.png",
    128: "icons/icon-active-128.png",
  },
};

const resourcePaths = [
  "src/popup/index.html",
  "background.js",
  "icons/icon-active-16.png",
  "icons/icon-active-32.png",
  "icons/icon-active-48.png",
  "icons/icon-active-128.png",
];

const artifact = () => import("./artifact.mjs");
const verifier = () => import("./verify-macos-payload.mjs");

const temporaryPayloads: string[] = [];

async function createPayload() {
  const directory = await mkdtemp(path.join(tmpdir(), "tab-reaper-safari-"));
  temporaryPayloads.push(directory);

  await populatePayload(directory);

  return directory;
}

async function populatePayload(directory: string) {
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(validManifest),
  );
  await writeFile(
    path.join(directory, "background.js"),
    "(function () {})();\n",
  );
  await mkdir(path.join(directory, "src/popup/assets"), { recursive: true });
  await writeFile(
    path.join(directory, "src/popup/index.html"),
    '<link href="./assets/popup.css"><script src="./assets/popup.js"></script>',
  );
  await writeFile(
    path.join(directory, "src/popup/assets/popup.css"),
    "body {}\n",
  );
  await writeFile(
    path.join(directory, "src/popup/assets/popup.js"),
    "void 0;\n",
  );

  for (const icon of Object.values(validManifest.icons)) {
    await mkdir(path.dirname(path.join(directory, icon)), { recursive: true });
    await writeFile(path.join(directory, icon), "icon");
  }
}

async function collectTestChecksums(
  directory: string,
  relativeDirectory = "payload",
): Promise<Array<{ hash: string; path: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const checksums: Array<{ hash: string; path: string }> = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = `${relativeDirectory}/${entry.name}`;

    if (entry.isDirectory()) {
      checksums.push(...(await collectTestChecksums(entryPath, relativePath)));
      continue;
    }

    checksums.push({
      hash: createHash("sha256")
        .update(await readFile(entryPath))
        .digest("hex"),
      path: relativePath,
    });
  }

  return checksums.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

async function writeTestMetadata(
  artifactDirectory: string,
  overrides: Record<string, unknown> = {},
) {
  const checksums = `${(
    await collectTestChecksums(path.join(artifactDirectory, "payload"))
  )
    .map(({ hash, path: filePath }) => `${hash}  ${filePath}`)
    .join("\n")}\n`;
  await writeFile(path.join(artifactDirectory, "checksums.sha256"), checksums);

  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const vitePackageJson = JSON.parse(
    await readFile(
      new URL("../../node_modules/vite/package.json", import.meta.url),
      "utf8",
    ),
  );
  const provenance = {
    schemaVersion: 1,
    target: "safari-macos",
    coreRevision: "0123456789abcdef0123456789abcdef01234567",
    dirty: true,
    extensionVersion: validManifest.version ?? "0.2.1",
    payloadSha256: createHash("sha256").update(checksums).digest("hex"),
    nodeVersion: process.version,
    packageManager: packageJson.packageManager,
    viteVersion: vitePackageJson.version,
    ...overrides,
  };
  await writeFile(
    path.join(artifactDirectory, "provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
}

async function createCompleteArtifact(
  provenanceOverrides: Record<string, unknown> = {},
) {
  const artifactDirectory = await mkdtemp(
    path.join(tmpdir(), "tab-reaper-safari-artifact-"),
  );
  temporaryPayloads.push(artifactDirectory);
  const payloadDirectory = path.join(artifactDirectory, "payload");
  await mkdir(payloadDirectory);
  await populatePayload(payloadDirectory);
  await writeTestMetadata(artifactDirectory, provenanceOverrides);
  return artifactDirectory;
}

async function updateManifest(directory: string, manifest: unknown) {
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest),
  );
}

async function removeTemporaryPayloads() {
  await Promise.all(
    temporaryPayloads
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
}

afterEach(async () => {
  await removeTemporaryPayloads();
});

it("imports the Safari artifact helpers", async () => {
  await expect(artifact()).resolves.toBeDefined();
});

it("writes a canonical lexical checksum inventory for exact payload bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "tab-reaper-checksums-"));
  temporaryPayloads.push(directory);
  await mkdir(path.join(directory, "nested"));
  await writeFile(path.join(directory, "zulu.txt"), "zulu");
  await writeFile(path.join(directory, "nested/alpha.txt"), "alpha");
  const { createChecksums } = await artifact();

  await expect(createChecksums(directory)).resolves.toBe(
    "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8  payload/nested/alpha.txt\n" +
      "f71a59e61939400f3556358063bb57fc445c7165d6062754950867406462ca93  payload/zulu.txt\n",
  );
});

it.each([
  [
    "modified",
    async (artifactDirectory: string) => {
      await writeFile(
        path.join(artifactDirectory, "payload/background.js"),
        "(function () { void 1; })();\n",
      );
    },
    /payload\/background\.js/,
  ],
  [
    "added",
    async (artifactDirectory: string) => {
      await writeFile(
        path.join(artifactDirectory, "payload/unlisted.txt"),
        "unlisted",
      );
    },
    /payload\/unlisted\.txt/,
  ],
  [
    "missing",
    async (artifactDirectory: string) => {
      const orphanPath = path.join(artifactDirectory, "payload/orphan.txt");
      await writeFile(orphanPath, "orphan");
      await writeTestMetadata(artifactDirectory);
      await rm(orphanPath);
    },
    /payload\/orphan\.txt/,
  ],
])(
  "rejects a %s payload file against the checksum inventory",
  async (_description, mutate, expectedPath) => {
    const artifactDirectory = await createCompleteArtifact();
    await mutate(artifactDirectory);
    const { verifyArtifact } = await verifier();

    await expect(verifyArtifact(artifactDirectory)).rejects.toThrow(
      expectedPath,
    );
  },
);

it.each([
  [
    "malformed line",
    (lines: string[]) => [`${"a".repeat(63)}  payload/background.js`],
    /malformed checksum line/,
  ],
  [
    "traversal path",
    (lines: string[]) => [`${lines[0].slice(0, 66)}payload/../background.js`],
    /payload\/\.\.\/background\.js/,
  ],
  [
    "duplicate path",
    (lines: string[]) => [lines[0], lines[0]],
    /duplicate checksum path/,
  ],
  ["unsorted paths", (lines: string[]) => [lines[1], lines[0]], /sorted/],
])(
  "rejects a %s in checksums.sha256",
  async (_description, mutateLines, expectedError) => {
    const artifactDirectory = await createCompleteArtifact();
    const checksumPath = path.join(artifactDirectory, "checksums.sha256");
    const lines = (await readFile(checksumPath, "utf8")).trimEnd().split("\n");
    await writeFile(checksumPath, `${mutateLines(lines).join("\n")}\n`);
    const { verifyArtifact } = await verifier();

    await expect(verifyArtifact(artifactDirectory)).rejects.toThrow(
      expectedError,
    );
  },
);

it.each([
  ["missing final LF", (contents: string) => contents.trimEnd()],
  ["multiple final LFs", (contents: string) => `${contents}\n`],
])("rejects checksums.sha256 with %s", async (_description, mutate) => {
  const artifactDirectory = await createCompleteArtifact();
  const checksumPath = path.join(artifactDirectory, "checksums.sha256");
  await writeFile(checksumPath, mutate(await readFile(checksumPath, "utf8")));
  const { verifyArtifact } = await verifier();

  await expect(verifyArtifact(artifactDirectory)).rejects.toThrow(/final LF/);
});

it("rejects provenance whose payload hash does not match checksums.sha256", async () => {
  const artifactDirectory = await createCompleteArtifact({
    payloadSha256: "0".repeat(64),
  });
  const { verifyArtifact } = await verifier();

  await expect(verifyArtifact(artifactDirectory)).rejects.toThrow(
    /payloadSha256/,
  );
});

it.each(["timestamp", "hostname", "workingDirectory"])(
  "rejects the forbidden additional provenance field %s",
  async (field) => {
    const artifactDirectory = await createCompleteArtifact({
      [field]: "must-not-ship",
    });
    const { verifyArtifact } = await verifier();

    await expect(verifyArtifact(artifactDirectory)).rejects.toThrow(field);
  },
);

it("rejects provenance with a missing required field or wrong field type", async () => {
  const artifactDirectory = await createCompleteArtifact({
    schemaVersion: "1",
  });
  const { verifyArtifact } = await verifier();

  await expect(verifyArtifact(artifactDirectory)).rejects.toThrow(
    /schemaVersion/,
  );
});

it("rejects provenance with a noncanonical Git revision length", async () => {
  const artifactDirectory = await createCompleteArtifact({
    coreRevision: "0".repeat(41),
  });
  const { verifyArtifact } = await verifier();

  await expect(verifyArtifact(artifactDirectory)).rejects.toThrow(
    /coreRevision/,
  );
});

it("allows a dirty development artifact during normal verification", async () => {
  const artifactDirectory = await createCompleteArtifact({ dirty: true });
  const { verifyArtifact } = await verifier();

  await expect(verifyArtifact(artifactDirectory)).resolves.toBeUndefined();
});

it("rejects release verification when the current worktree is dirty", async () => {
  const coreRevision = "0123456789abcdef0123456789abcdef01234567";
  const artifactDirectory = await createCompleteArtifact({
    coreRevision,
    dirty: false,
  });
  const { verifyArtifact } = await verifier();

  await expect(
    verifyArtifact(artifactDirectory, {
      release: true,
      currentSourceIdentity: { coreRevision, dirty: true },
    }),
  ).rejects.toThrow(/current worktree is dirty/);
});

it("rejects release verification when provenance records dirty sources", async () => {
  const coreRevision = "0123456789abcdef0123456789abcdef01234567";
  const artifactDirectory = await createCompleteArtifact({
    coreRevision,
    dirty: true,
  });
  const { verifyArtifact } = await verifier();

  await expect(
    verifyArtifact(artifactDirectory, {
      release: true,
      currentSourceIdentity: { coreRevision, dirty: false },
    }),
  ).rejects.toThrow(/provenance.*dirty/i);
});

it("rejects release verification when provenance revision differs from the current revision", async () => {
  const artifactDirectory = await createCompleteArtifact({
    coreRevision: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
  });
  const { verifyArtifact } = await verifier();

  await expect(
    verifyArtifact(artifactDirectory, {
      release: true,
      currentSourceIdentity: {
        coreRevision: "89abcdef0123456789abcdef0123456789abcdef",
        dirty: false,
      },
    }),
  ).rejects.toThrow(/coreRevision/);
});

it.each([
  [
    "MV3 manifests",
    { ...validManifest, manifest_version: 3 },
    /manifest_version/,
  ],
  ["the MV3 action key", { ...validManifest, action: {} }, /action/],
  [
    "background service workers",
    {
      ...validManifest,
      background: { ...validManifest.background, service_worker: "worker.js" },
    },
    /service_worker/,
  ],
  [
    "module background types",
    {
      ...validManifest,
      background: { ...validManifest.background, type: "module" },
    },
    /background.type/,
  ],
  [
    "nonpersistent backgrounds",
    {
      ...validManifest,
      background: { ...validManifest.background, persistent: false },
    },
    /persistent/,
  ],
  [
    "unexpected permissions",
    {
      ...validManifest,
      permissions: [...validManifest.permissions, "history"],
    },
    /permissions/,
  ],
  [
    "missing popup paths",
    { ...validManifest, browser_action: {} },
    /browser_action.default_popup/,
  ],
  [
    "missing background paths",
    { ...validManifest, background: { persistent: true } },
    /background.scripts/,
  ],
  ["missing icon paths", { ...validManifest, icons: {} }, /icons/],
  [
    "descriptions App Store Connect rejects",
    { ...validManifest, description: "x".repeat(113) },
    /description/,
  ],
])("rejects %s", async (_description, manifest, expectedError) => {
  const { validateManifest } = await artifact();

  expect(() => validateManifest(manifest, resourcePaths)).toThrow(
    expectedError,
  );
});

it("rejects referenced paths that are absent from the payload", async () => {
  const { validateManifest } = await artifact();

  expect(() => validateManifest(validManifest, [])).toThrow(
    /src\/popup\/index.html/,
  );
});

it("enumerates the popup, background, and icon resources", async () => {
  const { enumerateReferencedResources } = await artifact();

  expect(enumerateReferencedResources(validManifest)).toEqual(resourcePaths);
});

it("accepts the final source Safari manifest", async () => {
  const { validateManifest } = await artifact();
  const manifest = JSON.parse(
    await readFile(
      new URL("../../src/manifest.safari.json", import.meta.url),
      "utf8",
    ),
  );

  expect(() => validateManifest(manifest, resourcePaths)).not.toThrow();
});

it("rejects manifest resource paths that escape the payload", async () => {
  const { validateManifest } = await artifact();
  const manifest = {
    ...validManifest,
    browser_action: { default_popup: "../outside.html" },
  };

  expect(() =>
    validateManifest(manifest, [...resourcePaths, "../outside.html"]),
  ).toThrow(/\.\.\/outside.html/);
});

it("rejects URL-decoded manifest resource traversal", async () => {
  const { validateManifest } = await artifact();
  const manifest = {
    ...validManifest,
    browser_action: { default_popup: "%2e%2e/outside.html" },
  };

  expect(() =>
    validateManifest(manifest, [...resourcePaths, "%2e%2e/outside.html"]),
  ).toThrow(/%2e%2e\/outside.html/);
});

it("rejects decoded scheme-prefixed manifest resources even when a matching file exists", async () => {
  const directory = await createPayload();
  const manifest = {
    ...validManifest,
    browser_action: { default_popup: "data%3atext/html,x" },
  };
  await mkdir(path.join(directory, "data%3atext"), { recursive: true });
  await writeFile(path.join(directory, "data%3atext/html,x"), "popup");
  await updateManifest(directory, manifest);
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(/data%3atext\/html,x/);
});

it("rejects manifest schemes preceded by ASCII whitespace", async () => {
  const directory = await createPayload();
  const manifest = {
    ...validManifest,
    browser_action: { default_popup: " data%3atext/html,x" },
  };
  await mkdir(path.join(directory, " data%3atext"), { recursive: true });
  await writeFile(path.join(directory, " data%3atext/html,x"), "popup");
  await updateManifest(directory, manifest);
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    / data%3atext\/html,x/,
  );
});

it.each([
  ["a leading C0 control", "\u0001data:text/html,x"],
  ["an internal ASCII tab", "d\tata:text/html,x"],
])(
  "rejects a manifest scheme obscured by %s even when a matching file exists",
  async (_description, unsafeResource) => {
    const directory = await createPayload();
    const manifest = {
      ...validManifest,
      browser_action: { default_popup: unsafeResource },
    };
    await mkdir(path.dirname(path.join(directory, unsafeResource)), {
      recursive: true,
    });
    await writeFile(path.join(directory, unsafeResource), "<!doctype html>");
    await updateManifest(directory, manifest);
    const { verifyPayload } = await verifier();

    await expect(verifyPayload(directory)).rejects.toThrow(unsafeResource);
  },
);

it("rejects multiple declared background files", async () => {
  const { validateManifest } = await artifact();
  const manifest = {
    ...validManifest,
    background: {
      ...validManifest.background,
      scripts: ["background.js", "other-background.js"],
    },
  };

  expect(() =>
    validateManifest(manifest, [...resourcePaths, "other-background.js"]),
  ).toThrow(/exactly one/);
});

it("rejects payloads with missing manifest resources and identifies the path", async () => {
  const directory = await createPayload();
  await rm(path.join(directory, "background.js"));
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(/background\.js/);
});

it("rejects empty files and identifies the relative path", async () => {
  const directory = await createPayload();
  await writeFile(path.join(directory, "background.js"), "");
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(/background\.js/);
});

it("rejects source maps and hidden temporary files", async () => {
  const directory = await createPayload();
  await writeFile(path.join(directory, "src/popup/assets/popup.js.map"), "map");
  await writeFile(path.join(directory, ".temporary"), "temporary");
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(/popup\.js\.map/);
  await expect(verifyPayload(directory)).rejects.toThrow(/\.temporary/);
});

it("rejects symlinks and identifies the relative path", async () => {
  const directory = await createPayload();
  await symlink("background.js", path.join(directory, "linked-background.js"));
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    /linked-background\.js/,
  );
});

it("rejects popup references that are missing or outside the payload", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "src/popup/index.html"),
    '<script src="https://example.test/popup.js"></script><link href="./missing.css">',
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    /https:\/\/example\.test\/popup\.js/,
  );
  await expect(verifyPayload(directory)).rejects.toThrow(
    /src\/popup\/missing\.css/,
  );
});

it("rejects URL-decoded popup traversal", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "src/popup/index.html"),
    '<script src="%2e%2e/outside.js"></script>',
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(/%2e%2e\/outside.js/);
});

it.each([
  [
    "unquoted external URL",
    "<script src=https://example.test/popup.js></script>",
    /https:\/\/example\.test\/popup\.js/,
  ],
  [
    "entity-encoded external URL",
    '<script src="https&#58;//example.test/popup.js"></script>',
    /https&#58;\/\/example\.test\/popup\.js/,
  ],
  [
    "entity-encoded traversal",
    '<script src="&#37;2e&#37;2e/outside.js"></script>',
    /&#37;2e&#37;2e\/outside.js/,
  ],
])(
  "rejects %s popup reference and identifies its raw value",
  async (_description, source, expectedError) => {
    const directory = await createPayload();
    await writeFile(path.join(directory, "src/popup/index.html"), source);
    const { verifyPayload } = await verifier();

    await expect(verifyPayload(directory)).rejects.toThrow(expectedError);
  },
);

it.each([
  [
    "leading whitespace before an external scheme",
    '<script src=" https://example.test/popup.js"></script>',
    / https:\/\/example\.test\/popup\.js/,
  ],
  [
    "a semicolonless named entity",
    '<script src="https&colon//example.test/popup.js"></script>',
    /https&colon\/\/example\.test\/popup\.js/,
  ],
  [
    "a semicolonless numeric entity",
    '<script src="https&#58//example.test/popup.js"></script>',
    /https&#58\/\/example\.test\/popup\.js/,
  ],
])(
  "rejects %s popup reference and identifies its raw value",
  async (_description, source, expectedError) => {
    const directory = await createPayload();
    await writeFile(path.join(directory, "src/popup/index.html"), source);
    const { verifyPayload } = await verifier();

    await expect(verifyPayload(directory)).rejects.toThrow(expectedError);
  },
);

it.each([
  ["a leading C0 control", "\u0001data:text/javascript,x"],
  ["an internal ASCII tab", "d\tata:text/javascript,x"],
  ["an internal ASCII line feed", "d\nata:text/javascript,x"],
])(
  "rejects a popup scheme obscured by %s even when a matching file exists",
  async (_description, unsafeReference) => {
    const directory = await createPayload();
    const target = path.join(directory, "src/popup", unsafeReference);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "void 0;");
    await writeFile(
      path.join(directory, "src/popup/index.html"),
      `<script src="${unsafeReference}"></script>`,
    );
    const { verifyPayload } = await verifier();

    await expect(verifyPayload(directory)).rejects.toThrow(unsafeReference);
  },
);

it("ignores data-src attributes when validating popup references", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "src/popup/index.html"),
    '<div data-src="https://example.test/not-a-resource"></div><script src="./assets/popup.js"></script>',
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).resolves.toBeUndefined();
});

it("rejects external script imports and identifies the script", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "background.js"),
    'import "https://example.test/background.js";\n',
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(/background\.js/);
});

it.each([
  'import /* comment */ "https://example.test/static.js";',
  "import /* comment */ ( `https://example.test/dynamic.js` );",
  "importScripts /* comment */ ( `https://example.test/legacy.js` );",
])("rejects comment-tolerant external imports: %s", async (source) => {
  const directory = await createPayload();
  await writeFile(path.join(directory, "background.js"), source);
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(/background\.js/);
});

it.each([
  'import("da"+"ta:text/javascript,x")',
  'const u="data:text/javascript,x"; import(u)',
  'importScripts("da"+"ta:text/javascript,x")',
])("rejects computed script-loading constructs: %s", async (construct) => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "background.js"),
    `(function () { ${construct}; })();\n`,
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    /external script import is not allowed: background\.js/,
  );
});

it.each([
  [
    "dynamic import inside template interpolation",
    '(function () { const value = `${import("data:text/javascript,x")}`; void value; })();\n',
  ],
  [
    "importScripts inside template interpolation",
    '(function () { const value = `${importScripts("data:text/javascript,x")}`; void value; })();\n',
  ],
])("rejects %s", async (_description, source) => {
  const directory = await createPayload();
  await writeFile(path.join(directory, "background.js"), source);
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    /external script import is not allowed: background\.js/,
  );
});

it.each([
  [
    "a regular expression literal",
    '(function () { const pattern = /importScripts("data:text\\/javascript,x")/; void pattern; })();\n',
  ],
  [
    "ordinary template text",
    '(function () { const text = `importScripts("data:text/javascript,x")`; void text; })();\n',
  ],
  [
    "a member call",
    '(function () { const object = { importScripts() {} }; object.importScripts("data:text/javascript,x"); })();\n',
  ],
  [
    "a longer Unicode identifier",
    '(function () { const éimportScripts = () => {}; éimportScripts("data:text/javascript,x"); })();\n',
  ],
  [
    "an exact non-call identifier",
    '(function () { const importScripts = "data:text/javascript,x"; void importScripts; })();\n',
  ],
])("accepts script-loading text in %s", async (_description, source) => {
  const directory = await createPayload();
  await writeFile(path.join(directory, "background.js"), source);
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).resolves.toBeUndefined();
});

it.each([
  ["surrounding comments", "/* before */ (function () {})(); // after\n"],
  ["redundant parentheses", "((function () {}))();\n"],
])("accepts a classic IIFE with %s", async (_description, source) => {
  const directory = await createPayload();
  await writeFile(path.join(directory, "background.js"), source);
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).resolves.toBeUndefined();
});

it("rejects malformed JavaScript outside the declared background", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "src/popup/assets/popup.js"),
    "function {",
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    /malformed JavaScript is not allowed: src\/popup\/assets\/popup\.js/,
  );
});

it.each([
  ["worker.mjs", /src\/popup\/assets\/worker\.mjs/],
  ["worker.cjs", /src\/popup\/assets\/worker\.cjs/],
])(
  "rejects executable imports in the %s payload file",
  async (fileName, expectedPath) => {
    const directory = await createPayload();
    const relativePath = `src/popup/assets/${fileName}`;
    await writeFile(
      path.join(directory, relativePath),
      '(function () { import("data:text/javascript,x"); })();\n',
    );
    const { verifyPayload } = await verifier();

    await expect(verifyPayload(directory)).rejects.toThrow(expectedPath);
  },
);

it("rejects an external static import outside the declared background", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "src/popup/assets/popup.js"),
    'import "https://example.test/popup.js";\n',
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    /external script import is not allowed: src\/popup\/assets\/popup\.js/,
  );
});

it("accepts local static module references outside the declared background", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "src/popup/assets/popup.js"),
    'import "./local.js"; export { value } from "./local.js";\n',
  );
  await writeFile(
    path.join(directory, "src/popup/assets/local.js"),
    "export const value = 1;\n",
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).resolves.toBeUndefined();
});

it("ignores script-loading text in comments, strings, and identifiers", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "background.js"),
    `(function () {
      // import("data:text/javascript,x")
      const source = 'importScripts("data:text/javascript,x")';
      const myimport = () => {};
      const importScriptsAlias = () => {};
      const importScripts = "data:text/javascript,x";
      myimport(source);
      importScriptsAlias(source);
      void importScripts;
    })();\n`,
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).resolves.toBeUndefined();
});

it.each([
  'export * /* comment */ from /* comment */ "https://example.test/re-export.js";',
  "export { value } /* comment */ from /* comment */ 'https://example.test/named-re-export.js';",
])("rejects external re-exports: %s", async (source) => {
  const directory = await createPayload();
  await writeFile(path.join(directory, "background.js"), source);
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    /external script import is not allowed: background\.js/,
  );
});

it("rejects a declared background that is not a classic IIFE", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "background.js"),
    "globalThis.started = true;\n",
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(/background\.js/);
});

it("identifies malformed JavaScript in the declared background", async () => {
  const directory = await createPayload();
  await writeFile(path.join(directory, "background.js"), "(function () {");
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    /malformed JavaScript is not allowed: background\.js/,
  );
});

it.each([
  ["an arrow IIFE", "(() => {})();\n"],
  ["an extra top-level statement", "(function () {})(); void 0;\n"],
])(
  "rejects a declared background containing %s",
  async (_description, source) => {
    const directory = await createPayload();
    await writeFile(path.join(directory, "background.js"), source);
    const { verifyPayload } = await verifier();

    await expect(verifyPayload(directory)).rejects.toThrow(
      /background must be a classic IIFE: background\.js/,
    );
  },
);

it("rejects multiple top-level background IIFEs", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "background.js"),
    "(function () {})();(function () {})();\n",
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    /background must be a classic IIFE: background\.js/,
  );
});

it("accepts a classic IIFE whose regular expression contains a closing brace", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "background.js"),
    "(function () { const closingBrace = /}/; void closingBrace; })();\n",
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).resolves.toBeUndefined();
});

it("accepts a classic IIFE that returns a regular expression containing a closing brace", async () => {
  const directory = await createPayload();
  await writeFile(
    path.join(directory, "background.js"),
    "(function () { return /}/; })();\n",
  );
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).resolves.toBeUndefined();
});

it("rejects a symbolic-link payload root", async () => {
  const directory = await createPayload();
  const linkedRoot = `${directory}-link`;
  temporaryPayloads.push(linkedRoot);
  await symlink(directory, linkedRoot);
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(linkedRoot)).rejects.toThrow(/payload root/);
});

it("accepts a clean complete payload", async () => {
  const directory = await createPayload();
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).resolves.toBeUndefined();
});

it("requires exactly one manifest in the payload", async () => {
  const directory = await createPayload();
  await mkdir(path.join(directory, "nested"));
  await writeFile(path.join(directory, "nested/manifest.json"), "{}");
  const { verifyPayload } = await verifier();

  await expect(verifyPayload(directory)).rejects.toThrow(
    /nested\/manifest\.json/,
  );
});
