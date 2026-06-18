## Goal

Today, when a section is short, expansion only pulls from the ~50-song hardcoded list in `src/lib/songLibrary.ts`. We'll replace that fallback with **Lovable AI–generated recommendations** based on your preferences, so suggestions aren't capped by the built-in catalog. Each suggested song will appear in the list with the existing inline library search underneath, so you can pick the matching file from your own DJ library.

## What changes

1. **New server function** `recommendSongsForSection` (`src/lib/recommend.functions.ts`)
   - Uses Lovable AI Gateway (`google/gemini-3-flash-preview`) via the AI SDK.
   - Inputs: section (`Warm Up` / `Transition` / `Peak`), count needed, user preferences (artists, genres, decades, notes), do-not-play list, and the artist+title of songs already in the list (to avoid duplicates).
   - Returns structured JSON: `[{ artist, song, genre, decade, energy (1-10), danceability (1-10), reason }]`.
   - Uses `Output.object` with a small Zod schema (keeps fields short to avoid Gemini schema limits).

2. **Update `generateLists` in `src/lib/danceFloor.ts`**
   - Change the `expand` branch to be `async` and call the new server function per section that's short.
   - Map AI results into the existing `Song` shape with `fromUpload: false`, inferred `audienceFit`, and computed `sectionScores`.
   - Fall back to the existing built-in library padding only if the AI call fails or returns too few items (graceful degradation).

3. **UI in `src/routes/index.tsx`**
   - The generate flow becomes async-aware (loading state already exists for generation; extend it to cover the AI call).
   - AI-suggested rows render exactly like library-padded rows today (artist/song/section/scores) and already get the inline top-10 library search beneath them — no separate UI needed. Add a small "AI suggestion" badge so you can tell them apart.

4. **Errors surfaced to UI**
   - 429 → "AI is busy, try again in a moment."
   - 402 → "Out of AI credits — add credits in Workspace settings."
   - Any other failure → silent fallback to built-in library padding, with a toast noting AI was unavailable.

## Out of scope

- No new tables; suggestions are not persisted separately (saved history already captures the final lists).
- No auto-matching to your uploaded library — you still click "Pick" in the inline search to attach a file.
- No change to the scoring/section-fit algorithm for uploaded songs.

## Technical notes

- Server function lives in `src/lib/recommend.functions.ts` (client-safe path), reads `LOVABLE_API_KEY` from `process.env` inside `.handler()`.
- Provider helper: new `src/lib/ai-gateway.server.ts` using `createLovableAiGatewayProvider` from the gateway pattern.
- `generateLists` becomes `async`; callers in `src/routes/index.tsx` already `await` it (verify and adjust). Tests in `tests/danceFloor.*` will be updated to either mock the recommender or assert behavior with `expand: false` / AI disabled.
