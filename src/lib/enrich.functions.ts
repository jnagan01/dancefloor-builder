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
 * reads and upserts use the service-only cache adapter after authentication.
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
  .handler(async ({ data }) => {
    const { runEnrichment } = await import("./enrichPipeline.server");
    const { createEnrichCache } = await import("./enrichCache.server");
    return runEnrichment(data.songs, createEnrichCache(), { needPopularity: data.needPopularity });
  });
