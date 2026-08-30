import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const binariesDirectory = join(
  root,
  "apps",
  "desktop",
  "src-tauri",
  "binaries",
);
const suffix = process.platform === "win32" ? ".exe" : "";
const binaryName = readdirSync(binariesDirectory).find(
  (name) => name.startsWith("workbenchd-") && name.endsWith(suffix),
);

if (!binaryName)
  throw new Error(
    "workbenchd sidecar is missing; run pnpm build:sidecar first",
  );

const workspace = mkdtempSync(join(tmpdir(), "personal-workbench-e2e-"));
const stateDirectory = join(root, "apps", "desktop", "test-results");
const statePath = join(stateDirectory, ".e2e-server.json");
const token = randomBytes(32).toString("base64url");
const backend = spawn(join(binariesDirectory, binaryName), [], {
  cwd: root,
  stdio: ["pipe", "pipe", "inherit"],
});

backend.stdin.end(
  `${JSON.stringify({
    protocolVersion: 2,
    parentPid: process.pid,
    token,
    workspacePath: workspace,
    workspaceName: "E2E 临时工作区",
    appVersion: "0.2.0-e2e",
    allowedOrigins: ["http://127.0.0.1:1420"],
  })}\n`,
);

let vite;
let backendUrl;
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (backendUrl) {
    try {
      await fetch(`${backendUrl}/internal/shutdown`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      backend.kill();
    }
  } else {
    backend.kill();
  }
  vite?.kill();
  const deadline = Date.now() + 3_000;
  while (backend.exitCode === null && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  rmSync(workspace, { recursive: true, force: true });
  rmSync(statePath, { force: true });
  process.exit(exitCode);
}

process.once("SIGINT", () => void stop(130));
process.once("SIGTERM", () => void stop(143));

backend.once("error", (error) => {
  console.error(`Failed to start workbenchd: ${error.message}`);
  void stop(1);
});
backend.once("exit", (code) => {
  if (!stopping) {
    if (code !== 0) console.error(`workbenchd exited unexpectedly with code ${code}`);
    void stop(code ?? 1);
  }
});

const lines = createInterface({ input: backend.stdout });
lines.once("line", (line) => {
  let ready;
  try {
    ready = JSON.parse(line);
  } catch {
    console.error(`Invalid workbenchd ready message: ${line}`);
    void stop(1);
    return;
  }
  if (
    ready.type !== "ready" ||
    ready.protocolVersion !== 2 ||
    !Number.isInteger(ready.port)
  ) {
    console.error(`Unexpected workbenchd ready message: ${line}`);
    void stop(1);
    return;
  }
  backendUrl = `http://127.0.0.1:${ready.port}`;
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(statePath, JSON.stringify({ backendUrl, token, workspace }), {
    mode: 0o600,
  });
  vite = spawn(
    process.execPath,
    [
      join(root, "apps", "desktop", "node_modules", "vite", "bin", "vite.js"),
      "--host",
      "127.0.0.1",
    ],
    {
      cwd: join(root, "apps", "desktop"),
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_BACKEND_URL: backendUrl,
        VITE_BACKEND_TOKEN: token,
      },
    },
  );
  vite.once("error", (error) => {
    console.error(`Failed to start Vite: ${error.message}`);
    void stop(1);
  });
  vite.once("exit", (code) => {
    if (!stopping) void stop(code || 1);
  });
});
