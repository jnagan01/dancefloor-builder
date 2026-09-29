# Full file paths for music-folder songs

## What changes for you
- **Mac app:** "Connect music folder" opens the Finder chooser, and the app remembers the folder's full location (e.g. `/Users/joenagan/Music/!! MY MUSIC !!`). Every song from that folder is saved with its complete path, so exported .m3u playlists open in VirtualDJ without "file not found".
- **Browser:** browsers hide full folder locations for privacy. After connecting a folder, you'll see a "Full folder location" box in Settings (pre-filled suggestion like `/Users/you/Music/!! MY MUSIC !!`) — enter it once and it's saved per folder.
- If a folder's full location is unknown at export time, a warning names how many songs will have incomplete paths.
- Already-saved libraries get fixed automatically once the location is known (no re-scan needed).

## Technical section
- `desktop/main.cjs` + `preload.cjs`: new `fs:scan-music-folder` IPC — native dialog, recursive walk for audio files, returns `{ root, files: [{ absPath, relPath, name, size }] }`. Requires a new installer build.
- `src/lib/desktopBridge.ts`: `scanNativeMusicFolder()`.
- `WorkspaceContext.tsx`: in desktop use native scan (filePath = absolute path); keep File objects for playback by reading via the existing connect flow. Store `rootPath` per source (IndexedDB via `libraryStore`), with a setter used by Settings.
- `virtualDj.ts`: `resolveExportPath(track, rootPath)` joins root + relative path (dedupe the leading folder name, e.g. root ends with `!! MY MUSIC !!` and rel starts with it); used by `buildM3u`. Absolute paths untouched.
- Export in `events.new.tsx`: pass roots, show warning for unresolved relative paths.
- Tests: path joining (duplicate folder segment, trailing slash, Windows paths).
