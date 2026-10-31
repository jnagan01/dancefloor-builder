const fs=require('fs'), vm=require('vm'), path=require('node:path');
const root=path.resolve(__dirname,'../..');
const projectRequire=specifier=>require(path.join(root,specifier));
const ts=projectRequire('node_modules/typescript');
function createHarnessModules({vdj,bridge,audio,identity,metadata,cache,safety,workspaceIndexes,trackRevisions}) {
const {buildAudioIndex,resolveAudioFile}=audio;
const source=fs.readFileSync(path.join(root,'src/components/workspace/WorkspaceContext.tsx'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function harness(initial, native=true){let slots=[],cursor=0,current; const memory=new Map(); global.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 const react={createContext:()=>({Provider:'provider'}),useContext:()=>current,useEffect:()=>{},useMemo:f=>f(),useRef:v=>{let i=cursor++; if(!slots[i])slots[i]={current:v};return slots[i]},useState:v=>{let i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next}]} };
 const resolverCalls=[];const pendingScans=[],pendingTags=[],pendingReads=[]; let rootsQueue=[];
 const b={...bridge,supportsNativeScan:()=>native,chooseNativeMusicFolder:async()=>rootsQueue.shift(),scanNativeFolder:root=>{const d=deferred();pendingScans.push({root,...d});return d.promise},writeNativeTags:(path,tags)=>{const d=deferred();pendingTags.push({path,tags,...d});return d.promise},readNativeAudioFile:(path,relative)=>{const d=deferred();pendingReads.push({path,relative,...d});return d.promise}};
 const modules={'@/lib/backupClient':{saveBackup:async()=>{}},'@/lib/backups':{validateBackup:(raw)=>JSON.parse(raw),previewMetadataRestore:()=>({additions:[],mappings:{},conflicts:[]})},'@/lib/snapshotSafety':{readEventSnapshot:x=>x},'react':react,'react/jsx-runtime':{jsx:(_t,p)=>{current=p.value;return p},jsxs:(_t,p)=>p},'@/integrations/supabase/client':{supabase:{from:()=>({select:()=>({eq:()=>({limit:async()=>({data:[],error:null})})})})}},'@/lib/virtualDj':vdj,'@/lib/libraryStore':{loadMusicLibrary:async()=>null,saveMusicLibrary:async()=>1},'@/lib/desktopBridge':b,'@/lib/dirHandleStore':{},sonner:{toast:{success:()=>{},error:()=>{},info:()=>{}}},'@/lib/audioMatch':{buildAudioIndex,resolveAudioFile},'@/lib/fileIdentity':identity,'@/lib/trackMetadataIdentity':{...metadata,metadataResolver:(...args)=>{resolverCalls.push({items:args[0].length,known:args[1].length});return metadata.metadataResolver(...args)}},'@/lib/workspaceFileCache':cache,'@/lib/nativeScanSafety':safety,'@/lib/workspaceIndexes':workspaceIndexes,'@/lib/trackRevisions':trackRevisions};
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,require:k=>{if(!(k in modules))throw Error(k);return modules[k]},console,File,structuredClone,Date,crypto,AbortController,localStorage:global.localStorage,window:{},setTimeout,clearTimeout});
 function render(){cursor=0;module.exports.WorkspaceProvider({children:null});return current}render();slots[0]=initial;slots[2]='synthetic';slots[3]=false;render();return {render,queueRoot:r=>rootsQueue.push(r),pendingScans,pendingTags,pendingReads,resolverCalls,memory,slots};}
const scan=(root,name='Song.mp3',bpm='120')=>({ok:true,complete:true,root,label:root.split('/').pop(),files:[{name,path:`${root}/${name}`,relativePath:`Music/${name}`,tags:{bpm,title:name,artist:'A'}}]});
return {harness,deferred,scan};
}
module.exports={createHarnessModules};
