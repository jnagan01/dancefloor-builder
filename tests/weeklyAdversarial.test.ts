import {describe,it,expect,vi,afterEach} from 'vitest';
import {parseFile,generateLists,dedupeKey} from '@/lib/danceFloor';
import {additionKeys,versionTitleIdentity} from '@/lib/additionIdentity';
import {resolveSavedSelections,rowSelectionKey} from '@/lib/selectionRestore';
import {createFactsGatherer,factsKey} from '@/lib/prep/factsGather';
import {buildLibrary,buildM3u} from '@/lib/virtualDj';

const seed=Number(process.env.WEEKLY_SEED??20261105);
let state=seed>>>0;
const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
const count=256;
const rows=Array.from({length:count},(_,i)=>({artist:`Synthetic ${i} ${Math.floor(random()*10000)}`,song:`Title ${i}`}));
afterEach(()=>vi.useRealTimers());
describe(`weekly synthetic seed=${seed} (256 records, imports <5MB)`,()=>{
 it('bounded CSV import preserves quoted titles and repeated credit/version semantics',async()=>{
  const csv='Artist,Song\n'+rows.map(r=>`"${r.artist}","${r.song}, quoted ""value"""`).join('\n');
  expect(Buffer.byteLength(csv)).toBeLessThanOrEqual(5242880);expect(rows.length).toBeLessThanOrEqual(100000);
  const parsed=await parseFile(new File([csv],'synthetic.csv'));
  expect(parsed).toHaveLength(count);
  rows.forEach((r,i)=>{
   expect(parsed[i]).toEqual({artist:r.artist,song:`${r.song}, quoted "value"`});
   const a=additionKeys(`${r.artist} feat. Guest`,`${r.song} (Clean)`);
   const b=additionKeys(r.artist,r.song);expect(a.some(k=>b.includes(k))).toBe(true);
   expect(versionTitleIdentity(r.artist,`${r.song} (Remix)`)).not.toBe(versionTitleIdentity(r.artist,r.song));
  });
 });
 it('save/reopen collisions are invariant under seeded object insertion order',()=>{
  for(let i=0;i<64;i++){
   const row=rows[i],key=rowSelectionKey('warmUp',i,row),stale=rowSelectionKey('warmUp',i,rows[i+64]);
   const good={paths:[`/synthetic/${i}/exact.mp3`,`/synthetic/${i}/extra.mp3`],confirmed:true};
   const bad={paths:['/synthetic/unrelated.mp3'],confirmed:true,excluded:true};
   const entries=random()<0.5?[[stale,bad],[key,good]]:[[key,good],[stale,bad]];
   const saved=JSON.parse(JSON.stringify(Object.fromEntries(entries)));
   const restored=resolveSavedSelections({warmUp:rows.slice(0,64)},saved);
   expect(restored[key]).toEqual(good);expect(Object.keys(restored)).toEqual([key]);
  }
 });
 it('expansion-off retains every request and policy-constrained expansion leaves honest gaps',()=>{
  for(let i=1;i<=16;i++){
   const uploaded=rows.slice(0,i),prefs={artists:[],genres:[],decades:[],notes:'',additionAllowed:()=>false};
   const off=generateLists({uploaded,prefs,hours:1,buffer:1,expand:false,preserveRequestedRows:true});
   const on=generateLists({uploaded,prefs,hours:1,buffer:1,expand:true,preserveRequestedRows:true});
   for(const result of [off,on])expect(new Set([...result.warmUp,...result.transition,...result.peak].map(r=>dedupeKey(r.artist,r.song)))).toEqual(new Set(uploaded.map(r=>dedupeKey(r.artist,r.song))));
  }
 });
 it('provider outages and timeouts remain unknown with bounded mocked calls',async()=>{
  vi.useFakeTimers();
  const fetch=vi.fn(()=>new Promise<{artist:string;song:string;energy:number}[]>(()=>{}));
  const gather=createFactsGatherer(fetch,factsKey,{timeoutMs:100,budget:8,batchSize:4,concurrency:1});
  const work=gather.gather(rows.slice(0,16));await vi.advanceTimersByTimeAsync(101);const report=await work;
  expect(report.found).toBe(0);expect(report.timedOutSongs).toBeGreaterThan(0);expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
  expect(gather.get(rows[0])).toBeUndefined();
 });
 it('exports approved exact files only, never same-basename substitutes or unapproved rows',()=>{
  const tracks=rows.slice(0,32).map((r,i)=>({artist:r.artist,title:r.song,filePath:`/synthetic/folder${i}/same.mp3`}));
  const library=buildLibrary(tracks);
  for(let i=0;i<32;i++){
   const refs=[{song:rows[i],match:{status:'Matched' as const,trackIndex:i,confirmed:true}},{song:rows[(i+1)%32],match:{status:'Matched' as const,trackIndex:(i+1)%32,confirmed:false}}];
   const output=buildM3u(refs,library,{});
   expect(output).toContain(tracks[i].filePath);expect(output).not.toContain(tracks[(i+1)%32].filePath);
  }
 });
});