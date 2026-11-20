import {createHash} from 'node:crypto';
import {validSavedLibrary} from '@/lib/libraryStore';
import {inspectBackupValues} from '@/lib/backupPolicy';

export const MAX_LIBRARY_TRACKS=50_000, MAX_LIBRARY_BYTES=64*1024*1024;
export const LIBRARY_CHUNK_TRACKS=250, LIBRARY_CHUNK_BYTES=192*1024;
export const LIBRARY_PUSH_BATCH=4, LIBRARY_PULL_BATCH=10;
export const stableLibrary=(value:any):string=>JSON.stringify(value,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export const libraryHash=(value:any)=>createHash('sha256').update(stableLibrary(value)).digest('hex');
export const isChunkedLibrary=(value:any)=>value?.format==='chunked-library'&&value.version===2;
export const isLibraryChunkId=(id:string)=>/^chunk:([1-9]\d{0,2}):[a-f0-9]{64}$/.test(id)&&Number(id.split(':')[1])<=LIBRARY_CHUNK_TRACKS;
const only=(v:any,keys:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('Unexpected library fields.');};
export function assertLibraryPrivacy(value:any){
 inspectBackupValues(value);
 const walk=(x:any):void=>{if(typeof x==='string'&&(/\/Users\/|\/Volumes\/|[a-z]:\\|sb_secret_|Bearer\s/i.test(x)))throw Error('Private fields cannot enter test synchronization.');if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object')Object.values(x).forEach(walk);};walk(value);
}
export function validateLibrarySources(sources:any,maxTracks=MAX_LIBRARY_TRACKS){
 if(!validSavedLibrary({version:1,savedAt:1,sources})||sources.length>5||sources.reduce((n:number,s:any)=>n+s.tracks.length,0)>maxTracks||Buffer.byteLength(JSON.stringify(sources))>MAX_LIBRARY_BYTES)throw Error('Invalid or oversized generated test library.');
 assertLibraryPrivacy({sources});
 for(const source of sources){only(source,['label','tracks']);if(!source.label.startsWith('Prototype ')||source.label.length>200)throw Error('Only generated test sources are available.');for(const t of source.tracks){only(t,['filePath','fileSize','artist','title','bpm','key','genre','year','decade','remix','album','comment','fromTags','playCount','lastPlayTime','songLength']);if(!/^Prototype Artist \d{2}$/.test(t.artist)||!/^Test Track \d{2}$/.test(t.title)||!/^prototype-files:\/\/\/library\/[A-Za-z0-9 ()_.-]+\.wav$/.test(t.filePath)||t.fromTags!==undefined&&typeof t.fromTags!=='boolean')throw Error('Only generated test library references may synchronize.');}}
 return sources;
}
export function validateLibraryChunk(id:string,payload:any){
 only(payload,['format','version','tracks']);
 if(payload.format!=='library-chunk'||payload.version!==1||!isLibraryChunkId(id)||!Array.isArray(payload.tracks)||payload.tracks.length!==Number(id.split(':')[1])||Buffer.byteLength(JSON.stringify(payload))>LIBRARY_CHUNK_BYTES||id!==`chunk:${payload.tracks.length}:${libraryHash(payload)}`)throw Error('Library chunk identity or checksum is invalid.');
 validateLibrarySources([{label:'Prototype Chunk',tracks:payload.tracks}],LIBRARY_CHUNK_TRACKS);return payload;
}
export function validateLibraryManifest(payload:any){
 only(payload,['format','version','totalTracks','sources']);
 if(!isChunkedLibrary(payload)||!Array.isArray(payload.sources)||payload.sources.length>5||!Number.isSafeInteger(payload.totalTracks)||payload.totalTracks<0||payload.totalTracks>MAX_LIBRARY_TRACKS||Buffer.byteLength(JSON.stringify(payload))>192*1024)throw Error('Invalid library manifest.');
 let total=0,refs=0;for(const s of payload.sources){only(s,['label','trackCount','chunks']);if(typeof s.label!=='string'||!s.label.startsWith('Prototype ')||s.label.length>200||!Number.isSafeInteger(s.trackCount)||s.trackCount<0||!Array.isArray(s.chunks))throw Error('Invalid library source manifest.');let count=0;for(const c of s.chunks){only(c,['id','count']);if(!isLibraryChunkId(c.id)||c.count!==Number(c.id.split(':')[1]))throw Error('Invalid library chunk reference.');count+=c.count;refs++;}if(count!==s.trackCount)throw Error('Library source count does not match its chunks.');total+=count;}
 if(total!==payload.totalTracks||refs>1000)throw Error('Library manifest totals are invalid.');assertLibraryPrivacy(payload);return payload;
}
export function libraryChunkIds(payload:any):string[]{return isChunkedLibrary(payload)?[...new Set<string>(validateLibraryManifest(payload).sources.flatMap((s:any)=>s.chunks.map((c:any)=>c.id)))]:[];}
export function splitLibrary(sources:any){
 validateLibrarySources(sources);const chunks:Record<string,any>={},manifest:any={format:'chunked-library',version:2,totalTracks:sources.reduce((n:number,s:any)=>n+s.tracks.length,0),sources:[]};
 for(const source of sources){const entry:any={label:source.label,trackCount:source.tracks.length,chunks:[]};let tracks:any[]=[],size=64;
  const flush=()=>{if(!tracks.length)return;const payload={format:'library-chunk',version:1,tracks},id=`chunk:${tracks.length}:${libraryHash(payload)}`;validateLibraryChunk(id,payload);chunks[id]=payload;entry.chunks.push({id,count:tracks.length});tracks=[];size=64;};
  for(const track of source.tracks){const bytes=Buffer.byteLength(JSON.stringify(track))+1;if(tracks.length&&(tracks.length===LIBRARY_CHUNK_TRACKS||size+bytes>LIBRARY_CHUNK_BYTES))flush();if(size+bytes>LIBRARY_CHUNK_BYTES)throw Error('A library track exceeds the supported chunk size. Original library kept.');tracks.push(track);size+=bytes;}flush();manifest.sources.push(entry);
 }
 validateLibraryManifest(manifest);return {manifest,chunks};
}
export function materializeLibrary(manifest:any,read:(id:string)=>any){
 validateLibraryManifest(manifest);const sources=manifest.sources.map((s:any)=>({label:s.label,tracks:s.chunks.flatMap((c:any)=>validateLibraryChunk(c.id,read(c.id)).tracks)}));validateLibrarySources(sources);return {sources};
}
