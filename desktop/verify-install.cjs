#!/usr/bin/env node
// CI install gate: the Electron binary must exist (postinstall ran with checksum
// verification) and each patched helper must be what its consumer actually loads.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = __dirname;
const pkg = require("./package.json");
const failures = [];
const versionFrom = (consumer, dep) => {
  const base = consumer ? path.dirname(require.resolve(`${consumer}/package.json`, { paths: [root] })) : root;
  return require(require.resolve(`${dep}/package.json`, { paths: [base] })).version;
};
const major = v => Number(String(v).split(".")[0]);
const expect = (label, actual, ok) => { console.log(`${label}: ${actual}`); if (!ok) failures.push(`${label} is ${actual}`); };

const electronVersion = versionFrom(null, "electron");
expect("electron package", electronVersion, electronVersion === pkg.devDependencies.electron);
const binary = require("electron"); // path written by electron's verified postinstall
if (!binary || !fs.existsSync(binary)) failures.push(`Electron binary missing: ${binary}`);
else {
  const reported = execFileSync(binary, ["--version"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }).toString().trim();
  expect("electron binary", reported, reported === `v${electronVersion}`);
}

const uuid = versionFrom("node-taglib-sharp", "uuid");
expect("node-taglib-sharp -> uuid", uuid, major(uuid) >= 11);
for (const consumer of ["app-builder-lib", "@electron/universal"]) {
  const v = versionFrom(consumer, "minimatch");
  expect(`${consumer} -> minimatch`, v, major(v) >= 11);
}
for (const [dep, want] of [["electron-updater", pkg.dependencies["electron-updater"]], ["builder-util-runtime", pkg.dependencies["builder-util-runtime"]]]) {
  expect(dep, versionFrom(null, dep), versionFrom(null, dep) === want);
}
expect("electron-updater -> builder-util-runtime", versionFrom("electron-updater", "builder-util-runtime"), versionFrom("electron-updater", "builder-util-runtime") === pkg.dependencies["builder-util-runtime"]);

if (failures.length) { console.error("Desktop install verification failed:\n- " + failures.join("\n- ")); process.exit(1); }
console.log("Desktop install verified.");
