import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).version;
const go = process.env.GO_EXE || "go";
const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  (process.platform === "win32"
    ? "x86_64-pc-windows-msvc"
    : execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
        /^host: (.+)$/m,
      )?.[1]);
if (!target) throw new Error("Unable to determine Rust target triple");
const goTargets = {
  "x86_64-pc-windows-msvc": { os: "windows", arch: "amd64" },
  "aarch64-pc-windows-msvc": { os: "windows", arch: "arm64" },
  "x86_64-apple-darwin": { os: "darwin", arch: "amd64" },
  "aarch64-apple-darwin": { os: "darwin", arch: "arm64" },
};
const goTarget = goTargets[target];
if (!goTarget) throw new Error(`Unsupported sidecar target: ${target}`);
const outputDirectory = join(root, "apps", "desktop", "src-tauri", "binaries");
const extension = target.includes("windows") ? ".exe" : "";
const output = join(outputDirectory, `workbenchd-${target}${extension}`);
mkdirSync(outputDirectory, { recursive: true });
rmSync(output, { force: true });
execFileSync(
  go,
  [
    "build",
    "-trimpath",
    "-ldflags",
    `-s -w -X main.version=${version}`,
    "-o",
    output,
    "./cmd/workbenchd",
  ],
  {
    cwd: join(root, "services", "workbenchd"),
    stdio: "inherit",
    env: {
      ...process.env,
      CGO_ENABLED: "0",
      GOOS: goTarget.os,
      GOARCH: goTarget.arch,
    },
  },
);
const hostArch = process.arch === "x64" ? "amd64" : process.arch;
const hostOS = process.platform === "win32" ? "windows" : process.platform;
if (hostOS === goTarget.os && hostArch === goTarget.arch) {
  execFileSync(output, ["--version"], { stdio: "inherit" });
} else {
  console.log(`Skipped executing cross-compiled ${goTarget.os}/${goTarget.arch} sidecar`);
}
console.log(`Built ${output}`);
