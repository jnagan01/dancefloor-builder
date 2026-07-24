# Enrich Song Metadata from Online Sources

## Goal
Replace VirtualDJ as the primary source of `energy`, `danceability`, `popularity`, `valence`, `genre`, and `year`. Pull that data from **ReccoBeats** (Spotify-derived audio features + popularity) and **MusicBrainz** (genre tags + release year). Keep VirtualDJ tags as an offline fallback. Fetch on generate — not on upload — so unused songs never cost network calls.

## Data sources

**ReccoBeats** — free, no API key, no auth. Public endpoints:
- `GET https://api.reccobeats.com/v1/track/search?q=<artist>+<title>` → track candidates with an internal id + Spotify id + popularity.
- `GET https://api.reccobeats.com/v1/track/{id}/audio-features` → energy, danceability, valence, tempo (BPM), key.
- Rate limit: ~1 request/second per IP. Batch with polite spacing.

**MusicBrainz** — free, no key, requires a descriptive `User-Agent`.
- `GET https://musicbrainz.org/ws/2/recording?query=artist:"X" AND recording:"Y"&fmt=json` → release year (`first-release-date`) + genre tags.
- Rate limit: 1 request/second. Same batching.

Both are fetched server-side from a new server function so keys, headers, and rate limits stay off the client.

## Changes

### 1. New server function: `src/lib/enrich.functions.ts`
`enrichSongs({ songs: [{ artist, song }] })` returns `[{ artist, song, energy, danceability, valence, popularity, bpm, camelot, genre, year, source: "reccobeats" | "musicbrainz" | "partial" | "none" }]`.
- Sequential per-song calls with a 1.1s spacer (respect both APIs).
- Parallel fan-out per song across ReccoBeats + MusicBrainz.
- Normalizes ReccoBeats' 0–1 features to the app's 1–10 scale (matches `intensityOf`).
- Converts musical key → Camelot via existing `src/lib/musicTheory.ts`.
- Small in-memory LRU (per request) keyed by normalized `artist|song` so retry loops don't refetch.
- Wrapped in `requireSupabaseAuth` — same auth posture as the AI recommender. Zod-validates input, caps batch at 200 songs per call, per-string max 300 chars.
- On any per-song failure, returns `source: "none"` for that entry and keeps going (never throws for the whole batch).

### 2. Persistent cache: new table `song_metadata_cache`
Avoid re-hitting ReccoBeats/MusicBrainz for the same song across workflows and users.
- Columns: `artist_key text`, `song_key text` (normalized via `normalizeKey`), features + genre + year + source + `fetched_at timestamptz`, PK on `(artist_key, song_key)`.
- RLS: `SELECT` for `authenticated`, no direct writes (server fn uses service role to upsert).
- `enrichSongs` reads cache first, only calls APIs for misses, upserts results.
- TTL: refetch anything older than 90 days on next miss (features can drift as popularity moves).

### 3. Wire into generation flow: `src/routes/_authenticated/index.tsx`
Current flow enriches uploads from VirtualDJ library tags in `generate()` before calling the AI recommender. Change order:
1. Build the uploaded song list as today.
2. **New step** — call `enrichSongs` for every uploaded song. Merge returned features onto the song objects.
3. For any song where the online source returned `source: "none"` (or partial), fall back to VirtualDJ library tag lookup (existing code path) to fill remaining gaps.
4. Anything still missing → keep the current `estimateEnergy` heuristic as the last-resort default (no change).
5. Pass the fully enriched `existing` list to the AI recommender (this already reads `energy/danceability/popularity/valence/genre/year/bpm/camelot`).
6. After AI returns suggestions, run `enrichSongs` on the AI picks too so section re-bucketing (`reorderForEnergyProgression`) uses real values, not the AI's self-reported guesses.

Show a small progress line in the existing loading state: "Enriching N songs from online sources…".

### 4. UI hints in `MetricsDetail`
Update the existing metrics tooltip to show a `Source: ReccoBeats + MusicBrainz` / `VirtualDJ` / `Estimated` line, replacing the current `metaSource` label. No new UI surface.

### 5. Tests
- `tests/enrich.test.ts` — unit test the normalization (0–1 → 1–10), Camelot conversion path, and cache-hit short-circuit with a mocked fetch.
- Extend `tests/workflowIsolation.test.ts` to confirm enriched features never carry across `workflowInstanceId` boundaries (cache is per song, not per workflow — still fine, but the workflow's `existing` array must be rebuilt from the current workflow only).

## Out of scope
- No new user-facing setting or API-key form (both sources are keyless).
- No change to the VirtualDJ export folder or local file matching — VirtualDJ stays useful for playback + export, just not as the primary metadata source.
- No historical backfill — cache warms as songs are generated.

## Verification
- `bunx vitest run` — new + existing tests pass.
- Manual: generate a 2-hour dance floor from ~30 uploaded songs with the VirtualDJ folder disconnected; confirm energy/danceability tooltips show real ReccoBeats values and section placement matches (high-energy tracks land in Peak).
- Manual: repeat with VirtualDJ folder connected but network offline (block requests in devtools) — confirm the fallback path fills features from VirtualDJ tags and generation still completes.

## Technical notes
- ReccoBeats search is fuzzy; pick the top result whose artist token-overlap ≥ 0.6 with the query artist to avoid mismatches (e.g. "Adele" vs "Adele Roberts").
- MusicBrainz `first-release-date` can be `YYYY` or `YYYY-MM-DD`; parse just the year.
- Both services must be called from the server (CORS + `User-Agent` requirement for MusicBrainz).
- `enrichSongs` runs inside the existing generation server-fn call, so no new client-side network activity.