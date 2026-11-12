/** Service-only shared cache. Loaded only after the RPC's authentication/validation boundary. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
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
      return data;
    },
    async upsert(rows) {
      const client = await getClient();
      const { error } = await client.from('song_metadata_cache')
        .upsert(rows, { onConflict: 'artist_key,song_key' });
      if (error) throw new EnrichCacheError();
    },
  };
}