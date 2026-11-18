import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root || !fs.existsSync(root)) throw new Error('Production client artifact unavailable');
const forbidden = ['BETTER_STACK_SOURCE_TOKEN', 'BETTER_STACK_INGESTING_HOST', 'SYNTHETIC CONNECTION CHECK — no user data'];
for (const name of forbidden.slice(0, 2)) {
  const value = process.env[name];
  if (value) forbidden.push(value);
}
let inspected = 0;
function inspect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (/\.(?:js|mjs|html|json|map)$/.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8'); inspected++;
      if (forbidden.some(value => text.includes(value))) throw new Error('Server diagnostic content found in client artifact');
    }
  }
}
inspect(root);
if (!inspected) throw new Error('No client artifacts inspected');
console.log(`Production diagnostic client isolation passed (${inspected} files)`);