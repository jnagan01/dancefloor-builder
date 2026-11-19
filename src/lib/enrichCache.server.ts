/** Service-only shared cache. Loaded only after the RPC's authentication/validation boundary. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { informationKey, MetadataSchema } from './songInformation/schema';
import { createEvidenceStorage } from './songInformation/cache.server';
import { EnrichCacheError, type EnrichDeps } from './enrichPipeline.server';

export function createEnrichCache(
  getClient: () => Promise<Pick<SupabaseClient<Database>, 'from'>> = async () =>
    (await import('@/integrations/supabase/client.server')).supabaseAdmin,
): Pick<EnrichDeps, 'readRows' | 'upsert'> {
  return {
    async readRows(artistKeys, songKeys) {
      const client = await getClient();
      const pairs=artistKeys.flatMap(artist=>songKeys.map(song=>({artist,song,key:informationKey('metadata',artist,song)})));
      const storage=createEvidenceStorage();
      const [exact,legacy]=await Promise.allSettled([
        storage.read(pairs.map(p=>p.key)),
        client.from('song_metadata_cache').select('artist_key, song_key, energy, danceability, valence, popularity, bpm, camelot, genre, year, source, fetched_at').in('artist_key',artistKeys).in('song_key',songKeys),
      ]);
      const rows: import('./enrichPipeline.server').CacheRow[]=[];
      if(exact.status==='fulfilled')for(const e of exact.value){
        const p=pairs.find(p=>p.key===e.key),parsed=MetadataSchema.safeParse(e.value);
        if(!p||!parsed.success)continue;
        const {encodeCacheSource}=await import('./prep/provenance');const v=parsed.data;
        rows.push({artist_key:p.artist,song_key:p.song,energy:v.energy??null,danceability:v.danceability??null,valence:v.valence??null,popularity:v.popularity??null,bpm:v.bpm??null,camelot:v.camelot??null,genre:v.genre??null,year:v.year??null,source:encodeCacheSource(v.source,v.prov??{}),updated:v.updated,checked:v.checked,...(v.missed?{missed:v.missed}:{}),fetched_at:new Date(e.at).toISOString()});
      }
      // Only literal legacy keys equal to requested keys are eligible. No stripped alias lookup.
      if(legacy.status==='fulfilled')for(const r of legacy.value.data??[])if(pairs.some(p=>p.artist===r.artist_key&&p.song===r.song_key)&&!rows.some(p=>p.artist_key===r.artist_key&&p.song_key===r.song_key))rows.push(r);
      if(exact.status==='rejected'||legacy.status==='rejected'||(legacy.status==='fulfilled'&&legacy.value.error))throw new EnrichCacheError(rows);
      return rows;
    },
    async upsert(rows) {
      const {decodeCacheSource}=await import('./prep/provenance');
      const storage=createEvidenceStorage();
      // One atomic value+dates write per exact identity; the database trigger merges concurrent field evidence.
      // Never rewrite ambiguous legacy rows and never serialize one sidecar behind another.
      const replies=await Promise.allSettled(rows.map(row=>{
        const {summary,prov}=decodeCacheSource(row.source,row);
        const value=Object.fromEntries(Object.entries({...row,artist:row.artist_key,song:row.song_key,source:summary==='ReccoBeats+AI'?'AI':summary,prov}).filter(([,v])=>v!==null));
        return storage.write({key:informationKey('metadata',row.artist_key,row.song_key),kind:'metadata',value,at:Date.parse(row.fetched_at)});
      }));
      if(replies.some(r=>r.status==='rejected'))throw new EnrichCacheError();
    },
  };
}
