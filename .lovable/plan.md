# Do Not Play List

Add an exclusion list so the song-expansion step in `generateLists` never suggests unwanted artists or songs from the built-in library.

## UX

In `src/routes/index.tsx`, add a new "Do Not Play" card in the preferences area (next to artists/genres/decades):
- Textarea for free-form entries, one per line. Accepted formats:
  - `Artist - Song` (blocks that exact track)
  - `Artist` alone (blocks every song by that artist)
- Helper text explaining both formats.
- Persist with the rest of the prefs in localStorage (same pattern already used for prefs).
- Show a small count chip ("12 blocked") and an inline list of parsed entries with an × to remove individual ones.
- Also surface a "Block this song" / "Block this artist" button on each row of the Step 6 generated lists, so the user can ban a suggestion and regenerate.

## Logic

In `src/lib/danceFloor.ts`:
- Extend `Preferences` with `doNotPlay: { artist: string; song?: string }[]`.
- Add `parseDoNotPlay(text: string)` that splits on newlines and uses the same `" - "` / `" – "` separators as `guessArtistSong`.
- Add `isBlocked(artist, song, blocklist)` using `normalizeKey` for case/punctuation-insensitive match. Artist-only entries block all songs by that artist; artist+song entries block only that pair.
- In `generateLists`, when filtering `SONG_LIBRARY` candidates for expansion, also drop any candidate where `isBlocked(lib.artist, lib.song, prefs.doNotPlay)` is true.
- Do NOT filter `uploaded` songs — the user's own uploaded list is authoritative; blocklist only governs auto-expansion. (Call this out in helper text.)

## Files

- `src/lib/danceFloor.ts` — add types, parser, blocklist check, wire into expansion filter.
- `src/routes/index.tsx` — add Do Not Play textarea + chips in prefs, "Block" buttons on generated rows, persist field.

No backend or schema changes.
