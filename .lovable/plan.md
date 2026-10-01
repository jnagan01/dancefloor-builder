# Dinner & Cocktail Hour Lists

## What you'll get
- **List type picker** as the first choice in New Event: **Dance floor**, **Cocktail hour**, or **Dinner**. Dance floor works exactly like it does today.
- For Cocktail and Dinner, the same steps stay: upload client songs (CSV/lists), favorite artists, genres, decades, do-not-play, and so on. Two differences:
  - You enter a **length in minutes** (e.g. 60 for cocktail hour, 90 for dinner) instead of a dance floor setup.
  - The result is **one list** (no Warm Up / Transition / Peak).
- **Steady mood:** the list keeps a relaxed, even feel from start to finish. No energy ramp, no club tracks.
- **Auto-fill to the time:** client songs go in first. If they don't add up to the length you chose, the existing engine adds similar songs (AI cluster + Last.fm + your library first) until the list covers at least that time.
- **Matches client taste:** fill-in songs stay close to the client's own artists, genres and decades.
- Review, matching to your files, and the VirtualDJ export (.m3u/.txt/CSV) work the same, using one list named after the event + "Cocktail Hour" or "Dinner".
- Saved events remember their type, so reopening one shows the right layout.

## How time is counted
- Uses each song's real length from your files or online song data. Songs with no known length count as about 3.5 minutes.
- The list stops once the total reaches the target (it can go a little over, never under, unless the engine runs out of good matches. In that case it shows how many minutes are missing).

## Technical details
- `events.new.tsx`: add `listType: "dance" | "cocktail" | "dinner"` and `targetMinutes` to inputs (also saved in the existing `workflow_history` snapshot; older snapshots default to `"dance"`). For non-dance types, keep the three section arrays but use only `warmUp` as the single list and hide the other two in the UI, so matching, export and autosave code paths are reused unchanged.
- Fill loop: replace the `perSectionTarget` count check with a duration check (sum of `durationSec`, fallback 210s) for the single list. Same crates-first pass, neighbor and Last.fm inputs, and AI batches.
- `recommend.functions.ts`: extend the section enum with `Cocktail` and `Dinner` guides (low-to-mid energy, low danceability is fine, warm valence, background-friendly, clean, no harsh drops). Skip the energy-ramp and "pre-1990 for Warm Up" rules for these types, and tell the model to stay tied to the client's artists/genres/decades.
- Sequencing: for non-dance lists, use a steady-mood order (smooth key/BPM neighbors, no ramp).
- Export: one playlist file per format; CSV stays two columns (Artist, Song).
- Tests: duration-fill stopping rule, snapshot backward compatibility, single-list export.
