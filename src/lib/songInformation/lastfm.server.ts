import { createEvidenceStorage, type EvidenceStorage } from './cache.server';
import { createEvidenceReuse, createSharedWork } from './reuse';
import { informationKey } from './schema';
import { parseSimilarBody } from '../prep/similarTracks';
import { parseCommunityTrackInfo, providerQueryTitle } from '../prep/communityEvidence';
const shared=createSharedWork();
/** Canonical exact-query endpoints. Details and generation share only validated compatible shapes. */
export async function similarEvidence(key:string,artist:string,title:string,end:number,fetcher:typeof fetch=fetch) {
  return createEvidenceReuse(createEvidenceStorage(),shared)('similar',informationKey('similar',artist,title,'30:exact'),async dispatch=>{
    const u=new URL('https://ws.audioscrobbler.com/2.0/');
    for(const [a,b] of Object.entries({method:'track.getsimilar',artist,track:title,autocorrect:'0',limit:'30',api_key:key,format:'json'}))u.searchParams.set(a,b);
    dispatch();
    const res=await fetcher(u,{signal:AbortSignal.timeout(6000),headers:{'User-Agent':'SetArchitect/1.2'}});
    if(!res.ok)throw Error('Similarity unavailable');const p=parseSimilarBody(await res.json(),30);
    if(p.status!=='ok'&&p.status!=='notFound')throw Error('Similarity unavailable');
    return {seed:{artist,title},status:p.status,similar:p.similar};
  },end);
}
export async function communityEvidence(key:string,artist:string,title:string,end:number,fetcher:typeof fetch=fetch,storage:EvidenceStorage=createEvidenceStorage()) {
  return createEvidenceReuse(storage,shared)('community',informationKey('community',artist,title),async dispatch=>{
    const u=new URL('https://ws.audioscrobbler.com/2.0/');
    for(const [a,b] of Object.entries({method:'track.getInfo',artist,track:providerQueryTitle(title),autocorrect:'0',api_key:key,format:'json'}))u.searchParams.set(a,b);
    dispatch();
    const res=await fetcher(u,{signal:AbortSignal.timeout(4000),headers:{'User-Agent':'SetArchitect/1.2'}});
    if(!res.ok)throw Error('Community information unavailable');
    const body=await res.json();if(typeof body.error==='number'&&body.error!==6)throw Error('Community information unavailable');
    const e=parseCommunityTrackInfo(body,artist,title);if(!e)throw Object.assign(Error('No usable community evidence'),{category:'none'});return e;
  },end);
}
