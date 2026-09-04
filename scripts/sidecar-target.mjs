import { execFileSync } from "node:child_process";

export function currentTargetTriple() {
  const configured = process.env.TAURI_ENV_TARGET_TRIPLE;
  if (configured) return configured;
  const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
    /^host: (.+)$/m,
  )?.[1];
  if (!host) throw new Error("Unable to determine Rust target triple");
  return host;
}

export function sidecarBinaryName() {
  const target = currentTargetTriple();
  return `workbenchd-${target}${target.includes("windows") ? ".exe" : ""}`;
}
