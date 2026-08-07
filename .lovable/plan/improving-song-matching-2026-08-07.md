# Improving song matching

Matching happens in two places today, and each has gaps:

- `src/lib/virtualDj.ts` — `matchSong` / `searchLibrary`: matches a playlist song to a library track.
- `src/lib/audioMatch.ts` — `resolveAudioFile`: resolves a song to an actual audio file on disk for playback/export.

They use different normalizers and different scoring, so a song can match in one and fail in the other.

## Issues found

1. **First-hit wins, no ranking.** `resolveAudioFile` returns the first file in a bucket and the first substring hit in the flat scan. With multiple versions of a song (original, remix, live, radio edit), which one you get is effectively arbitrary and depends on folder scan order.
2. **Remix/version info is thrown away.** Normalization deletes everything in parentheses/brackets, so "Song (Club Mix)" and "Song" become identical. A remix file can silently be exported where the original was intended.
3. **Title index is polluted with artist names.** Both halves of an "Artist - Title" filename are pushed into `byTitleOnly`, so a song titled like an artist name matches the wrong file.
4. **No fuzzy fallback on the file resolver.** `virtualDj` has edit-distance scoring; `audioMatch` has none, so a single typo or a stray word means "no local file" even when the file is right there.
5. **Library candidate generation is artist-only.** `matchSong` only considers tracks by the same or a similar artist, and the similar-artist scan stops after an arbitrary 20 candidates in map order. A track filed under a different/misspelled artist is unreachable and results are not deterministic.
6. **No tie-breakers.** Nothing prefers the higher-quality/longer file, an exact-duration match, or a file already used elsewhere in the set.
7. **Search is slow on big libraries.** `searchLibrary` runs edit distance across every track on every keystroke.

## What to change

**One shared matching core** (new `src/lib/matchCore.ts`)
- Single normalizer used by both modules, returning `{ base, version, tokens }` — the version tag (remix / live / edit / extended / radio / acoustic / instrumental) is kept as a separate field instead of deleted.
- Token inverted index for candidate generation, so candidates come from title tokens as well as artist. Replaces the artist-only lookup and the arbitrary 20-candidate cutoff.
- Weighted score: title similarity (highest weight), artist similarity, version-tag agreement (a version mismatch is a penalty, not a rejection), plus small bonuses for exact token containment.
- Deterministic tie-break order: exact version match → larger file size → alphabetical path.

**File resolution (`audioMatch.ts`)**
- Rank all candidates with the shared scorer instead of returning the first hit; return the best above a confidence floor.
- Stop indexing artist names as titles.
- Add a fuzzy stage so near-misses resolve, with a floor low enough to help and high enough to avoid wrong files.
- Expose the score so the UI can mark a low-confidence file resolution rather than presenting it as certain.

**Library matching (`virtualDj.ts`)**
- Rebuild `matchSong` on the shared candidate generator and scorer; keep the existing `Matched` / `Possible Match` / `Multiple Matches` / `Missing From Library` statuses, driven by score bands and score separation between the top two candidates.
- Return the top ranked alternatives so the inline search list shows genuinely close options first.
- Build a token index once for `searchLibrary`, so typing filters against a candidate set instead of the whole library.

**Tests** (`tests/matching.test.ts`)
- Remix vs original picks the right file; version mismatch downranks but stays findable.
- Featuring/punctuation/accent variants resolve.
- Artist-named song title no longer matches the wrong file.
- Multiple identical candidates produce a stable, repeatable pick.
- `matchSong` finds a track whose artist is misspelled in the playlist.

## Notes

No changes to the export formats, the AI recommendation flow, or the profile/folder setup. Matching stays fully in the browser.
