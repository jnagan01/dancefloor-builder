## Goal

Remove the separate "Playback sources" UI. Any folder added for music matching is automatically used as the playback source — no second step.

## Changes (all in `src/routes/index.tsx`)

1. **Remove the entire "Playback sources" section** (lines ~1440–1492 inside the Step 5 card): the heading, the "Add folder" / "Use library #N" / "Rebuild index" buttons, the source list, and the index summary line.

2. **Drop the `addVdjSource` function** and the `kind: "vdj"` branch of `AudioSource`. `AudioSource` simplifies to just folder entries (id, name, files, libraryIndex). The `audioIndex` useMemo no longer needs the VDJ extras loop — it just builds from folder files.

3. **Keep `addAudioFolder` as-is** (already adds both a library and an audio source in one click). It stays wired to the existing "Add music folder" button in Step 5.

4. **Keep `removeAudioSource` for the folder case only**; invoke it from the library list in Step 5 so removing a folder library also removes its playback files (single source of truth).

5. **Surface index status inline in Step 5's library card** (the existing "Indexed N tracks from M sources" block): append a small line like "N audio files indexed for playback" when `audioIndex.files.length > 0`. No separate panel.

6. **Update the empty-state hint** under Step 5 to mention that adding a music folder also enables in-app playback; without a folder, ▶ falls back to a 30-second Apple Music preview.

7. **Remove now-unused imports/handlers** (`addVdjSource`, `rebuildAudioIndex` if unreferenced, `Database` icon if unused elsewhere).

## Out of scope

VirtualDJ `database.xml` and "Scan VirtualDJ folder" continue to work as match-only library sources (no playback files attached) — unchanged.