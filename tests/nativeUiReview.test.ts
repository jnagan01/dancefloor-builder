import { describe, it, expect, vi, afterEach } from 'vitest';
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
const require=createRequire(import.meta.url);
const harness=require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({vdj,dance,audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions});
const song={artist:'Test Artist',song:'Test Song - Live'};
const key='warmUp:0:'+dance.dedupeKey(song.artist,song.song);
const track={filePath:'/mock/Casanova.mp3',artist:'Casanova ft Giggs',title:'Live (Clean)'};
const row=(selections:any={},extra:any={})=>({id:'A',name:'Test',updated_at:'v1',inputs:{hours:'0.25',buffer:2,listType:'dance',eventName:'Test',songs:[song],...extra},lists:{warmUp:[{...song,fromUpload:true}],transition:[],peak:[],selections}});
const storageKey=(account='owner',event='A')=>`setarchitect:recovery:${account}:${event}`;
afterEach(()=>vi.useRealTimers());
describe('native UI review: actual isolated route callers',()=>{
 it('renamed tentative candidate is omitted by ZIP, M3U and direct DJ TXT while reference files retain intended title',async()=>{
  vi.useFakeTimers();const h=harness({eventId:null});await h.flush();h.library(vdj.buildLibrary([{...track,artist:song.artist,title:song.song}]));await h.current.handleFiles([new File(['Test Artist - Test Song - Live'],'client.txt')]);await h.flush();await h.current.generate();await h.flush();
  const sec=h.nodes().find((n:any)=>n.props?.onRename);sec.props.onRename(0,{...song,song:'Test Song - Live - Edited'});h.render();await h.flush();
  const match=Object.values(h.current.matches)[0] as vdj.SongMatch;expect(vdj.exportApproved(match)).toBe(false);expect(match.status).toBe("Possible Match");
  await h.current.exportAllZip();expect(h.files.some((f:any)=>f.name.endsWith('.m3u'))).toBe(false);expect(h.files.find((f:any)=>f.name.endsWith('.txt')).data).toContain('Test Song - Live - Edited');
  h.current.setVdjDirHandle({});await h.flush();for(const prop of ['onExportM3u','onExportM3uToVdj','onExportXmlToVdj'])await h.invoke(prop);await h.current.exportAllToVdj();expect(h.files.filter((f:any)=>f.name.endsWith('.m3u'))).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1000);await h.flush();const saved=h.requests.at(-1);const savedSelection=Object.values(saved.lists.selections)[0] as any;expect(savedSelection.confirmed).toBe(false);h.unmount();
  const reloaded=harness({rows:{A:{...row(),name:saved.name,inputs:saved.inputs,lists:saved.lists}}});await reloaded.flush();reloaded.library(vdj.buildLibrary([track]));await reloaded.flush();await reloaded.current.exportAllZip();expect(reloaded.files.some((f:any)=>f.name.endsWith('.m3u'))).toBe(false);expect(reloaded.requests).toHaveLength(0);reloaded.unmount();
 });
 it.each([undefined,false])('legacy or explicitly unconfirmed paths never gain approval on restore (%s)',async confirmed=>{
  vi.useFakeTimers();const original=row({[key]:{paths:[track.filePath],confirmed}});const h=harness({rows:{A:original}});await h.flush();h.library(vdj.buildLibrary([track]));await h.flush();
  expect(Object.values(h.current.matches)[0]).toMatchObject({status:'Possible Match',confirmed:false});
  await h.current.exportAllZip();expect(h.files.some((f:any)=>f.name.endsWith('.m3u'))).toBe(false);expect(h.files.find((f:any)=>f.name.endsWith('.txt')).data).toContain(song.song);expect(h.files.find((f:any)=>f.name.endsWith('.txt')).data).not.toContain('Casanova');
  await vi.advanceTimersByTimeAsync(2000);expect(h.requests).toHaveLength(0);h.unmount();
 });
 it('explicit confirmation survives save/reload, exact pick/extras and exclusion are honored by every file caller',async()=>{
  vi.useFakeTimers();const h=harness({rows:{A:row({[key]:{paths:[track.filePath],confirmed:false}})}});await h.flush();h.library(vdj.buildLibrary([track,{...track,filePath:'/mock/Extra.mp3'}]));await h.flush();
  h.interact(n=>n.props?.onConfirm,'onConfirm',key);await h.flush();
  await h.current.exportAllZip();expect(h.files.some((f:any)=>f.name.endsWith('.m3u')&&f.data.includes(track.filePath))).toBe(true);
  h.current.setVdjDirHandle({});await h.flush();for(const prop of ['onExportM3u','onExportM3uToVdj','onExportXmlToVdj'])await h.invoke(prop);
  await h.current.exportAllToVdj();expect(h.downloads.some((d:any)=>d.name.endsWith('.m3u'))).toBe(true);
  const sec=h.nodes().find((n:any)=>n.props?.onToggleExtra);sec.props.onToggleExtra(key,1);h.render();await h.flush();
  const refs=[{song,match:h.current.matches[key]}];expect(vdj.buildM3u(refs,vdj.buildLibrary([track,{...track,filePath:'/mock/Extra.mp3'}]),{})).toContain('/mock/Extra.mp3');
  h.interact(n=>n.props?.onToggleExclude,'onToggleExclude',key);await h.flush();expect(vdj.countMatchedForExport([{song,match:h.current.matches[key]}],vdj.buildLibrary([track]))).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);await h.flush();const saved=h.requests.at(-1);expect(saved.lists.selections[key]).toMatchObject({confirmed:true,excluded:true});h.unmount();
  const b=harness({rows:{A:{...row(),inputs:saved.inputs,lists:saved.lists}}});await b.flush();b.library(vdj.buildLibrary([track,{...track,filePath:'/mock/Extra.mp3'}]));await b.flush();expect(b.current.matches[key]).toMatchObject({confirmed:true,excludedFromVdj:true});expect(b.requests).toHaveLength(0);b.unmount();
 });
 it('all export callers reject an approved CR/LF path before downloads or directory writes',async()=>{
  const bad={...track,filePath:'/mock/Bad\nInjected.mp3'};const h=harness({rows:{A:row({[key]:{paths:[bad.filePath],confirmed:true}})}});await h.flush();h.library(vdj.buildLibrary([bad]));h.current.setVdjDirHandle({});await h.flush();
  for(const prop of ['onExportM3u','onExportM3uToVdj','onExportXmlToVdj'])await h.invoke(prop);await h.current.exportAllZip();await h.current.exportAllToVdj();expect(h.files).toHaveLength(0);expect(h.downloads).toHaveLength(0);expect(h.errors.filter((e:string)=>e.includes('No playlist was written'))).toHaveLength(5);h.unmount();
 });
 it('leave, late save, changed cleanup token and reopen reconciles only exact marker plus semantic data',async()=>{
  vi.useFakeTimers();let resolve:(v:any)=>void=()=>{};const rows:any={A:row()};const h=harness({rows,write:()=>new Promise(r=>resolve=r)});await h.flush();h.edit('Latest title');await vi.advanceTimersByTimeAsync(1000);expect(h.leave()).toBe(false);
  const req=h.requests[0], original=JSON.parse(h.memory.get(storageKey()));original.token='changed-on-exit';h.memory.set(storageKey(),JSON.stringify(original));h.switchTo('owner','B');await h.flush();
  rows.A={...row(),name:req.name,inputs:revisions.withEventRevision(req.inputs,req.writeRevision),lists:req.lists};resolve({id:'A',revision:req.writeRevision,updatedAt:'v2'});await h.flush();expect(h.memory.has(storageKey())).toBe(true);h.switchTo('owner','A');await h.flush();expect(h.current.recovery).toBe(null);expect(h.memory.has(storageKey())).toBe(false);expect(h.current.saveState).toBe('saved');h.unmount();
 });
 it.each(['newer-marker','same-marker-different-data','offline'])('keeps %s recovery, archives a backup explicitly and allows dirty edits afterward',async variant=>{
  vi.useFakeTimers();const marker=crypto.randomUUID(),saved=row();const snapshot={name:saved.name,inputs:saved.inputs,lists:saved.lists};const draft={version:1,account:'owner',event:'A',token:'t',createId:'create',baseVersion:'v0',baseRevision:null,writeRevision:marker,snapshot,savedAt:1};
  const remoteMarker=variant==='same-marker-different-data'?marker:crypto.randomUUID();const remote={...saved,inputs:revisions.withEventRevision({...saved.inputs,eventName:'Remote'},remoteMarker)};
  const h=harness({rows:{A:remote},memory:new Map([[storageKey(),JSON.stringify(draft)]])});await h.flush();expect(h.current.recovery).toBeTruthy();h.edit('While conflict visible');h.pagehide();await vi.advanceTimersByTimeAsync(1000);expect(h.requests).toHaveLength(0);expect(JSON.parse(h.memory.get(storageKey())).token).toBe('t');h.current.dismissRecovery();await h.flush();await vi.advanceTimersByTimeAsync(1000);expect(h.requests[0].inputs.eventName).toBe('While conflict visible');expect([...h.memory.values()].some((v:any)=>v===JSON.stringify(draft))).toBe(true);h.unmount();
 });
 it('partial CSV plus TXT retains six imports, blocks missing title without inferring a song, then generates and regenerates corrected rows',async()=>{
  vi.useFakeTimers();const h=harness({eventId:null});await h.flush();await h.current.handleFiles([new File(['Artist,Song\nABBA,Dancing Queen\nThe Killers,Mr. Brightside\nKool & The Gang,Celebration\n,Only Title Test\nOnly Artist Test,'],'partial.csv'),new File(['Test Artist - Test Song - Live'],'live.txt')]);await h.flush();await h.current.generate();await h.flush();expect(h.current.result).toBe(null);expect(h.errors.some((e:string)=>e.includes('missing a song title'))).toBe(true);expect(h.requests).toHaveLength(0);expect(h.current.songs).toHaveLength(6);expect(h.current.songs.find((s:any)=>s.artist==='Only Artist Test').song).toBe('');
  const parsed=await dance.parseFile(new File(['Artist,Song\nABBA,Dancing Queen\nThe Killers,Mr. Brightside\nKool & The Gang,Celebration\n,Only Title Test\nOnly Artist Test,'],'partial.csv'));h.current.setSongs([...parsed.map(s=>s.artist==='Only Artist Test'?{...s,song:'Corrected Song'}:s),song]);await h.flush();await h.current.generate();await h.flush();expect([...h.current.result.warmUp,...h.current.result.transition,...h.current.result.peak]).toHaveLength(6);expect(JSON.stringify(h.current.result)).toContain('Test Song - Live');await h.current.generate();await h.flush();expect([...h.current.result.warmUp,...h.current.result.transition,...h.current.result.peak]).toHaveLength(6);await h.current.exportAllZip();expect(h.files.filter((f:any)=>f.name.endsWith('.csv')).map((f:any)=>f.data).join('')).toContain('Corrected Song');h.unmount();
 });
 it('conflict-time edits survive leave/reload in a separate slot without replacing the original or crossing accounts',async()=>{
  vi.useFakeTimers();const remote=row(), marker=crypto.randomUUID();const conflict={version:1,account:'owner',event:'A',token:'original',createId:'create',baseVersion:'old',baseRevision:null,writeRevision:marker,snapshot:{name:'Conflict',inputs:{...remote.inputs,eventName:'Conflict'},lists:remote.lists},savedAt:1};
  const memory=new Map([[storageKey(),JSON.stringify(conflict)]]);const h=harness({rows:{A:remote},memory});await h.flush();h.edit('New edit while conflicting');expect(h.leave()).toBe(false);h.switchTo('other','A');await h.flush();expect(h.current.recovery).toBe(null);expect(memory.get(storageKey())).toBe(JSON.stringify(conflict));h.unmount();
  const b=harness({rows:{A:remote},memory});await b.flush();expect(b.current.recovery.snapshot.inputs.eventName).toBe('New edit while conflicting');expect(b.requests).toHaveLength(0);b.unmount();
 });
 it('offline edited recovery remains through reopen and is not reconciled against a newer remote',async()=>{
  vi.useFakeTimers();const memory=new Map(), rows:any={A:row()};const h=harness({memory,rows,write:async()=>{throw Error('offline');}});await h.flush();h.edit('Offline title');await vi.advanceTimersByTimeAsync(1000);await h.flush();expect(h.current.saveState).toBe('error');h.leave();h.unmount();
  rows.A={...row(),inputs:revisions.withEventRevision({...row().inputs,eventName:'New remote title'},crypto.randomUUID())};const b=harness({memory,rows});await b.flush();expect(b.current.recovery.snapshot.inputs.eventName).toBe('Offline title');expect(b.requests).toHaveLength(0);expect(memory.has(storageKey())).toBe(true);b.unmount();
 });
 it('explicit exact-path selection approves the intentionally chosen recording but unconfirmed extras cannot leak',async()=>{
  const h=harness({rows:{A:row({[key]:{paths:[track.filePath,'/mock/Extra.mp3'],confirmed:false}})}});await h.flush();h.library(vdj.buildLibrary([track,{...track,filePath:'/mock/Extra.mp3'}]));await h.flush();await h.current.exportAllZip();expect(h.files.some((f:any)=>f.name.endsWith('.m3u'))).toBe(false);
  const sec=h.nodes().find((n:any)=>n.props?.onChoose);sec.props.onChoose(key,1);h.render();await h.flush();await h.current.exportAllZip();expect(h.files.findLast((f:any)=>f.name.endsWith('.m3u')).data).toContain('/mock/Extra.mp3');h.unmount();
 });
 it('trusted automatic match survives saved confirmation and reference exclusion still retains intended song',async()=>{
  const own={filePath:'/mock/Correct.mp3',artist:song.artist,title:song.song};const h=harness({rows:{A:row({[key]:{paths:[own.filePath],confirmed:true,excluded:true}})}});await h.flush();h.library(vdj.buildLibrary([own]));await h.flush();await h.current.exportAllZip();expect(h.files.some((f:any)=>f.name.endsWith('.m3u'))).toBe(false);expect(h.files.find((f:any)=>f.name.endsWith('.txt')).data).toContain(song.song);expect(h.requests).toHaveLength(0);h.unmount();
 });
 it.each([undefined,{warmUp:3,transition:5,peak:7}])('quarter hour 2x generation/restore/live targets agree with split %j',async split=>{
  vi.useFakeTimers();const h=harness({rows:{A:row({},split?{split}:{})}});await h.flush();expect(h.current.result.targetTotal).toBe(split?10:12);expect(h.current.liveTargets.total).toBe(h.current.result.targetTotal);if(!split)expect(h.current.result.perSectionTarget).toBe(4);const before=h.current.result;await h.current.generate();await h.flush();expect(h.current.result.targetTotal).toBe(before.targetTotal);expect(h.current.result.sectionTargets).toEqual(before.sectionTargets);h.unmount();
 });
 it.each(['cocktail','dinner'])('%s live, generated and restored targets agree',async listType=>{
  vi.useFakeTimers();const h=harness({rows:{A:row({},{listType,minutes:'15'})}});await h.flush();expect(h.current.result.targetTotal).toBe(5);expect(h.current.liveTargets.total).toBe(5);await h.current.generate();await h.flush();expect(h.current.result.targetTotal).toBe(5);expect(h.current.result.perSectionTarget).toBe(5);h.unmount();
 });
});
