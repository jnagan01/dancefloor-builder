import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj';import * as dance from '@/lib/danceFloor';import * as audio from '@/lib/audioMatch';import * as snapshots from '@/lib/snapshotSafety';import * as drafts from '@/lib/eventDrafts';import * as input from '@/lib/inputSafety';import * as autosave from '@/lib/eventAutosave';import * as vibes from '@/lib/vibes';import * as isolation from '@/lib/workflowIsolation';import * as theory from '@/lib/musicTheory';import * as revisions from '@/lib/eventRevision';
const require=createRequire(import.meta.url), factory=require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({vdj,dance,audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions});
const clients=[{artist:'TEST Meter',song:'One'},{artist:'TEST Meter',song:'Two'},{artist:'TEST Meter',song:'Three'}];
const base={id:'A',inputs:{eventName:'Meter test',songs:clients,hours:'0.15',buffer:1,listType:'dance',expand:false},lists:{warmUp:clients,transition:[],peak:[],selections:{}}};
const getProgress=(h:any)=>h.nodes().find((n:any)=>n.props?.progress)?.props.progress;
afterEach(()=>vi.useRealTimers());
it('identical regeneration retains confirmed save status rather than fabricating a pending save',async()=>{
 vi.useFakeTimers();const h=factory({rows:{A:structuredClone(base)}});await h.flush();
 h.library(vdj.buildLibrary(clients.map((s,i)=>({artist:s.artist,title:s.song,filePath:`/synthetic/save-status/${i}.mp3`,songLength:180}))));await h.flush();
 const first=h.current.generate();await vi.advanceTimersByTimeAsync(3000);await first;await h.flush();await vi.advanceTimersByTimeAsync(2000);await h.flush();
 const saved=()=>h.nodes().some((n:any)=>n.props?.role==='status'&&n.props?.children?.includes('Event saved automatically'));
 expect(saved()).toBe(true);
 const second=h.current.generate();await vi.advanceTimersByTimeAsync(3000);await second;await h.flush();await vi.advanceTimersByTimeAsync(2000);await h.flush();
 expect(saved()).toBe(true);h.unmount();
});
it('actual generation begins immediately, exposes measured intermediate totals, hidden completion stays hidden and next run resets',async()=>{
 vi.useFakeTimers();let resolve:(v:any)=>void=()=>{};const h=factory({rows:{A:structuredClone(base)},services:{enrich:()=>new Promise(r=>{resolve=r;})}});await h.flush();
 const tracks=clients.map((s,i)=>({artist:s.artist,title:s.song,filePath:`/synthetic/meters/${i}.mp3`,songLength:180}));const original=JSON.stringify(base);h.library(vdj.buildLibrary(tracks));await h.flush();
 const p=h.current.generate();await h.flush();const progress=getProgress(h);expect(progress.get()).toMatchObject({open:true,stage:'Checking track details',totals:{warmUp:540,transition:0,peak:0}});
 progress.visible(progress.get().id,false);expect(progress.get().open).toBe(false);progress.visible(progress.get().id,true);expect(progress.get().open).toBe(true);progress.visible(progress.get().id,false);
 resolve({results:[]});await vi.advanceTimersByTimeAsync(1000);await p;await h.flush();expect(progress.get()).toMatchObject({finished:true,open:false});expect(JSON.stringify(base)).toBe(original);expect(h.current.songs).toEqual(clients);expect(tracks.map(t=>t.songLength)).toEqual([180,180,180]);
 const next=h.current.generate();await h.flush();expect(progress.get()).toMatchObject({open:true,finished:false});resolve({results:[]});await vi.advanceTimersByTimeAsync(1000);await next;h.unmount();expect(progress.get()).toBe(null);
});
it.each(['cocktail','dinner'])('actual %s generation captures one target, unknown/repeated files never fill it',async(type)=>{
 vi.useFakeTimers();const row={...base,inputs:{...base.inputs,listType:type,minutes:'60'}};const h=factory({rows:{A:row}});await h.flush();h.library(vdj.buildLibrary(clients.map(s=>({artist:s.artist,title:s.song,filePath:'/synthetic/same.mp3',songLength:180}))));await h.flush();const p=h.current.generate();await vi.advanceTimersByTimeAsync(1000);await p;await h.flush();expect(getProgress(h).get()).toMatchObject({type,targets:{warmUp:3600,transition:0,peak:0},totals:{warmUp:180,transition:0,peak:0}});h.unmount();
});
it('invalid preflight stays closed and an account/event change releases pending old observations',async()=>{
 vi.useFakeTimers();const h=factory({rows:{A:structuredClone(base)},services:{enrich:async()=>{await new Promise(r=>setTimeout(r,4000));return {results:[]};}}});await h.flush();h.current.setSongs([]);await h.flush();await h.current.generate();expect(getProgress(h).get()).toBe(null);
 h.current.setSongs(clients);await h.flush();const oldProgress=getProgress(h),p=h.current.generate();expect(oldProgress.get()?.open).toBe(true);await h.flush();h.switchTo('other','B');await h.flush();expect(oldProgress.get()).toBe(null);await vi.advanceTimersByTimeAsync(5000);await p;await h.flush();expect(getProgress(h).get()).toBe(null);h.unmount();
});
it('readiness early return releases the immediately opened run without claiming success',async()=>{
 vi.useFakeTimers();const h=factory({rows:{A:{...base,inputs:{...base.inputs,expand:true,genresInput:'Pop'}}}});await h.flush();h.setPrep((s:any)=>({...s,status:'blocked'}));
 const p=h.current.generate();expect(getProgress(h).get()?.open).toBe(true);await p;await h.flush();expect(getProgress(h).get()).toBe(null);expect(h.errors.length).toBeGreaterThan(0);h.unmount();
});
it('an older finally cannot close a newer run or clear its generating control',async()=>{
 vi.useFakeTimers();const replies:Array<(r:any)=>void>=[];const h=factory({rows:{A:structuredClone(base)},services:{enrich:()=>new Promise(resolve=>replies.push(resolve))}});await h.flush();h.library(vdj.buildLibrary([]));await h.flush();
 const first=h.current.generate();await h.flush();const progress=getProgress(h),old=progress.get().id;
 const second=h.current.generate();await h.flush();expect(progress.get().id).not.toBe(old);const newest=progress.get().id;
 replies[0]({results:[]});await vi.advanceTimersByTimeAsync(1);await first;await h.flush();expect(progress.get()).toMatchObject({id:newest,open:true,finished:false});expect(h.nodes().some((n:any)=>n.props?.disabled&&n.props?.children==='Generating…')).toBe(true);
 replies[1]({results:[]});await vi.advanceTimersByTimeAsync(1000);await second;await h.flush();h.unmount();
});
it('actual final feedback failure releases progress and never applies generated selections',async()=>{
 vi.useFakeTimers();const h=factory({rows:{A:{...base,inputs:{...base.inputs,expand:true,genresInput:'Pop'}}}});await h.flush();
 const tracks=clients.map((s,i)=>({artist:s.artist,title:s.song,filePath:`/synthetic/failure/${i}.mp3`,songLength:180}));h.library(vdj.buildLibrary(tracks));await h.flush();
 const original=JSON.stringify(h.current.result),p=h.current.generate();h.setPrep((s:any)=>({...s,status:'blocked'}));await vi.advanceTimersByTimeAsync(125000);await p;await h.flush();expect(getProgress(h).get()).toBe(null);expect(JSON.stringify(h.current.result)).toBe(original);expect(h.errors.length).toBeGreaterThan(0);h.unmount();
});