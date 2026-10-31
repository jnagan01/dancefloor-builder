const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'node_modules/typescript'));
function createEventRouteHarness(actual) {
  let source = fs.readFileSync(path.join(root, 'src/routes/_authenticated/events.new.tsx'), 'utf8');
  // Expose actual closures in the test VM only; no production test seam or replacement logic.
  source = source.replace('  const withFileBpm =', '  capture({ result, matches, savedEventId, saveState, stableCreate: stableCreate.current, restoreRecovery, clearWorkflowState, generate, setSongs, setEventName, setResult, userEdited, autosave, computeLiveTargets, persistOnExit, snapshotReadOnly, draftBlocked });\n  const withFileBpm =');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  function harness({ account = 'owner', eventId = 'A', memory = new Map(), rows = {}, write = async r => ({ id: r.data.id, updatedAt: '2026-10-31T00:00:01Z' }) } = {}) {
    let slots = [], cursor = 0, queued = [], captured, activeKey, dirty = false, rootSlots = [], renderingRoot = false, tree;
    const loads = [], requests = [], errors = [], navigations = [];
    let workspace = { sources: [], library: null, audioIndex: actual.audio.buildAudioIndex([]) };
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
    const history = { getWorkflow: async r => { loads.push(r.data.id); return await rows[r.data.id]; }, saveWorkflowSafely: async r => { requests.push({account, ...r.data}); return write(r); } };
    const route = { useSearch: () => ({eventId:eventId ?? undefined}) };
    const navigate = async r => { navigations.push(r); eventId=r.search?.eventId; };
    const modules = {
      react, 'react/jsx-runtime': {jsx,jsxs:jsx}, '@tanstack/react-router': {createFileRoute:()=>opts=>({...route,...opts}),useNavigate:()=>navigate,useBlocker:no},
      '@tanstack/react-start': {useServerFn:f=>f}, '@/lib/history.functions':history,
      '@/hooks/useAuth': {useAuth:()=>({user:account?{id:account}:null})}, '@/hooks/useDebounce':{useDebounce:v=>v},
      '@/components/workspace/WorkspaceContext':{useWorkspace:()=>workspace},
      '@/integrations/supabase/client':{supabase:{auth:{getUser:async()=>({data:{user:null}})}}},
      sonner:{toast:{error:e=>errors.push(e),success:no,warning:no,info:no}},
      '@/lib/virtualDj':actual.vdj, '@/lib/danceFloor':actual.dance, '@/lib/audioMatch':actual.audio,
      '@/lib/snapshotSafety':actual.snapshots, '@/lib/eventDrafts':actual.drafts, '@/lib/inputSafety':actual.input,
      '@/lib/eventAutosave':actual.autosave, '@/lib/vibes':actual.vibes, '@/lib/workflowIsolation':actual.isolation,
      '@/lib/eventRevision':actual.revisions,
      '@/lib/musicTheory':actual.theory, '@/lib/pageHead':{pageHead:no},
      '@/lib/dirHandleStore':{loadDirHandle:async()=>null,loadDirHandleMeta:async()=>null},
      '@/lib/enrich.functions':{enrichSongs:async()=>({results:[]})},
    };
    const module={exports:{}};
    const events=new Map();
    vm.runInNewContext(compiled,{module,exports:module.exports,require:k=>modules[k]??stub,capture:v=>{captured=v},console,crypto,File,AbortController,localStorage:storage,document:{getElementById:()=>null,querySelector:()=>null},window:{addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k),confirm:()=>true},setTimeout,clearTimeout,Date});
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
    return {render,flush,memory,requests,loads,errors,navigations,nodes,interact,get tree(){return tree},get current(){return captured}, edit(name){interact(n=>n.props?.id==='eventName','onChange',{target:{value:name}});},switchTo(a,e){account=a;eventId=e;render();}, library(lib){workspace={...workspace,library:lib};render();},unmount(){cleanup(editorSlots);cleanup(rootSlots);}, pagehide(){events.get('pagehide')?.();}};
  }
  return harness;
}
module.exports={createEventRouteHarness};