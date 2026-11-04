import type { LibrarySong } from '@/lib/songLibrary';
// Frozen fictional recordings, not user ratings or real songs. Source order is deliberately weak-first.
export const CLIENTS = Array.from({length:10},(_,i)=>({artist:`TEST Client ${i}`,song:`Request ${i}`}));
export const CATALOGUE: LibrarySong[] = Array.from({length:30},(_,i)=>({artist:`TEST Alternative ${String(i).padStart(2,'0')}`,song:`Recording ${i}`,genre:'Pop',decade:'1980s',energy:7,danceability:8,section:'Transition'}));
export const PROVIDERS = CATALOGUE.map((s,i)=>({artist:s.artist,song:s.song,energy:i<16?6:8,danceability:i<16?6:8,popularity:i<16?2:9,source:'ReccoBeats',prov:{energy:'provider',danceability:'provider',popularity:'provider'}}));
export const INPUTS = {songs:CLIENTS,hours:'1.5',buffer:1,listType:'dance',expand:true,eventName:'TEST candidate sourcing',artistsInput:'',genresInput:'',notes:'',doNotPlayInput:'',decades:['1980s'],eventFit:{avoidSlow:true,familiarity:'familiar'}};