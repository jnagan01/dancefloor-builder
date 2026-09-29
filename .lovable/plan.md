# One "VirtualDJ folder" setting

## What changes for you
In **Settings › DJ software & folders**, the separate "VirtualDJ database" and "Choose export folder" controls are replaced by one **VirtualDJ Folder** block, styled like your reference:
- **Current folder** box showing the full location, e.g. `/Users/joenagan/Library/Application Support/VirtualDJ`
- Buttons: **Change folder**, **Use default**, **Refresh**
- Status line: "Database: 14,250 tracks · last synced …" and "Playlists save to: …/Playlists"

Once chosen, that one folder is used for both:
- **Reading** `database.xml` inside it for play counts, key, BPM, genre and year (Refresh re-reads it; it also syncs automatically after picking).
- **Exporting** .m3u/.txt playlists into its `Playlists` subfolder (created if missing), which is where VirtualDJ shows playlists in its browser.

**Use default** picks the standard location: `~/Library/Application Support/VirtualDJ` if it exists, otherwise `~/Documents/VirtualDJ`.

If `database.xml` isn't found in the chosen folder, you'll see a clear message ("No VirtualDJ database in that folder — pick the main VirtualDJ folder").

Your existing saved export folder / database path keep working until you pick the new one.

## Where it works
- **Mac app:** full support (reads and writes directly). Needs a new installer from **Build macOS app**.
- **Browser:** the same picker works where the browser allows folder access; the app reads `database.xml` and writes playlists through that folder. Protected Mac folders like Library may be refused by the browser — the Mac app is recommended.

## Technical section
- `desktop/main.cjs` / `preload.cjs`: `vdj:choose-root` (native dialog, validates `database.xml`), `vdj:default-root`; reuse `vdj:read-database` with `<root>/database.xml`; export writes via existing `fs:write-file` to `<root>/Playlists`.
- `desktopBridge.ts`: `chooseVdjRoot()`, `getDefaultVdjRoot()`.
- `WorkspaceContext.tsx`: replace `vdjPath` with `vdjRoot` (localStorage `dancefloor:vdjRoot`, migrate from old path by stripping `/database.xml`); `syncVirtualDj()` reads from root; expose `exportDir` handle for `Playlists`.
- Browser path: directory handle stored in `dirHandleStore`; read `database.xml` via `getFileHandle`, write via `getDirectoryHandle("Playlists", {create:true})`.
- `events.new.tsx`: `ensureExportFolder()` uses the VirtualDJ folder's Playlists handle; falls back to old saved export folder.
- `settings.tsx`: new VirtualDJ Folder block; remove separate database and export-folder controls.
