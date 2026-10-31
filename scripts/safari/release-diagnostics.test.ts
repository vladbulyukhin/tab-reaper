import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import { buildMacosPayload } from "./build-macos-payload.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const temporaryDirectories: string[] = [];
const forbiddenReleaseMarkers = [
  "__raw_ping",
  "__debug",
  "__TAB_REAPER_DIAG_DONE__",
  "globalThis.__DEBUG__",
  "[tab-reaper][",
  "[tab-reaper][diag]",
  "[tab-reaper][raw]",
  "[tab-reaper][message]",
  "[tab-reaper][env]",
  "background-service-init",
];

async function createTemporaryDirectory(prefix: string) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function run(command: string, argumentsList: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        EXTENSION_DEBUG: "false",
        EXTENSION_TARGET: "chrome",
      },
      stdio: "pipe",
    });
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} exited with status ${code}${
              stderr ? `\n${stderr}` : ""
            }`,
          ),
        );
      }
    });
  });
}

async function readJavaScript(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readJavaScript(entryPath);
      }
      return entry.name.endsWith(".js") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

function expectNoReleaseDiagnostics(javascript: string) {
  for (const marker of forbiddenReleaseMarkers) {
    expect(javascript, `release JavaScript contains ${marker}`).not.toContain(
      marker,
    );
  }
}

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

it("removes diagnostics from Chrome release JavaScript", async () => {
  const outputDirectory = await createTemporaryDirectory(
    "tab-reaper-chrome-release-",
  );

  await run("pnpm", ["exec", "vite", "build", "--outDir", outputDirectory]);

  expectNoReleaseDiagnostics(await readJavaScript(outputDirectory));
});

it("removes diagnostics from Safari release JavaScript", async () => {
  const workspace = await createTemporaryDirectory(
    "tab-reaper-safari-release-",
  );
  const payloadDirectory = path.join(workspace, "artifact", "payload");
  const stagingDirectory = path.join(workspace, "staging");

  await buildMacosPayload({ payloadDirectory, stagingDirectory });

  expectNoReleaseDiagnostics(await readJavaScript(payloadDirectory));
});
