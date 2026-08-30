import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
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
console.log(`Versions aligned: ${packageVersion}`);
