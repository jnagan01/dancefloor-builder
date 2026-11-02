# Project architecture
- Subdirectories have their own `AGENTS.md`; read them before changing files there.
- Keep the event builder under `/events/new` and the authenticated workspace shell under `_authenticated/route.tsx`, because Home must be the default landing page without resetting event state on unrelated pages.
- Keep selected music source indexes in account-scoped IndexedDB; browser file access requires reconnecting folders and server storage must not hold local audio files.
- Keep event autosave in the owner-scoped `workflow_history` JSON snapshot, because old snapshots must stay readable.
- Keep workspace colors and typography in shared semantic CSS tokens and reuse the same local-file waveform player for library and event review, because visual changes must remain consistent without changing playback behavior.
- Read and write song metadata tags only inside the Mac app (desktop/tags.cjs via node-taglib-sharp, cached by size+mtime in userData), because browsers cannot modify local files and edits must land in the music files themselves.
- Keep event-type presets in `src/lib/eventTypes.ts`, separate from vibes, and apply their era/explicit rules only to added songs in `reorderForEnergyProgression`, because client uploads must always stay in the list.
- Route every same-row event writer through owner/id plus the reserved inputs revision marker compare-and-set; initialize missing legacy markers atomically with the observed timestamp, use fresh UUIDs per logical edit stable through retry/reload, and never put full JSON in URL filters, because timestamps and payload ABA are insufficient.
- Treat native scans as atomic source replacements and retain saved tracks on failed, partial or unexpectedly empty rescans, because inaccessible folders must not erase library indexes.
- Use the shared case-sensitive file-identity index for playback, picked-file selection and metadata carry-forward; selected paths never fall through to another basename or scored song, because duplicate filenames may refer to different audio.
- Reserve existing source labels and root mappings, allocate new labels for different roots, and strip the virtual label on export; native rescans relabel atomically, because saved track references must keep their original disk identity.
- Keep account/event-scoped recovery copies until the exact latest save is confirmed, and block unsafe navigation/unload; restore is explicit and version-checked because a local draft must not silently overwrite a newer remote event.
- Key the entire event editor by captured account and route event identity; preserve its owned snapshot on cleanup before mounting another editor, and transfer recovery-as-new durably before navigation, because effect-only resets misattribute drafts.
- Reconcile tag callbacks and scans by case-sensitive identity plus session revision/generation, not positions; cache identity-only indexes separately from metadata-aware library subjects because edits must not redirect files or rebuild audio unnecessarily.
- Validate persisted roots, source indexes and snapshots without writing sanitized replacements over corrupted originals; keep older out-of-range snapshots read-only and fail exports before any writes when paths cannot be represented safely.
- Mark event dirty only at changed persisted-value mutations, not root click/change capture; passive restore/matching sets the read baseline and Retry/view/playback controls do not change save revisions.

- Require explicit approval for tentative/restored uncertain file candidates in every DJ playlist exporter; reference files retain intended songs, because a candidate path is not consent to export a different recording.
- Reconcile recovery only with both the unique write marker and semantic snapshot equality; keep conflict-time edits in a separate owned recovery slot and archive conflicts explicitly, because late saves must not force duplicates or discard new edits.
- Use generateLists for dance target rounding in restore and display and block missing-title uploads before full generation, because partial imports must never become invented songs or silently disappear.

- Keep backup imports additive and account-scoped; share the JSON private-field policy across browser/native validators, distinguish dictionary IDs from properties, and require backups before rescans/updates to preserve recoverability.
- Run the real event route in a fenced synthetic Electron profile before packaging, stubbing network/storage only in fixtures, so release checks never reach user data.

- Fence backup/restore after every asynchronous boundary using account-session generation and captured sources/roots; compute conflict previews with identity maps and bounded samples, because late operations must not mix account data or stall large libraries.
- Mirror native event recovery in an fsynced, account/event-key-hashed journal behind exact-origin main-frame IPC; keep existing browser recovery keys, because Chromium localStorage alone did not survive an abrupt process kill.
- Check both durable new-event recovery slots before backup restore, and capture section/song identity plus library/root mappings for export readiness and output, because native-only drafts and asynchronous path changes must never bypass preservation or availability checks.
- Reuse the read-only macOS regression workflow as a required release dependency; web-only changes trigger checks but not installer publication, because every release must pass the same synthetic gates.

- Apply appearance before first paint and share semantic theme tokens through a single provider; System alone follows OS changes, because SSR and every workspace surface must agree.
- Read sidebar installed versions from the bridged Electron app identity (or explicit currentVersion), never updater status.version; label browser versions separately because available updates are not installed versions.
- Compare web builds only by `__APP_BUILD_ID__` via no-store `/api/public/version`, never HTML meta/semver/time, because only the deployed worker knows what refresh loads.
