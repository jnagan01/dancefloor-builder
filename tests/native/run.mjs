import {build} from 'esbuild';import {_electron as electron,expect} from '@playwright/test';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'setarchitect-native-')),bundle=path.join(temp,'bundle');fs.mkdirSync(bundle);fs.writeFileSync(path.join(temp,'ISOLATED'),'synthetic only');
const stub=path.join(root,'tests/native/fixtures/services.tsx');
const names=['history.functions','recommend.functions','neighbors.functions','lastfm.functions','enrich.functions','spotify.functions','pageHead','appVersion','dirHandleStore','libraryStore'];
await build({entryPoints:[path.join(root,'tests/native/fixtures/entry.tsx')],bundle:true,platform:'browser',format:'esm',outfile:path.join(bundle,'app.js'),jsx:'automatic',alias:{'@':path.join(root,'src')},plugins:[{name:'isolated-services',setup(b){b.onResolve({filter:/.*/},args=>{if(names.some(n=>args.path===`@/lib/${n}`)||['react-start','react-router'].some(n=>args.path===`@tanstack/${n}`)||['@/hooks/useAuth','@/hooks/useDebounce','@/hooks/useProfileSettings','@/integrations/supabase/client','sonner','@/components/HistoryPanel','@/components/ProfileSettingsDialog','@/components/SpotifyExportDialog','@/components/workspace/WaveformPlayer','@/components/ui/sonner','./settings'].includes(args.path))return {path:stub};});}}]});
fs.writeFileSync(path.join(bundle,'index.html'),`<div id="root"></div><script type="module">window.__fixture=await window.testBackend.fixture();window.__errors=[];window.__warnings=[];window.__success=[];await import('/app.js');</script>`);
const library=path.join(temp,'library');fs.mkdirSync(library);const song={artist:'Test Artist',song:'Test Song - Live'};const tracks=[{filePath:path.join(library,'wrong.mp3'),artist:'Unrelated Artist',title:'Wrong Song',bpm:'190',key:'1A',playCount:100},{filePath:path.join(library,'correct.mp3'),artist:song.artist,title:song.song,bpm:'120',key:'8A',playCount:1},{filePath:path.join(library,'most.mp3'),artist:song.artist,title:song.song+' Remix',bpm:'125',key:'9A',playCount:20}];tracks.forEach(t=>fs.writeFileSync(t.filePath,'synthetic bytes, never played'));
const key='warmUp:0:test artist|test song live';
fs.writeFileSync(path.join(temp,'fixture.json'),JSON.stringify({tracks}));
fs.writeFileSync(path.join(temp,'backend.json'),JSON.stringify({A:{id:'A',name:'Test',updated_at:'2026-10-31T01:59:00Z',inputs:{eventName:'Test',songs:[song],hours:'0.25',buffer:2,listType:'dance',expand:false},lists:{warmUp:[song],transition:[],peak:[],selections:{[key]:{paths:[tracks[0].filePath],confirmed:false}}}}}));
let app,page,count=0;const diagnostics=path.join(root,'test-results/native');fs.mkdirSync(diagnostics,{recursive:true});
async function launch(){app=await electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist',process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':process.platform==='win32'?'electron.exe':'electron'),args:[path.join(root,'tests/native/fixtures/main.cjs'),'--no-sandbox'],env:{...process.env,SETARCHITECT_TEST_PROFILE:temp,SETARCHITECT_TEST_BUNDLE:bundle}});page=await app.firstWindow();page.on('pageerror',e=>console.error('PAGE',e.message));await page.waitForSelector('[role="status"]');await page.waitForTimeout(800);}
async function check(name,f){await f();count++;await page.screenshot({path:path.join(diagnostics,`check-${count}.png`)});console.log(`PASS ${name}`);}
try{
 await launch();
 await check('wrong-song omitted; reference ZIP artifact inspected',async()=>{await page.getByRole('button',{name:'Export All Files as ZIP',exact:false}).first().click();await page.waitForTimeout(400);const paths=await page.evaluate(()=>({errors:window.__errors}));expect(paths.errors).toEqual([]);const archive=(await import('jszip')).default;const zipFile=fs.readdirSync(path.join(temp,'exports')).find(n=>n.endsWith('.zip'));expect(zipFile).toBeTruthy();const zip=await archive.loadAsync(fs.readFileSync(path.join(temp,'exports',zipFile)));const dj=Object.values(zip.files).filter(f=>f.name.endsWith('.m3u'));for(const f of dj)expect(await f.async('string')).not.toContain(tracks[0].filePath);expect(Object.keys(zip.files).some(n=>n.endsWith('readiness.txt'))).toBe(true);const txt=Object.values(zip.files).find(f=>f.name.endsWith('.txt')&&!f.name.endsWith('readiness.txt'));expect(await txt.async('string')).toContain(song.song);});
 await check('explicit bulk most selects relevant recording, never unrelated most-played',async()=>{await page.getByRole('button',{name:'Select most played',exact:true}).first().click();await page.waitForTimeout(2200);const rows=JSON.parse(fs.readFileSync(path.join(temp,'backend.json'),'utf8'));const selection=Object.values(rows.A.lists.selections)[0];expect(selection.confirmed).toBe(true);expect(selection.paths).toContain(tracks[2].filePath);expect(selection.paths).not.toContain(tracks[0].filePath);});
 await check('direct exported artifacts and readiness report',async()=>{await page.getByRole('button',{name:'Export All to VirtualDJ',exact:false}).first().click();await page.waitForTimeout(500);const names=fs.readdirSync(path.join(temp,'exports'));const m3u=names.filter(n=>n.endsWith('.m3u')).map(n=>fs.readFileSync(path.join(temp,'exports',n),'utf8')).join('');expect(m3u).toContain(tracks[2].filePath);expect(m3u).not.toContain(tracks[0].filePath);expect(names.some(n=>n.endsWith('readiness.txt'))).toBe(true);});
 await check('approval reload and quarter-hour 2x targets',async()=>{await page.reload();await page.waitForTimeout(600);expect(await page.getByText('Target 12 songs',{exact:false}).count()).toBeGreaterThan(0);});
 await check('offline real Electron storage survives process restart and reconnect',async()=>{fs.writeFileSync(path.join(temp,'fault'),'offline');await page.getByRole('button',{name:'Dance floor',exact:false}).first().click();await page.getByPlaceholder('e.g. Smith Johnson Wedding').fill('Offline retained');await page.waitForTimeout(1200);expect(await page.getByText('Event not saved',{exact:false}).count()).toBeGreaterThan(0);await page.waitForTimeout(500);process.kill(app.process().pid,'SIGKILL');await new Promise(resolve=>setTimeout(resolve,800));fs.unlinkSync(path.join(temp,'fault'));await launch();expect(await page.getByText('Unsaved recovery copy',{exact:false}).count()).toBeGreaterThan(0);await page.getByRole('button',{name:'Restore recovery copy',exact:true}).click();await page.waitForTimeout(2200);expect(JSON.parse(fs.readFileSync(path.join(temp,'backend.json'),'utf8')).A.inputs.eventName).toBe('Offline retained');expect(Object.keys(JSON.parse(fs.readFileSync(path.join(temp,'backend.json'),'utf8')))).toEqual(['A']);});
 await check('disk-full backup refusal, last good preserved',async()=>{const b={format:'setarchitect-backup',version:1,account:'synthetic-owner',createdAt:new Date().toISOString(),events:[],sources:[],roots:{}};expect((await page.evaluate(b=>window.electronBackups.save(JSON.stringify(b),b.account),b)).ok).toBe(true);const last=await page.evaluate(async()=> (await window.electronBackups.latest('synthetic-owner')).raw);fs.writeFileSync(path.join(temp,'fault'),'ENOSPC');expect((await page.evaluate(b=>window.electronBackups.save(JSON.stringify(b),b.account),b)).ok).toBe(false);expect(await page.evaluate(async()=> (await window.electronBackups.latest('synthetic-owner')).raw)).toBe(last);fs.unlinkSync(path.join(temp,'fault'));});
 await check('write-denied export never reports success',async()=>{fs.writeFileSync(path.join(temp,'fault'),'EACCES');const before=await page.evaluate(()=>window.__success.length);await page.getByRole('button',{name:'Export All to VirtualDJ',exact:false}).first().click();await page.waitForTimeout(400);expect(await page.evaluate(()=>window.__success.length)).toBe(before);expect(await page.evaluate(()=>window.__errors.some(e=>e.includes('could not be written')))).toBe(true);fs.unlinkSync(path.join(temp,'fault'));});

 await check('partial native export reports exact batch failures and never success',async()=>{
   fs.writeFileSync(path.join(temp,'fault'),'PARTIAL'); const before=await page.evaluate(()=>window.__success.length);
   await page.getByRole('button',{name:'Export All to VirtualDJ',exact:false}).first().click();await page.waitForTimeout(500);
   expect(await page.evaluate(()=>window.__success.length)).toBe(before);
   expect(await page.evaluate(()=>window.__errors.at(-1))).toMatch(/^Saved 1, failed 1/);
   fs.unlinkSync(path.join(temp,'fault'));
 });
 await check('late-save navigation away/back reconciles exact recovery',async()=>{
   fs.writeFileSync(path.join(temp,'fault'),'late');await page.getByRole('button',{name:'Dance floor',exact:false}).first().click();
   await page.getByPlaceholder('e.g. Smith Johnson Wedding').fill('Late native save');await page.waitForTimeout(1100);
   expect(JSON.parse(fs.readFileSync(path.join(temp,'backend.json'),'utf8')).A.inputs.eventName).toBe('Late native save');
   await page.evaluate(()=>{window.__testState.page='backups';window.__rerender();});await page.waitForTimeout(2100);
   await page.evaluate(()=>{window.__testState.page='event';window.__testState.eventId='A';window.__rerender();});await page.waitForTimeout(800);
   expect(await page.getByText('Unsaved recovery copy',{exact:false}).count()).toBe(0);
   expect(await page.getByText('Event saved automatically',{exact:false}).count()).toBe(1);fs.unlinkSync(path.join(temp,'fault'));
 });
 await check('production backup UI previews single-event restore and preserves additive conflicts',async()=>{
   await page.evaluate(()=>{window.__testState.page='backups';window.__rerender();});await page.getByRole('button',{name:'Back up now',exact:true}).click();
   await page.waitForTimeout(500);expect(await page.getByRole('combobox',{name:'Event to restore'}).count()).toBe(1);
   const raw=await page.evaluate(async()=> (await window.electronBackups.latest('synthetic-owner')).raw); const b=JSON.parse(raw);
   const original=JSON.parse(fs.readFileSync(path.join(temp,'library-index.json'),'utf8'));
   b.sources[0].tracks[0].title='Conflicting title';b.sources.push({label:'Added source',tracks:[{filePath:'Added source/new.mp3',artist:'Added',title:'New'}]});
   b.roots['Added source']=path.join(library,'added');
   const imported=path.join(temp,'import-backup.json');fs.writeFileSync(imported,JSON.stringify(b));
   await page.locator('input[type=file]').setInputFiles(imported);await page.waitForTimeout(300);
   expect(await page.getByText('Library restore: 1 new sources · 1 conflicts left unchanged',{exact:false}).count()).toBe(1);
   await page.getByRole('button',{name:'Add non-conflicting metadata sources',exact:true}).click();await page.waitForTimeout(500);
   const restored=JSON.parse(fs.readFileSync(path.join(temp,'library-index.json'),'utf8'));
   expect(restored[0]).toEqual(original[0]);expect(restored.at(-1).label).toBe('Added source');
   await page.getByRole('button',{name:'Restore selected event as new',exact:true}).click();await page.waitForTimeout(500);
   await page.getByRole('button',{name:'Restore recovery copy',exact:true}).click();await page.waitForTimeout(2200);
   const rows=JSON.parse(fs.readFileSync(path.join(temp,'backend.json'),'utf8'));expect(Object.keys(rows)).toHaveLength(2);
   expect(rows.A.inputs.eventName).toBe('Late native save');const newId=Object.keys(rows).find(id=>id!=='A');expect(rows[newId].lists.warmUp).toEqual(b.events[0].snapshot.lists.warmUp);
 });
 await check('update handoff captures fresh production workspace state and aborts on backup rename failure',async()=>{
   await page.evaluate(()=>{window.__testState.page='backups';window.__rerender();});await page.waitForTimeout(300);
   const prior=await page.evaluate(async()=>JSON.parse((await window.electronBackups.latest('synthetic-owner')).raw));
   await new Promise(resolve=>setTimeout(resolve,20));const outcome=await page.evaluate(()=>window.testBackend.update());expect(outcome.ok).toBe(true);
   const fresh=await page.evaluate(async()=>JSON.parse((await window.electronBackups.latest('synthetic-owner')).raw));
   expect(Date.parse(fresh.createdAt)).toBeGreaterThan(Date.parse(prior.createdAt));expect(fresh.sources.some(source=>source.label==='Added source')).toBe(true);expect(fresh.events).toHaveLength(2);
   fs.unlinkSync(path.join(temp,'handoff'));fs.writeFileSync(path.join(temp,'fault'),'RENAME_EACCES');
   expect((await page.evaluate(()=>window.testBackend.update())).ok).toBe(false);expect(fs.existsSync(path.join(temp,'handoff'))).toBe(false);
   const after=await page.evaluate(async()=> (await window.electronBackups.latest('synthetic-owner')).raw);expect(after).toBe(JSON.stringify(fresh));fs.unlinkSync(path.join(temp,'fault'));
 });
 await check('Electron six-row upload blocks missing title then corrects and generates all intended rows',async()=>{
   await page.evaluate(()=>{window.__testState.page='event';window.__testState.eventId=undefined;window.__rerender();});await page.waitForTimeout(400);
   await page.getByRole('button',{name:'Upload lists',exact:false}).first().click();
   const upload=path.join(temp,'six.csv');fs.writeFileSync(upload,'Artist,Song\nOne,Song One\nTwo,Song Two\nThree,Song Three\nFour,Song Four\nFive,Song Five\nArtist Only,\n');
   await page.locator('input[type=file][accept=".csv,.txt"]').setInputFiles(upload);await page.waitForTimeout(400);
   await page.getByRole('button',{name:'Review songs',exact:false}).first().click();
   const rows=page.locator('tbody tr');expect(await rows.count()).toBe(6);
   await page.getByRole('button',{name:'Continue',exact:false}).click();await page.getByRole('button',{name:/Generate|Regenerate/}).first().click();await page.waitForTimeout(300);
   expect(await page.evaluate(()=>window.__errors.at(-1))).toContain('missing a song title');expect(await rows.count()).toBe(6);
   await rows.nth(5).locator('input').nth(1).fill('Corrected Song');await page.getByRole('button',{name:'Continue',exact:false}).click();
   await page.getByRole('button',{name:/Generate|Regenerate/}).first().click();await page.waitForTimeout(1800);
   expect(await page.getByRole('button',{name:'Export All Files as ZIP',exact:false}).count()).toBe(1);
   await page.getByRole('button',{name:'Export All Files as ZIP',exact:false}).click();await page.waitForTimeout(700);
   const zipName=fs.readdirSync(path.join(temp,'exports')).filter(n=>n.endsWith('.zip')).sort((a,b)=>fs.statSync(path.join(temp,'exports',b)).mtimeMs-fs.statSync(path.join(temp,'exports',a)).mtimeMs)[0];
   const zip=await (await import('jszip')).default.loadAsync(fs.readFileSync(path.join(temp,'exports',zipName)));
   const text=(await Promise.all(Object.values(zip.files).filter(f=>f.name.endsWith('.csv')).map(f=>f.async('string')))).join('\n');
   for(const title of ['Song One','Song Two','Song Three','Song Four','Song Five','Corrected Song'])expect(text).toContain(title);
 });
 console.log(`Native checks: ${count} passed. Isolated profile: ${temp}`);fs.writeFileSync(path.join(diagnostics,'results.json'),JSON.stringify({passed:count,profile:'separate synthetic temp directory',realDataAccess:false},null,2));
}catch(e){await page?.screenshot({path:path.join(diagnostics,'failure.png')}).catch(()=>{});throw e;}finally{await app?.close().catch(()=>{});}
