## Goal

Let the user upload a CSV/TXT file as the Do Not Play list instead of (or in addition to) typing entries by hand. Parsed entries merge with whatever is already in the textarea.

## Changes

### `src/routes/index.tsx` — Do Not Play section

- Add an **Upload file** button next to the "Do Not Play list" label, plus drag-and-drop on the textarea container.
- Accept `.csv` and `.txt` (same as the song uploader).
- Parser logic:
  - For `.txt`: one entry per line; reuse the existing `parseDoNotPlay` text format (`Artist - Song` or just `Artist`).
  - For `.csv`: use Papa Parse with header detection (reuse the helpers in `danceFloor.ts`). Detect Artist + Song columns (`artist`/`song`/`track`/`title`); if both present, format each row as `Artist - Song`. If only an Artist column, format as `Artist` (blocks all). Fall back to two-column headerless CSV (same heuristic as `parseCsv`).
- Append the parsed entries as newline-separated lines to the current `doNotPlayInput` state (de-duplicate identical lines, preserve user-typed entries on top).
- Toast: "Imported N do-not-play entries from {filename}". Error toast on empty/unparseable files.

### `src/lib/danceFloor.ts` — small helper

- Export a new `parseDoNotPlayFile(file: File): Promise<DoNotPlayEntry[]>` that:
  - Reads the file text.
  - For `.txt`, calls existing `parseDoNotPlay`.
  - For `.csv`, parses with Papa, picks artist/song columns using the existing `ARTIST_KEYS` / `SONG_KEYS` constants, and returns `DoNotPlayEntry[]`.
- Add a `doNotPlayEntriesToText(entries): string` helper so the UI can append normalized lines to the textarea.

### Tests — `tests/doNotPlayUpload.test.ts` (new)

- CSV with `Artist,Song` headers → returns one entry per row with both fields.
- CSV with only `Artist` header → returns artist-only entries (blocks all songs).
- TXT with mixed `Artist - Song` and bare `Artist` lines → matches existing `parseDoNotPlay` behavior.
- Empty file → returns `[]`.

## Out of scope

- Persisting do-not-play lists across sessions.
- A separate managed list UI (chips / table). The textarea remains the source of truth; upload just fills it.
- Changing how do-not-play interacts with expansion (already covered).