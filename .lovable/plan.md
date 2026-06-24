## Goal

Decouple matching/export from the VirtualDJ `database.xml`. Any selected audio folder becomes a valid library source — its files can be matched against the generated set list and exported into the VirtualDJ MyLists folder as `.vdjfolder` / `.m3u`.

## Approach

1. **Treat folders as first-class libraries.** When a user adds an audio folder (`addAudioFolder`), synthesize `VdjTrack` entries directly from the files (artist/title parsed from `"Artist - Title.ext"` filename, `fileSize` from `File.size`, `filePath` from `webkitRelativePath` or `name`). Wrap with `buildLibrary` and register alongside XML-derived libraries.
2. **Unify the audio source list.** Drop the separate "VDJ source vs folder source" distinction in `AudioSource`; every source contributes both a `VdjLibrary` (for matching/export rows) and a `File[]` (for playback). XML-only sources keep `files: []`; folder-only sources keep a synthesized library.
3. **Matching pipeline stays the same.** `matchSong` already runs against `mergedLibrary` — once folder-derived tracks live in `libraries`, no XML is required for results to populate. Empty-library state stops blocking export buttons; we only require *some* library (XML or folder) to be present.
4. **Export.** `buildVirtualDjXml` / `buildM3u` already accept any `VdjLibrary` — they will emit `<song path=... />` using the folder's `webkitRelativePath`. Add a short disclaimer near the export buttons that paths from a browser-selected folder are relative basenames and VirtualDJ may require the folder to be added to its search paths the first time. The MyLists write target (`vdjDirHandle`) is unchanged.
5. **UI copy.** Rename "VirtualDJ library" section to "Music libraries"; relabel "Add database.xml" as optional. The empty state should say something like "Add a `database.xml` or any audio folder to match songs."
6. **Tests.** Extend `tests/virtualDj.ssr.test.ts` with a case that builds a library from File-like inputs (filename → artist/title) and asserts `matchSong` + `buildVirtualDjXml` produce a non-empty `<VirtualFolder>`.

## Technical Details

- New helper in `src/lib/virtualDj.ts`: `tracksFromAudioFiles(files: File[]): VdjTrack[]` reusing the filename split logic already in `audioMatch.ts` (`splitFileName` / `stripExt`). Export it so `index.tsx` can do `buildLibrary(tracksFromAudioFiles(files))` when a folder is added.
- `index.tsx`: when `addAudioFolder` runs, also push the synthesized library into `libraries` / `librarySources`; when `removeAudioSource` runs on a folder, remove the corresponding library entry too (track via a stable id).
- Export gating: replace `libraries.length === 0` checks with `mergedLibrary == null` checks (equivalent today, but explicit) and remove copy that implies an XML is required.
- No changes to `danceFloor.ts`, recommend functions, or playback (`PreviewPlayer` already resolves via `audioIndex`).

## Out of Scope

- Persisting library state across reloads.
- Reading ID3 tags from audio files (filename parsing only, matching existing behavior).
- Writing absolute Windows/macOS paths into the exported `.vdjfolder` (browser sandbox prevents this).
