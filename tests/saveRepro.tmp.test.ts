import { it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj';
import * as dance from '@/lib/danceFloor';
import * as audio from '@/lib/audioMatch';
import * as snapshots from '@/lib/snapshotSafety';
import * as drafts from '@/lib/eventDrafts';
import * as input from '@/lib/inputSafety';
import * as autosave from '@/lib/eventAutosave';
import * as vibes from '@/lib/vibes';
import * as isolation from '@/lib/workflowIsolation';
import * as theory from '@/lib/musicTheory';
import * as revisions from '@/lib/eventRevision';
import { runEnrichment } from '@/lib/enrichPipeline.server';
import { inputsSchema, listsSchema } from '@/lib/history.functions';
const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });
const req = [['Mark Ronson feat. Bruno Mars','Uptown Funk'],['Mark Ronson','Valerie'],['Mark Ronson','Valerie (Live)'],['Adele','Hello'],['Lionel Richie','Hello'],['Earth, Wind & Fire','September']].map(([artist,song])=>({artist,song,fromUpload:true}));
const now=new Date().toISOString();
const cache=[
 {artist_key:'bruno mars',song_key:'marry you',energy:7,danceability:7,valence:5,popularity:8,bpm:145,camelot:'6B',genre:null,year:null,source:'v2|ReccoBeats|b=p,n=p,d=p,o=p,v=p,k=p'},
 {artist_key:'bruno mars',song_key:'treasure',energy:7,danceability:9,valence:9,popularity:3,bpm:116,camelot:'4A',genre:null,year:2012,source:'ReccoBeats+MusicBrainz'},
 {artist_key:'mark ronson',song_key:'valerie',energy:8,danceability:7,valence:9,popularity:null,bpm:106,camelot:null,genre:'Soul pop',year:2007,source:'AI'},
 {artist_key:'mark ronson',song_key:'uptown funk',energy:3,danceability:8,valence:5,popularity:1,bpm:113,camelot:'6A',genre:null,year:2015,source:'ReccoBeats+MusicBrainz'},
 {artist_key:'earth wind',song_key:'september',energy:8,danceability:7,valence:10,popularity:null,bpm:126,camelot:null,genre:'Disco funk',year:2003,source:'AI'},
 {artist_key:'adele',song_key:'hello',energy:5,danceability:5,valence:3,popularity:null,bpm:79,camelot:null,genre:'Soul pop',year:2015,source:'v2|AI|b=a,y=a,g=a,n=a,d=a,v=a'},
 {artist_key:'lionel richie',song_key:'hello',energy:4,danceability:5,valence:1,popularity:1,bpm:62,camelot:'8A',genre:null,year:null,source:'v2|ReccoBeats|b=p,n=p,d=p,o=p,v=p,k=p'},
].map(r=>({...r,fetched_at:now}));
const enrich=async(r:any)=>{ const f=globalThis.fetch; (globalThis as any).fetch=async()=>{throw Error('offline')}; try { const out = await runEnrichment(r.data.songs,{readRows:async()=>cache as any,upsert:async()=>{},estimate:async(s:any)=>s.map(()=>null)}); return JSON.parse(JSON.stringify(out)); } finally { globalThis.fetch=f; } };
it('repro', async () => {
  const lib = vdj.buildLibrary(Array.from({length:12},(_,i)=>({filePath:`/s/${i}.mp3`,artist:i%2?'Bruno Mars':'Mark Ronson',title:`Track ${i}`,bpm:'118',year:'2014',genre:'Pop',playCount:i})) as any);
  const h = harness({ rows: { A: { id:'A', name:'TEST ONLY', updated_at:'2026-10-31T01:59:00Z', inputs:{ songs:req, hours:'1', buffer:2, listType:'dance', expand:true, artistsInput:'Mark Ronson, Bruno Mars', genresInput:'', decades:[], notes:'', doNotPlayInput:'', eventName:'TEST ONLY' }, lists:{warmUp:[],transition:[],peak:[]} } }, services: { enrich } });
  vi.useFakeTimers();
  await h.flush(); h.library(lib); await h.flush(); await h.current.generate(); await h.flush();
  await vi.advanceTimersByTimeAsync(2000); await h.flush(); vi.useRealTimers();
  const saved = [...h.requests].reverse().find((r:any)=>r.lists) as any;
  console.log(JSON.stringify(saved, null, 1).slice(0, 6000));
  const i = inputsSchema.safeParse(saved.inputs), l = listsSchema.safeParse(saved.lists);
  console.log('INPUTS', JSON.stringify(i.error?.issues), 'LISTS', JSON.stringify(l.error?.issues));
  h.unmount();
});
