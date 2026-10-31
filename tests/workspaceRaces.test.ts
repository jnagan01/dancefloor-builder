import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj';
import * as bridge from '@/lib/desktopBridge';
import * as audio from '@/lib/audioMatch';
import * as identity from '@/lib/fileIdentity';
import * as metadata from '@/lib/trackMetadataIdentity';
import * as cache from '@/lib/workspaceFileCache';
import * as safety from '@/lib/nativeScanSafety';
import * as workspaceIndexes from '@/lib/workspaceIndexes';
import * as trackRevisions from '@/lib/trackRevisions';
const require=createRequire(import.meta.url);
const {createHarnessModules}=require('./helpers/workspaceHarness.cjs');
const {harness,scan}=createHarnessModules({vdj,bridge,audio,identity,metadata,cache,safety,workspaceIndexes,trackRevisions});
const track=(filePath:string,title='Old')=>({filePath,artist:'A',title,bpm:'90'});
const tick=()=>new Promise(r=>setTimeout(r,0));
describe('actual workspace closures: findings 1 and 4',()=>{
 it('removal during native tag save never updates next source',async()=>{
  const h=harness([{label:'Music',tracks:[track('Music/Old.mp3')]},{label:'Other',tracks:[track('Other/Other.mp3','Other')]}]);
  vdj.setFolderRoot('Music','/mock/Music');const w=h.render();const p=w.saveTrackTags(0,0,{title:'Edited'});w.removeSource(0);h.pendingTags[0].resolve({ok:true,tags:{title:'Edited'}});await p;
  expect(h.render().sources[0].tracks[0].title).toBe('Other');
 });
 it('rescan removing selected file cannot redirect delayed tag result',async()=>{
  const h=harness([{label:'Music',tracks:[track('Music/Old.mp3'),track('Music/Other.mp3','Other')]}]);vdj.setFolderRoot('Music','/mock/Music');const w=h.render();const p=w.saveTrackTags(0,0,{title:'Edited'}),q=w.rescan();await tick();h.pendingScans[0].resolve(scan('/mock/Music','Other.mp3'));await q;h.pendingTags[0].resolve({ok:true,tags:{title:'Edited'}});await p;
  expect(h.render().sources[0].tracks[0].title).toBe('Other.mp3');
 });
 it('concurrent edits invalidate stale tag callback for same identity',async()=>{
  const h=harness([{label:'Music',tracks:[track('Music/Song.mp3')]}]);vdj.setFolderRoot('Music','/mock/Music');const w=h.render();const p=w.saveTrackTags(0,0,{title:'First'});w.editTrack(0,0,{title:'Second'});h.pendingTags[0].resolve({ok:true,tags:{title:'First'}});await p;expect(h.render().sources[0].tracks[0].title).toBe('Second');
 });
 it('preserves manual edit made after rescan begins',async()=>{
  const h=harness([{label:'Music',tracks:[track('Music/Song.mp3')]}]);vdj.setFolderRoot('Music','/mock/Music');const w=h.render();const p=w.rescan();await tick();w.editTrack(0,0,{title:'Manual',bpm:'133'});h.pendingScans[0].resolve(scan('/mock/Music'));await p;expect(h.render().sources[0].tracks[0]).toMatchObject({title:'Manual',bpm:'133'});
 });
 it('shares native old/VDJ indexes once across sources',async()=>{
  const h=harness([{label:'Music',tracks:[track('Music/Song.mp3')]},{label:'Other',tracks:[track('Other/Song.mp3')]}]);vdj.setFolderRoot('Music','/mock/Music');vdj.setFolderRoot('Other','/mock/Other');const p=h.render().rescan();await tick();h.pendingScans[0].resolve(scan('/mock/Music'));await tick();h.pendingScans[1].resolve(scan('/mock/Other'));await p;expect(h.resolverCalls).toHaveLength(2);expect(h.render().sources).toHaveLength(2);
 });
 it('preserves completed tag edits while a stale rescan is in flight',async()=>{
  const h=harness([{label:'Music',tracks:[track('Music/Song.mp3')]}]);vdj.setFolderRoot('Music','/mock/Music');const w=h.render();const scanPending=w.rescan();await tick();const tags=w.saveTrackTags(0,0,{title:'Tag edit'});h.pendingTags[0].resolve({ok:true,tags:{title:'Tag edit',bpm:'133'}});await tags;h.pendingScans[0].resolve(scan('/mock/Music'));await scanPending;expect(h.render().sources[0].tracks[0]).toMatchObject({title:'Tag edit',bpm:'133'});
 });
});
