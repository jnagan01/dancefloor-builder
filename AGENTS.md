# Project architecture
- Keep the event builder under `/events/new` and the authenticated workspace shell under `_authenticated/route.tsx`, because Home must be the default landing page without resetting event state on unrelated pages.
- Keep selected music source indexes in account-scoped IndexedDB; browser file access requires reconnecting folders and server storage must not hold local audio files.
- Keep event autosave in the existing owner-scoped `workflow_history` JSON snapshot, because a new event table is unnecessary and old snapshots must remain readable.
- Keep workspace colors and typography in shared semantic CSS tokens and reuse the same local-file waveform player for library and event review, because visual changes must remain consistent without changing playback behavior.
- Read and write song metadata tags only inside the Mac app (desktop/tags.cjs via node-taglib-sharp, cached by size+mtime in userData), because browsers cannot modify local files and edits must land in the music files themselves.
- Keep event-type presets in `src/lib/eventTypes.ts`, separate from vibes, and apply their era/explicit rules only to added songs in `reorderForEnergyProgression`, because client uploads must always stay in the list.
