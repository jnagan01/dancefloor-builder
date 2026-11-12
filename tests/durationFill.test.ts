import {it,expect} from 'vitest';
import {durationTotals,fillRankedDuration} from '@/lib/prep/durationFill';
import {generateLists,type ResultSong} from '@/lib/danceFloor';
const base=()=>generateLists({uploaded:[],hours:1,buffer:1,expand:false,prefs:{artists:[],genres:[],decades:[],notes:''}});
const row=(artist:string,song:string):ResultSong=>({artist,song,fromUpload:false});
it('duration accounting never counts unknown lengths or repeated exact files across sections',()=>{const r=base();r.warmUp=[row('A','one'),row('B','unknown')];r.peak=[row('C','repeat')];expect(durationTotals(r,s=>[{identity:s.song==='unknown'?'unknown':'same',seconds:s.song==='unknown'?NaN:180}])).toEqual({warmUp:180,transition:0,peak:0});});
it('tentative/unlinked review rows cannot stop eligible known files, aliases and shared file paths do not count twice',()=>{const candidates=[row('Review','unknown'),row('Lead feat. Guest','Song'),row('Guest & Lead','Song'),row('Other','Different'),row('Fresh','New')];const files=(s:ResultSong)=>s.artist==='Review'?[]:[{identity:s.song==='Different'?'Song':s.song,seconds:120}];const r=fillRankedDuration(base(),candidates.map(row=>({row})),{warmUp:120,transition:120,peak:0},files,s=>files(s)[0]?.identity,{warmUp:3,transition:3,peak:0});expect(durationTotals(r,files)).toEqual({warmUp:120,transition:120,peak:0});expect([...r.warmUp,...r.transition].map(s=>s.artist)).toEqual(['Lead feat. Guest','Fresh']);});
it('no eligible files stays honest bounded review; a surplus never covers another section',()=>{const r=base();r.warmUp=[row('Client','long')];r.warmUp[0].fromUpload=true;const files=(s:ResultSong)=>s.fromUpload?[{identity:'client',seconds:9999}]:[];const next=fillRankedDuration(r,Array.from({length:100},(_,i)=>({row:row(`Artist ${i}`,`Song ${i}`)})),{warmUp:60,transition:120,peak:0},files,()=>undefined,{warmUp:3,transition:2,peak:0});expect(next.transition).toHaveLength(2);expect(next.warmUp).toEqual(r.warmUp);expect(durationTotals(next,files)).toEqual({warmUp:9999,transition:0,peak:0});});
it('known energy roles allocate warm/transition/peak before ranked high-energy overflow without moving requests',()=>{
 const r=base();r.warmUp=[{...row('Client','request'),fromUpload:true}];
 const ranked=[9,9,8,8,6,6].map((energy,i)=>({row:{...row(`Artist ${i}`,`Song ${i}`),energy}}));
 const files=(s:ResultSong)=>s.fromUpload?[]:[{identity:s.song,seconds:120}];
 const next=fillRankedDuration(r,ranked,{warmUp:240,transition:240,peak:240},files,s=>s.song,{warmUp:0,transition:0,peak:0});
 expect(next.warmUp[0]).toEqual(r.warmUp[0]);expect(next.warmUp.slice(1).map(s=>s.energy)).toEqual([6,6]);expect(next.transition.map(s=>s.energy)).toEqual([8,8]);expect(next.peak.map(s=>s.energy)).toEqual([9,9]);
 expect(durationTotals(next,files)).toEqual({warmUp:240,transition:240,peak:240});
});
