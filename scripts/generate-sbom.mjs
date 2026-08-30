import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).version;
const components = new Map();
const add = (type, name, version, purl) => {
  if (name && version) components.set(purl, { type, name, version, purl });
};

const lock = parse(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"));
for (const key of Object.keys(lock.packages ?? {})) {
  const match = /^(.+)@([^(@]+)(?:\(|$)/.exec(key);
  if (match)
    add(
      "library",
      match[1],
      match[2],
      `pkg:npm/${encodeURIComponent(match[1])}@${match[2]}`,
    );
}

const goExe =
  process.env.GO_EXE ||
  (process.platform === "win32" ? "C:\\Program Files\\Go\\bin\\go.exe" : "go");
const goModules = execFileSync(goExe, ["list", "-m", "-json", "all"], {
  cwd: resolve(root, "services", "workbenchd"),
  encoding: "utf8",
});
for (const block of goModules.trim().split(/\n}\s*\n{/)) {
  const normalized = `${block.startsWith("{") ? "" : "{"}${block}${block.endsWith("}") ? "" : "}"}`;
  const module = JSON.parse(normalized);
  if (module.Path && module.Version)
    add(
      "library",
      module.Path,
      module.Version,
      `pkg:golang/${module.Path}@${module.Version}`,
    );
}

const cargo = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ),
);
for (const crate of cargo.packages)
  add(
    "library",
    crate.name,
    crate.version,
    `pkg:cargo/${crate.name}@${crate.version}`,
  );

const document = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: "application", name: "personal-workbench", version },
  },
  components: [...components.values()].sort((a, b) =>
    a.purl.localeCompare(b.purl),
  ),
};
mkdirSync(resolve(root, "artifacts"), { recursive: true });
writeFileSync(
  resolve(root, "artifacts", "sbom.cdx.json"),
  `${JSON.stringify(document, null, 2)}\n`,
);
console.log(
  `Wrote CycloneDX SBOM with ${document.components.length} components`,
);
