import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const expectedNode = readFileSync(resolve(root, ".nvmrc"), "utf8").trim();
const expectedPnpm = "10.33.0";
const expectedGo = "1.26.7";
const expectedRust = "1.96.0";

const command = (file, args) =>
  execFileSync(file, args, { cwd: root, encoding: "utf8" }).trim();
const actualNode = process.version.slice(1);
const actualPnpm =
  process.platform === "win32"
    ? command("cmd.exe", ["/d", "/s", "/c", "pnpm --version"])
    : command("pnpm", ["--version"]);
const actualGo = /^go version go([^ ]+)/m.exec(command("go", ["version"]))?.[1];
const actualRust = /^rustc ([^ ]+)/m.exec(command("rustc", ["--version"]))?.[1];
const toolchainMismatches = [
  ["Node.js", actualNode, expectedNode],
  ["pnpm", actualPnpm, expectedPnpm],
  ["Go", actualGo, expectedGo],
  ["Rust", actualRust, expectedRust],
].filter(([, actual, expected]) => actual !== expected);
if (toolchainMismatches.length > 0) {
  const details = toolchainMismatches
    .map(
      ([name, actual, expected]) =>
        `${name}=${actual ?? "unavailable"} (expected ${expected})`,
    )
    .join(", ");
  throw new Error(`Toolchain mismatch: ${details}`);
}

const packageVersion = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).version;
const tauri = JSON.parse(
  readFileSync(resolve(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
).version;
const desktop = JSON.parse(
  readFileSync(resolve(root, "apps/desktop/package.json"), "utf8"),
).version;
const cargo = /^version = "([^"]+)"/m.exec(
  readFileSync(resolve(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8"),
)?.[1];
if (
  packageVersion !== desktop ||
  packageVersion !== tauri ||
  packageVersion !== cargo
)
  throw new Error(
    `Version mismatch: root=${packageVersion}, desktop=${desktop}, tauri=${tauri}, cargo=${cargo}`,
  );
const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith("v") && tag !== `v${packageVersion}`)
  throw new Error(`Tag ${tag} does not match v${packageVersion}`);
console.log(
  `Toolchain aligned: node=${actualNode}, pnpm=${actualPnpm}, go=${actualGo}, rust=${actualRust}`,
);
console.log(`Versions aligned: ${packageVersion}`);
