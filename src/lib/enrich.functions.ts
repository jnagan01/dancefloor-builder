/**
 * Song metadata enrichment from online sources.
 *
 * Sources (both keyless, public APIs):
 *  - ReccoBeats (https://reccobeats.com) — Spotify-derived audio features:
 *    energy, danceability, valence, popularity, tempo (BPM), musical key.
 *  - MusicBrainz (https://musicbrainz.org) — genre tags + release year.
 *
 * Results are cached in `public.song_metadata_cache` (keyed by normalized
 * artist + song) so repeat lookups across workflows and users skip the
 * network entirely. Cache TTL: 90 days.
 *
 * Auth: `requireSupabaseAuth` — same posture as the AI recommender. Cache
 * upserts use the service role since the SELECT policy is authenticated-
 * read only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  songs: z
    .array(
      z.object({
        artist: z.string().max(300),
        song: z.string().max(300),
      }),
    )
    .max(200),
  /** Active familiarity choice: warm cache rows without track popularity get one bounded upgrade lookup. */
  needPopularity: z.boolean().optional(),
});

export type { EnrichSource, EnrichedSong, EnrichStatus } from "./enrichPipeline.server";

export const enrichSongs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { runEnrichment } = await import("./enrichPipeline.server");
    return runEnrichment(data.songs, {
      async readRows(artistKeys, songKeys) {
        const { data: rows } = await context.supabase
          .from("song_metadata_cache")
          .select("artist_key, song_key, energy, danceability, valence, popularity, bpm, camelot, genre, year, source, fetched_at")
          .in("artist_key", artistKeys)
          .in("song_key", songKeys);
        return rows ?? null;
      },
      async upsert(rows) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("song_metadata_cache").upsert(rows, { onConflict: "artist_key,song_key" });
      },
    }, { needPopularity: data.needPopularity });
  });
