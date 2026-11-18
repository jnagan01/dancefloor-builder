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
      const { data, error } = await client.from('song_metadata_cache')
        .select('artist_key, song_key, energy, danceability, valence, popularity, bpm, camelot, genre, year, source, fetched_at')
        .in('artist_key', artistKeys).in('song_key', songKeys);
      // A degraded read may still contain useful rows. Never log the provider payload.
      if (error) throw new EnrichCacheError(data);
      const keys = (data??[]).map(r=>informationKey('metadata',r.artist_key,r.song_key));
      if (!keys.length) return data;
      let evidence;
      try { evidence = await createEvidenceStorage().read(keys); } catch { throw new EnrichCacheError(data); }
      return (data??[]).map(r=>{
        const e=evidence.find(e=>e.key===informationKey('metadata',r.artist_key,r.song_key));
        const parsed=e?MetadataSchema.safeParse(e.value):null;
        return {...r,...(parsed?.success?{updated:parsed.data.updated}: {})};
      });
    },
    async upsert(rows) {
      const client = await getClient();
      const { error } = await client.from('song_metadata_cache')
        .upsert(rows.map(({updated,...row})=>row), { onConflict: 'artist_key,song_key' });
      if (error) throw new EnrichCacheError();
      const evidence = createEvidenceStorage();
      for (const row of rows) {
        const { decodeCacheSource } = await import('./prep/provenance');
        const {summary,prov}=decodeCacheSource(row.source,row);
        const value=Object.fromEntries(Object.entries({...row,artist:row.artist_key,song:row.song_key,source:summary,prov}).filter(([,v])=>v!==null));
        await evidence.write({key:informationKey('metadata',row.artist_key,row.song_key),kind:'metadata',value,at:Date.parse(row.fetched_at)});
      }
    },
  };
}