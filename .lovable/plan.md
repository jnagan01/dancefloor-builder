## Goal

In the per-song match panel (the inline search under each result row), add a **"Browse local file…"** button next to the search input so the user can pick any audio file from their computer and assign it as the match — without having to add a whole folder or fall back to "Search full library".

## UX

In `InlineMatchSearch` (src/routes/index.tsx, ~line 2002), next to the search input and Reset chip:

- New button: **`Browse local file…`** (outline, small, with a `FolderOpen` icon).
- Clicking it opens a native file picker (`<input type="file" accept="audio/*" />`, hidden, triggered via ref).
- On select:
  - The file is appended to a dedicated "Manually picked files" library (created lazily on first pick, reused after).
  - The picked file's track becomes the match for that row (primary pick), replacing whatever was there.
  - A toast confirms: `Matched "<song>" → <file name>`.
- Empty/no-match state already says "No matches in library…" — append a hint: *"…or click Browse local file to pick one from your computer."*

## Caveats surfaced to the user

Browsers only expose a file's name (and, for folder picks, `webkitRelativePath`) — not an absolute path. The VirtualDJ XML export currently writes `filePath` derived from `webkitRelativePath`. For a manually picked single file we'll store the bare file name as `filePath`. Show a small muted note under the matched row when the source is a manual pick: *"Manual pick — VirtualDJ XML will reference the file name only; M3U export and in-app playback work normally."* (In-app preview works because the `File` object is kept in `audioSources` for `resolveLocalFile`.)

## Technical changes (single file: `src/routes/index.tsx`)

1. **New parent callback `pickLocalFileForMatch(key, file)`**
   - Builds a single-track entry via `tracksFromAudioFiles([file])`.
   - If a "manual picks" `AudioSource` (new `kind: "manual"` — or reuse `"folder"` with name `"Manually picked files"`) already exists, append the file to its `files` and rebuild its library; otherwise create one and push it to `libraries` / `librarySources` / `audioSources`, mirroring `addAudioFolder`.
   - Compute the merged library index of the newly added track and call `updateMatch(key, { status: "Matched", confidence: 1, trackIndex: newIdx, alternatives: [], extraTrackIndices: [] })`.
   - Re-run matches for other rows is **not** needed — only this row changes.

2. **`InlineMatchSearch` prop additions**
   - `onPickLocalFile: (file: File) => void`
   - Inside the component, add a hidden `<input type="file" accept="audio/*" ref={localFileRef} />` and a Button that triggers `localFileRef.current?.click()`. On change, call `onPickLocalFile(file)` then clear the input value.

3. **Wire-up at the call site (~line 1609)**
   - Pass `onPickLocalFile={(file) => pickLocalFileForMatch(key, file)}` alongside existing `onOpenSearch` / `onPick` props.

4. **Small import addition**: `FolderOpen` is already imported; no new icons needed.

## Out of scope

- The full-screen `Dialog` "Search library" (lines ~1624) keeps its current behavior; this plan adds local browsing to the inline panel only, since that's where the user asked.
- No changes to export logic, matching algorithm, or audio index plumbing beyond appending the new file to the existing `audioSources` array.