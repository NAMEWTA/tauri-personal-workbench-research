import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { sidecarBinaryName } from "./sidecar-target.mjs";

const root = resolve(import.meta.dirname, "..");
const appVersion = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;
const binariesDirectory = join(
  root,
  "apps",
  "desktop",
  "src-tauri",
  "binaries",
);
const binaryName = sidecarBinaryName();
if (!readdirSync(binariesDirectory).includes(binaryName)) {
  throw new Error(
    `Expected ${binaryName}; run pnpm build:sidecar for the current target`,
  );
}
if (!binaryName) {
  throw new Error(
    "workbenchd sidecar is missing; run pnpm build:sidecar first",
  );
}

const workspace = mkdtempSync(
  join(tmpdir(), "personal-workbench-sidecar-smoke-"),
);
const token = randomBytes(32).toString("base64url");
const origin = "http://127.0.0.1:1420";
let activeHandle;

const waitForExit = (child) =>
  new Promise((resolveExit) => {
    if (child.exitCode !== null) {
      resolveExit(child.exitCode);
      return;
    }
    child.once("exit", (code) => resolveExit(code));
  });

const bootstrap = () =>
  `${JSON.stringify({
    protocolVersion: 3,
    parentPid: process.pid,
    token,
    workspacePath: workspace,
    workspaceName: "sidecar smoke",
    appVersion,
    allowedOrigins: [origin],
  })}\n`;

async function startSidecar() {
  const child = spawn(join(binariesDirectory, binaryName), [], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.stdin.end(bootstrap());
  try {
    const ready = await new Promise((resolveReady, rejectReady) => {
      let settled = false;
      const reject = (error) => {
        if (settled) return;
        settled = true;
        rejectReady(error);
      };
      child.once("error", (error) =>
        reject(new Error(`Failed to start workbenchd: ${error.message}`)),
      );
      child.once("exit", (code) =>
        reject(new Error(`workbenchd exited before ready with code ${code}`)),
      );
      lines.once("line", (line) => {
        try {
          const parsed = JSON.parse(line);
          if (
            parsed.type !== "ready" ||
            parsed.protocolVersion !== 3 ||
            !Number.isInteger(parsed.port) ||
            !/^http:\/\/127\.0\.0\.1:\d+$/.test(parsed.origin)
          ) {
            throw new Error(
              "sidecar ready message is invalid or not loopback-only",
            );
          }
          settled = true;
          resolveReady(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });
    const handle = { child, lines, backendUrl: ready.origin };
    activeHandle = handle;
    return handle;
  } catch (error) {
    lines.close();
    child.kill();
    child.stdin.destroy();
    throw error;
  }
}

async function stopSidecar(handle) {
  if (!handle) return;
  if (handle.backendUrl) {
    try {
      await fetch(`${handle.backendUrl}/internal/shutdown`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      // The process may already have exited after the request.
    }
  }
  if (handle.child.exitCode === null) {
    await Promise.race([
      waitForExit(handle.child),
      new Promise((resolveExit) => setTimeout(resolveExit, 5_000)),
    ]);
  }
  if (handle.child.exitCode === null) handle.child.kill();
  handle.lines.close();
  handle.child.stdin.destroy();
  handle.child.stdout.destroy();
  handle.child.stderr.destroy();
  if (activeHandle === handle) activeHandle = undefined;
}

async function main() {
  const headers = {
    Authorization: `Bearer ${token}`,
    Origin: origin,
  };
  const first = await startSidecar();
  const meta = await fetch(`${first.backendUrl}/api/v3/meta`, { headers });
  if (!meta.ok) throw new Error(`meta request failed with ${meta.status}`);
  const preferences = await fetch(`${first.backendUrl}/api/v3/preferences`, {
    headers,
  });
  if (!preferences.ok) {
    throw new Error(`preferences request failed with ${preferences.status}`);
  }
  const update = await fetch(`${first.backendUrl}/api/v3/preferences`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ theme: "light" }),
  });
  if (!update.ok)
    throw new Error(`preferences update failed with ${update.status}`);
  if (!existsSync(join(workspace, "workbench.sqlite3"))) {
    throw new Error("workspace SQLite database was not created");
  }
  const archiveResponse = await fetch(`${first.backendUrl}/api/v3/archive-records`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      collectionId: "template",
      title: "sidecar restart archive",
    }),
  });
  if (!archiveResponse.ok) {
    throw new Error(`archive create failed with ${archiveResponse.status}`);
  }
  const archive = await archiveResponse.json();
  const taskResponse = await fetch(`${first.backendUrl}/api/v3/tasks`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "sidecar restart task",
      status: "todo",
      priority: "normal",
      recordId: archive.id,
    }),
  });
  if (!taskResponse.ok) {
    throw new Error(`task create failed with ${taskResponse.status}`);
  }
  await stopSidecar(first);

  const restarted = await startSidecar();
  const restored = await fetch(`${restarted.backendUrl}/api/v3/preferences`, {
    headers,
  });
  if (!restored.ok) {
    throw new Error(`preferences restart read failed with ${restored.status}`);
  }
  const restoredPreferences = await restored.json();
  if (restoredPreferences.theme !== "light") {
    throw new Error(
      `preferences did not persist across restart: ${JSON.stringify(restoredPreferences)}`,
    );
  }
  const restoredArchives = await fetch(
    `${restarted.backendUrl}/api/v3/archive-records?q=${encodeURIComponent("sidecar restart archive")}`,
    { headers },
  );
  if (!restoredArchives.ok) {
    throw new Error(
      `archive restart read failed with ${restoredArchives.status}`,
    );
  }
  const restoredArchiveRecordPage = await restoredArchives.json();
  if (
    restoredArchiveRecordPage.total !== 1 ||
    restoredArchiveRecordPage.items?.[0]?.title !== "sidecar restart archive"
  ) {
    throw new Error(
      `archive did not persist across restart: ${JSON.stringify(restoredArchiveRecordPage)}`,
    );
  }
  const restoredTasks = await fetch(
    `${restarted.backendUrl}/api/v3/tasks?view=all`,
    { headers },
  );
  if (!restoredTasks.ok) {
    throw new Error(`task restart read failed with ${restoredTasks.status}`);
  }
  const restoredTaskItems = await restoredTasks.json();
  if (
    !restoredTaskItems.some((item) => item.title === "sidecar restart task")
  ) {
    throw new Error(
      `task did not persist across restart: ${JSON.stringify(restoredTaskItems)}`,
    );
  }
  await stopSidecar(restarted);
  console.log(
    `Sidecar lifecycle and restart persistence passed: ${binaryName}`,
  );
}

try {
  await main();
  rmSync(workspace, { recursive: true, force: true });
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await stopSidecar(activeHandle);
  rmSync(workspace, { recursive: true, force: true });
  process.exitCode = 1;
}
