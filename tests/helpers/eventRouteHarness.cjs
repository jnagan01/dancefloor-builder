const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'node_modules/typescript'));
function createEventRouteHarness(actual) {
  let source = fs.readFileSync(path.join(root, 'src/routes/_authenticated/events.new.tsx'), 'utf8');
  // Expose actual closures in the test VM only; no production test seam or replacement logic.
  source = source.replace('  const withFileBpm =', '  capture({ applyReviewMode, updateMatch, toggleExclude, pickLocalFileForMatch, withAnalysis: (sec, songs) => withFileBpm(sec, songs), songs, result, matches, savedEventId, saveState, stableCreate: stableCreate.current, restoreRecovery, clearWorkflowState, generate, setSongs, setEventName, setResult, userEdited, autosave, computeLiveTargets, liveTargets, eventSnapshot, recovery, dismissRecovery, handleFiles, setVdjDirHandle, exportAllZip, exportAllToVdj, exportSectionM3u, exportSectionXmlToVdj, previewReadiness, readiness, activeSection, persistOnExit, snapshotReadOnly, draftBlocked });\n  const withFileBpm =');
  source += '\nexport { SectionView };';
    const readiness = require(path.join(root, "node_modules/typescript"));
  const readinessModule = { exports: {} };
  const identityModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, "src/lib/fileIdentity.ts"), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {module:identityModule,exports:identityModule.exports});
  const additionModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, "src/lib/additionIdentity.ts"), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {module:additionModule,exports:additionModule.exports});
  const duplicateModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, "src/lib/preparationDuplicates.ts"), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {module:duplicateModule,exports:duplicateModule.exports,require:k=>k === "./fileIdentity" ? identityModule.exports : k === "./additionIdentity" ? additionModule.exports : require(path.join(root,"desktop/offline/policy.cjs"))});
  vm.runInNewContext(readiness.transpileModule(fs.readFileSync(path.join(root, "src/lib/exportReadiness.ts"), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {module:readinessModule,exports:readinessModule.exports,require:k=>k === "./preparationPolicy" ? require(path.join(root,"desktop/offline/policy.cjs")) : k === "./fileIdentity" ? identityModule.exports : actual.vdj});
  // Real preparation-knowledge modules (no test seams): transpiled with relative requires resolved inside src/lib/prep.
  const prepModules = {};
  let songLibMod; const songLibraryForPrep = () => { if (!songLibMod) { songLibMod = { exports: {} }; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/songLibrary.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:songLibMod,exports:songLibMod.exports,require}); } return songLibMod.exports; };
  const loadPrep = name => {
    if (prepModules[name]) return prepModules[name].exports;
    const m = { exports: {} }; prepModules[name] = m;
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, `src/lib/prep/${name}.ts`), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {module:m,exports:m.exports,setTimeout,clearTimeout,require:k=>k === '../additionIdentity' ? additionModule.exports : k === '../songLibrary' ? songLibraryForPrep() : k.startsWith('./') ? loadPrep(k.slice(2)) : k === '@/lib/virtualDj' ? actual.vdj : k === '@/lib/fileIdentity' ? identityModule.exports : require(k)});
    return m.exports;
  };
  // Real safe-save request contract (zod) so contract-checked harnesses run the server's own validation.
  const schemaModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/eventSchemas.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {module:schemaModule,exports:schemaModule.exports,require:k=>k === './inputSafety' ? actual.input : require(path.join(root,'node_modules',k))});
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  function harness({ account = 'owner', eventId = 'A', memory = new Map(), rows = {}, write = async r => ({ id: r.data.id, updatedAt: '2026-10-31T00:00:01Z' }), services = {}, contract = false, prep = null, prepStore: prepStoreOverride = null } = {}) {
    // Synthetic account-fenced preparation store state: { account, generation, status, knowledge }.
    let prepState = prep ?? { account, generation: 1, status: 'ready', knowledge: loadPrep('knowledge').emptyKnowledge(), error: null };
    const prepListeners = new Set();
    // Synthetic fake by default; `prepStore` passes the REAL account-fenced store (synthetic backend) instead.
    const prepFake = prepStoreOverride ?? { get: () => prepState, subscribe: l => { prepListeners.add(l); return () => prepListeners.delete(l); },
      settled: async o => { if (prepState.account !== o.account || prepState.generation !== o.generation) throw Error('stale'); if (prepState.status !== 'ready') throw Error(prepState.error || 'not ready'); return prepState.knowledge; } };
    let slots = [], cursor = 0, queued = [], captured, activeKey, dirty = false, rootSlots = [], renderingRoot = false, tree;
    const loads = [], requests = [], errors = [], navigations = [], downloads = [], files = [], warnings = [], infos = []; let blocker;
    let workspace = { sources: [], library: null, audioIndex: actual.audio.buildAudioIndex([]), addFile: f => f.path || f.name };
    const storage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
    global.localStorage = storage;
    const same = (a,b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
    const react = {
      Fragment: 'fragment', useRef: value => { const i=cursor++; if (!(i in slots)) slots[i]={current:value}; return slots[i]; },
      useState: value => { const owner=slots, i=cursor++; if (!(i in owner)) owner[i]=typeof value === 'function' ? value() : value; return [owner[i], next => { owner[i]=typeof next==='function'?next(owner[i]):next; dirty=true; }]; },
      useMemo: f => f(), useTransition: () => [false, f=>f()],
      useEffect: (f,deps) => { const i=cursor++; const old=slots[i]; if (!same(old?.deps,deps)) { const owner=slots; queued.push(()=>{old?.cleanup?.(); owner[i]={deps,cleanup:f()};}); } },
    };
    const jsx = (type, props, key) => ({type,props,key});
    const no = () => undefined;
    const stub = new Proxy({}, {get: (_t,k) => k==='__esModule'?true: k==='supportsDirectoryWrite'?()=>false : k==='APP_VERSION'?'test': k==='KEY_OPTIONS'||k==='VIBES'||k==='EVENT_TYPES'?[] : no});
    const history = { getWorkflow: async r => { loads.push(r.data.id); return await rows[r.data.id]; }, saveWorkflowSafely: async r => { requests.push({account, ...r.data}); if (contract) schemaModule.exports.parseSafeSaveRequest(r.data); return write(r); } };
    const route = { useSearch: () => ({eventId:eventId ?? undefined}) };
    const navigate = async r => { navigations.push(r); eventId=r.search?.eventId; };
    const modules = {
      react, 'react/jsx-runtime': {jsx,jsxs:jsx}, '@tanstack/react-router': {createFileRoute:()=>opts=>({...route,...opts}),useNavigate:()=>navigate,useBlocker:opts=>{blocker=opts;}},
      '@tanstack/react-start': {useServerFn:f=>f}, '@/lib/history.functions':history,
      '@/hooks/useAuth': {useAuth:()=>({user:account?{id:account}:null})}, '@/hooks/useDebounce':{useDebounce:v=>v},
      '@/components/workspace/WorkspaceContext':{useWorkspace:()=>workspace},
      '@/integrations/supabase/client':{supabase:{auth:{getUser:async()=>({data:{user:null}})}}},
      sonner:{toast:{error:e=>errors.push(e),success:no,warning:e=>warnings.push(e),info:e=>infos.push(e)}},
      '@/lib/virtualDj':{...actual.vdj, supportsDirectoryWrite:()=>true, writeFileToDir:async(_dir,name,data)=>{files.push({name,data});}}, '@/lib/danceFloor':{...actual.dance,downloadBlob:(blob,name)=>downloads.push({blob,name})}, '@/lib/audioMatch':actual.audio,
      '@/lib/snapshotSafety':actual.snapshots, '@/lib/eventDrafts':actual.drafts, '@/lib/inputSafety':actual.input,
      '@/lib/eventAutosave':actual.autosave, '@/lib/vibes':actual.vibes, '@/lib/workflowIsolation':actual.isolation,
      '@/lib/eventRevision':actual.revisions, '@/lib/eventSchemas':schemaModule.exports,
      '@/lib/preparationPolicy':require(path.join(root,'desktop/offline/policy.cjs')), '@/lib/exportReadiness':readinessModule.exports, '@/lib/musicTheory':actual.theory, '@/lib/pageHead':{pageHead:no},
      '@/lib/preparationDuplicates':duplicateModule.exports, '@/lib/additionIdentity':additionModule.exports,
      '@/lib/freshEvent': (() => { const m={exports:{}}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/freshEvent.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:k=>k === './inputSafety' ? actual.input : k === './danceFloor' ? actual.dance : k === './fileIdentity' ? identityModule.exports : require(path.join(root,'desktop/offline/policy.cjs'))});return m.exports; })(),
      '@/lib/preparationCapability': (() => { const m={exports:{}}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/preparationCapability.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:()=>require(path.join(root,'desktop/offline/policy.cjs')),get window(){return testWindow;}});return m.exports; })(),
      '@/lib/selectionRestore': (() => { const m={exports:{}}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/selectionRestore.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:k=>k === '@/lib/danceFloor' ? actual.dance : k === '@/lib/fileIdentity' ? identityModule.exports : require(k)}); return m.exports; })(),
      '@/lib/dirHandleStore':{loadDirHandle:async()=>null,loadDirHandleMeta:async()=>null,verifyReadWrite:async()=>true},
      '@/lib/prep/community.functions':{COMMUNITY_BATCH:20,lookupCommunityBatch:services.community ?? (async r=>r.data.songs.map(x=>({...x,status:'disabled'})))},
      '@/lib/enrich.functions':{enrichSongs:services.enrich ?? (async()=>({results:[]}))},
      '@/lib/neighbors.functions':{getArtistNeighbors:services.neighbors ?? (async()=>({clusters:[]}))},
      '@/lib/recommend.functions':{recommendSongsForSection:services.recommend ?? (async()=>({suggestions:[]}))},
      '@/lib/lastfm.functions':{getArtistCrowdData:services.crowd ?? (async()=>({artists:[]})),getSimilarTracks:services.similarTracks ?? (async()=>({availability:'missingKey',seeds:[]}))},
      '@/lib/prep/prepStore':{prepStore:()=>prepFake},
      '@/lib/prep/expansionFeedback':loadPrep('expansionFeedback'), '@/lib/prep/similarTracks':loadPrep('similarTracks'), '@/lib/prep/knowledge':loadPrep('knowledge'), '@/lib/prep/provenance':loadPrep('provenance'), '@/lib/prep/metaConfidence':loadPrep('metaConfidence'), '@/lib/prep/recommend':loadPrep('recommend'), '@/lib/songLibrary':(()=>{const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/songLibrary.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require});return m.exports;})(), '@/lib/prep/expansionRanking':loadPrep('expansionRanking'), '@/lib/prep/eventFit':loadPrep('eventFit'), '@/lib/prep/factsGather':loadPrep('factsGather'), '@/lib/prep/requestFacts':loadPrep('requestFacts'), '@/lib/prep/candidatePool':loadPrep('candidatePool'),
      jszip:{default:class {file(name,data){files.push({name,data});return this;} async generateAsync(){return new Blob(['zip']);}}},
      '@/lib/desktopBridge':{getNativeFilePath:()=>null,isDesktopApp:()=>false},
    };
    const module={exports:{}};
    const testWindow={addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k),confirm:()=>true};
    const events=new Map();
    vm.runInNewContext(compiled,{module,exports:module.exports,require:k=>modules[k]??stub,capture:v=>{captured=v},console,crypto,structuredClone,File,Blob,AbortController,localStorage:storage,document:{getElementById:()=>null,querySelector:()=>null},window:testWindow,setTimeout,clearTimeout,Date});
    const cleanup=old=>{for(const slot of old)slot?.cleanup?.();};
    function render() {
      slots=rootSlots;cursor=0;renderingRoot=true;
      const child=module.exports.Route.component();rootSlots=slots;
      if(activeKey!==child.key){if(activeKey!==undefined)cleanup(editorSlots);editorSlots=[];activeKey=child.key;}
      slots=editorSlots;cursor=0;renderingRoot=false;tree=child.type(child.props);editorSlots=slots;
      const jobs=queued;queued=[];jobs.forEach(f=>f());dirty=false;return captured;
    }
    let editorSlots=[];
    async function flush(){for(let i=0;i<6;i++){render();await Promise.resolve();await Promise.resolve();}}
    function walk(value){if(!value)return [];if(Array.isArray(value))return value.flatMap(walk);if(typeof value!=='object')return [];return [value,...walk(value.props?.children)];}
    function nodes(){return walk(tree);}
    function interact(predicate,handler='onClick',argument){const node=nodes().find(predicate);if(!node)throw Error('No matching rendered control');tree.props?.onClickCapture?.({target:{closest:()=>({})}});node.props[handler]?.(argument);render();}
    function sectionClick(predicate){const child=nodes().find(n=>n.props?.onPreview&&n.props?.songs);if(!child)throw Error('No review section');const parentSlots=slots;slots=[];cursor=0;const sectionTree=module.exports.SectionView(child.props);const control=walk(sectionTree).find(predicate);if(!control)throw Error('No section control');tree.props?.onClickCapture?.({target:{closest:()=>({})}});control.props.onClick?.();slots=parentSlots;render();}
    return {testWindow,render,flush,memory,requests,loads,errors,navigations,downloads,files,warnings,infos,nodes,interact,sectionClick,chooseFresh(){interact(n=>n.props?.role==='radio'&&/^Dance floor$/i.test(n.props?.children));interact(n=>n.props?.id==='hours','onChange',{target:{value:'3'}});interact(n=>n.props?.steps&&n.props?.onSelect,'onSelect',4);interact(n=>n.props?.id==='buffer','onChange',{target:{value:'2'}});},leave(){return blocker?.shouldBlockFn();}, async invoke(prop){const n=nodes().find(n=>typeof n.props?.[prop]==='function');if(!n)throw Error(prop); await n.props[prop]();render();}, get tree(){return tree},get current(){return captured}, edit(name){interact(n=>n.props?.steps&&n.props?.onSelect,'onSelect',1);interact(n=>n.props?.id==='eventName','onChange',{target:{value:name}});},switchTo(a,e){account=a;eventId=e;render();}, setPrep(next){prepState=typeof next==='function'?next(prepState):next;prepListeners.forEach(l=>l());}, prepModule:loadPrep, library(lib){workspace={...workspace,library:lib};render();},unmount(){cleanup(editorSlots);cleanup(rootSlots);}, pagehide(){events.get('pagehide')?.();}};
  }
  return harness;
}
module.exports={createEventRouteHarness};