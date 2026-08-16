import fs from "node:fs";

type PackageManifest = {
  version: string;
};

type PackageLock = {
  packages: Record<string, { version?: string }>;
};

function readJson<T>(path: string): T {
  return JSON.parse(fs.readFileSync(path, "utf8")) as T;
}

function writeJson<T>(path: string, update: (value: T) => void): void {
  const value = readJson<T>(path);
  update(value);
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const rootPackage = readJson<PackageManifest>("package.json");
const version = rootPackage.version;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid release version: ${version}`);
}

const tauriPath = "apps/typodown-app/src-tauri/tauri.conf.json";
const tauri = fs.readFileSync(tauriPath, "utf8");
const tauriVersionPattern = /^(  "version": ")[^"]+(",)$/m;
if (!tauriVersionPattern.test(tauri)) {
  throw new Error(`${tauriPath} has no top-level version`);
}
fs.writeFileSync(tauriPath, tauri.replace(tauriVersionPattern, `$1${version}$2`));

const cargoPath = "apps/typodown-app/src-tauri/Cargo.toml";
const cargo = fs.readFileSync(cargoPath, "utf8");
const packageStart = cargo.indexOf("[package]");
if (packageStart < 0) throw new Error(`${cargoPath} has no [package] section`);
const packageEnd = cargo.indexOf("\n[", packageStart + 1);
const end = packageEnd < 0 ? cargo.length : packageEnd;
const packageSection = cargo.slice(packageStart, end);
const updatedPackageSection = packageSection.replace(
  /^version\s*=\s*"[^"]+"$/m,
  `version = "${version}"`,
);
if (
  updatedPackageSection === packageSection &&
  !packageSection.includes(`version = "${version}"`)
) {
  throw new Error(`${cargoPath} has no package version`);
}
fs.writeFileSync(
  cargoPath,
  `${cargo.slice(0, packageStart)}${updatedPackageSection}${cargo.slice(end)}`,
);

const cargoLockPath = "apps/typodown-app/src-tauri/Cargo.lock";
const cargoLock = fs.readFileSync(cargoLockPath, "utf8");
const cargoLockPattern = /(\[\[package\]\]\nname = "typodown-app"\nversion = ")[^"]+("\n)/;
if (!cargoLockPattern.test(cargoLock)) {
  throw new Error(`${cargoLockPath} has no typodown-app package entry`);
}
fs.writeFileSync(cargoLockPath, cargoLock.replace(cargoLockPattern, `$1${version}$2`));

writeJson<PackageLock>("package-lock.json", (lock) => {
  for (const path of [
    "apps/typodown-app",
    "apps/typodown-pwa",
    "apps/typodown-vsx",
    "packages/typodown",
  ]) {
    if (!lock.packages[path]) continue;
    const workspacePackage = readJson<PackageManifest>(`${path}/package.json`);
    lock.packages[path].version = workspacePackage.version;
  }
});

console.log(`Synchronized app metadata at ${version}`);
