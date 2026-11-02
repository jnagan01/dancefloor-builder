// Usage: node scripts/check-build-identity.mjs [distDir]
// Fails unless the client and server bundles carry exactly one, identical build id.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? "dist";
const re = /20\d\d-\d\d-\d\dT[\d:.]+Z\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
function ids(dir) {
  const found = new Set();
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|html)$/.test(n)) for (const m of readFileSync(p, "utf8").match(re) ?? []) found.add(m);
    }
  };
  walk(dir);
  return [...found];
}
const client = ids(join(dist, "client"));
const server = ids(join(dist, "server"));
console.log({ client, server });
if (client.length !== 1 || server.length !== 1 || client[0] !== server[0]) {
  console.error("Build identity mismatch between client and server bundles");
  process.exit(1);
}
console.log("Build identity coherent:", client[0]);
