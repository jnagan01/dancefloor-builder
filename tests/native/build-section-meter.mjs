import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import fs from 'node:fs';import path from 'node:path';
const root=process.cwd(),dest='/tmp/browser/section-meters';fs.mkdirSync(dest,{recursive:true});
// Build actual event fixture with the existing service-denial aliases, not production services.
let captured;
const source=fs.readFileSync('tests/native/run.mjs','utf8'),start=source.indexOf('const stub'),end=source.indexOf('const css',start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
await new AsyncFunction('root','path','bundle','build',source.slice(start,end))(root,path,dest,async options=>{captured=options;});
await build({...captured,outfile:path.join(dest,'route.js')});
await build({entryPoints:['tests/native/fixtures/section-meter-entry.tsx'],bundle:true,platform:'browser',format:'esm',outfile:path.join(dest,'meter.js'),jsx:'automatic',alias:{'@':path.join(root,'src')}});
const css=await compile(fs.readFileSync('src/styles.css','utf8'),{base:path.join(root,'src'),onDependency:()=>{}});
fs.writeFileSync(path.join(dest,'app.css'),css.build(new Scanner({sources:[{base:root,pattern:'{src,tests/native/fixtures}/**/*.{tsx,ts}',negated:false}]}).scan()));
fs.writeFileSync(path.join(dest,'index.html'),'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/meter.js"></script>');
console.log('Synthetic rendered fixtures built; no production services bundled.');