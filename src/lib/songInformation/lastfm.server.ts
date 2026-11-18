import { createEvidenceStorage } from './cache.server';
import { createEvidenceReuse, createSharedWork } from './reuse';
import { informationKey } from './schema';
import { parseSimilarBody } from '../prep/similarTracks';
import { parseCommunityTrackInfo, providerQueryTitle } from '../prep/communityEvidence';
const shared=createSharedWork();
/** Canonical exact-query endpoints. Details and generation share only validated compatible shapes. */
export async function similarEvidence(key:string,artist:string,title:string,end:number,fetcher:typeof fetch=fetch) {
  return createEvidenceReuse(createEvidenceStorage(),shared)('similar',informationKey('similar',artist,title,'30:exact'),async()=>{
    const u=new URL('https://ws.audioscrobbler.com/2.0/');
    for(const [a,b] of Object.entries({method:'track.getsimilar',artist,track:title,autocorrect:'0',limit:'30',api_key:key,format:'json'}))u.searchParams.set(a,b);
    const res=await fetcher(u,{signal:AbortSignal.timeout(Math.max(1,Math.min(6000,end-Date.now()))),headers:{'User-Agent':'SetArchitect/1.2'}});
    if(!res.ok)throw Error('Similarity unavailable');const p=parseSimilarBody(await res.json(),30);
    if(p.status!=='ok'&&p.status!=='notFound')throw Error('Similarity unavailable');
    return {seed:{artist,title},status:p.status,similar:p.similar};
  },end);
}
export async function communityEvidence(key:string,artist:string,title:string,end:number,fetcher:typeof fetch=fetch) {
  return createEvidenceReuse(createEvidenceStorage(),shared)('community',informationKey('community',artist,title),async()=>{
    const u=new URL('https://ws.audioscrobbler.com/2.0/');
    for(const [a,b] of Object.entries({method:'track.getInfo',artist,track:providerQueryTitle(title),autocorrect:'0',api_key:key,format:'json'}))u.searchParams.set(a,b);
    const res=await fetcher(u,{signal:AbortSignal.timeout(Math.max(1,Math.min(4000,end-Date.now()))),headers:{'User-Agent':'SetArchitect/1.2'}});
    if(!res.ok)throw Error('Community information unavailable');
    const e=parseCommunityTrackInfo(await res.json(),artist,title);if(!e)throw Error('Community information unavailable');return e;
  },end);
}
