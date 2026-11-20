import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = fs.existsSync(path.join(base, '../source/src')) ? path.resolve(base, '../source') : path.resolve(base, '..');
const serverFiles = ['boundary.ts', 'db.ts', 'provider.ts'].map(p => path.join(base, 'src', p));
const result = await build({ entryPoints: [path.join(base, 'src/server.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: path.join(base, 'dist/server.mjs'), metafile: true, alias: { '@': path.join(upstream, 'src') }, packages: 'external', plugins: [{ name: 'independent-server', setup(b) {
  b.onResolve({ filter: /.*/ }, args => {
    if (args.path === '@tanstack/react-start' || args.path === '@/integrations/supabase/auth-middleware') return { path: serverFiles[0] };
    if (args.path === '@/integrations/supabase/client.server') return { path: serverFiles[1] };
    if (args.path.endsWith('ai-gateway.server')) return { path: serverFiles[2] };
    if (args.path.startsWith('@lovable')) throw Error('Lovable dependency reached independent backend.');
  });
  b.onLoad({ filter: /\.(ts|tsx)$/ }, async args => {
    if (!args.path.startsWith(path.join(upstream, 'src'))) return;
    const contents = (await fs.promises.readFile(args.path, 'utf8')).replaceAll('LOVABLE_API_KEY', 'GEMINI_API_KEY').replaceAll('https://dancefloor-builder.lovable.app', 'https://github.com/jnagan01/dancefloor-builder');
    return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) };
  });
} }] });
fs.writeFileSync(path.join(base, 'dist/input-modules.json'), JSON.stringify(Object.keys(result.metafile.inputs), null, 2));
console.log('Built independent test API from current shared generation code.');
