import {it,expect} from 'vitest';
import {catalogueCandidates,generateLists,type Preferences} from '@/lib/danceFloor';
import {createCandidatePool} from '@/lib/prep/candidatePool';
import {rowCandidate} from '@/lib/prep/expansionRanking';
import {strictLimitFailure,mergeMeta} from '@/lib/prep/provenance';
import {songIdentity} from '@/lib/prep/knowledge';
import {evaluateFit} from '@/lib/prep/eventFit';
import {CATALOGUE,CLIENTS} from './fit/candidateStageFixture';
const prefs:Preferences={artists:[],genres:[],decades:[],notes:''};
it('complete candidates exceed 14 slots, preserve natural section and curated fields without inventing a year',()=>{
 const rows=catalogueCandidates({uploaded:CLIENTS,prefs,expand:true},CATALOGUE);
 expect(rows).toHaveLength(30);expect(rows[29]).toMatchObject({prefer:'transition',row:{energy:7,danceability:8,genre:'Pop',catalogueDecade:'1980s',naturalSection:'Transition',metaProv:{energy:'catalogue',danceability:'catalogue',genre:'catalogue'}}});
 expect(rows[29].row.year).toBeUndefined();expect(rowCandidate(rows[29].row,'catalogue').facts).toMatchObject({decade:'1980s',decadeSource:'catalogue',genreSource:'catalogue'});
 expect(strictLimitFailure(rows[29].row,{decades:['1980s']})).toBeNull();expect(strictLimitFailure(rows[29].row,{decades:['1990s']})).toBe('decade');expect(strictLimitFailure(rows[29].row,{bpmRange:[100,130]})).toBe('bpm');
});
it('DNP, event era, policy callback, requests and expansion-off are shared eligibility, not padding',()=>{
 const source=[...CATALOGUE,{...CATALOGUE[0],artist:'Old',song:'Old',decade:'1970s'},{...CATALOGUE[0],artist:'',song:''}];
 const rows=catalogueCandidates({uploaded:[CATALOGUE[0]],expand:true,prefs:{...prefs,eventType:'wedding_modern',doNotPlay:[{artist:CATALOGUE[1].artist,song:CATALOGUE[1].song}],additionAllowed:s=>s.artist!==CATALOGUE[2].artist}},source);
 expect(rows).toEqual([]); // all 1980s and 1970s too old for this event
 const admitted=catalogueCandidates({uploaded:[CATALOGUE[0]],expand:true,prefs:{...prefs,doNotPlay:[CATALOGUE[1]],additionAllowed:s=>s.artist!==CATALOGUE[2].artist}},source);
 expect(admitted).toHaveLength(28);expect(admitted.some(c=>[0,1,2].some(i=>c.row.artist===CATALOGUE[i].artist))).toBe(false);
 expect(catalogueCandidates({uploaded:[],expand:false,prefs},source)).toEqual([]);
 const off=generateLists({uploaded:CLIENTS,prefs,hours:0.1,buffer:1,expand:false,preserveRequestedRows:true});expect([...off.warmUp,...off.transition,...off.peak]).toHaveLength(10);
});
it('bounded deterministic admission reserves catalogue even when it arrives last; exact owned facts win in either order',()=>{
 const cat=CATALOGUE.slice(0,3).map(s=>({...s,catalogueDecade:s.decade,metaProv:{energy:'catalogue' as const,danceability:'catalogue' as const,genre:'catalogue' as const}}));
 const found=Array.from({length:20},(_,i)=>({artist:`Discovered ${i}`,song:'Unknown'}));
 const run=(rows:any[])=>{const p=createCandidatePool<any,string>({cap:5,taken:()=>false,identity:songIdentity,sectionRank:()=>0,admissionKey:r=>`${r.artist.startsWith('TEST Alternative')?'0':'1'}:${songIdentity(r.artist,r.song)}`,exactOwned:r=>r.artist===cat[1].artist?4:undefined,ownedRow:()=>({artist:cat[1].artist,song:cat[1].song,genre:'Funk',metaProv:{genre:'tags'}}),merge:(a,b)=>({...mergeMeta(a,b,b.metaProv??'estimate'),catalogueDecade:a.catalogueDecade??b.catalogueDecade})});rows.forEach(r=>p.offer(r));return [...p.map.values()].sort((a,b)=>a.row.artist.localeCompare(b.row.artist));};
 const a=run([...found,...cat]),b=run([...cat,...found.reverse()]);expect(a).toEqual(b);expect(a).toHaveLength(5);expect(a.filter(p=>p.row.artist.startsWith('TEST'))).toHaveLength(3);
 expect(a.find(p=>p.trackIdx===4)?.row).toMatchObject({genre:'Funk',energy:7,danceability:8,catalogueDecade:'1980s',metaProv:{genre:'tags',energy:'catalogue'}});
});
it('arbitrary remix has no standard catalogue familiarity and no-fit remains a no-op',()=>{
 const c={origin:'ai' as const,artist:'ABBA',song:'Dancing Queen (TEST Remix)'};
 expect(evaluateFit({familiarity:'familiar'},c).familiarEvidence).toBe(false);
 expect(evaluateFit(undefined,rowCandidate(catalogueCandidates({uploaded:[],prefs,expand:true},CATALOGUE)[0].row,'catalogue'))).toEqual({lines:[],familiarEvidence:false});
});