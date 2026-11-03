# Project architecture
- Subdirectories have their own `AGENTS.md`; read them first.
- Keep the event builder under `/events/new` and the authenticated workspace shell under `_authenticated/route.tsx`, because Home must be the default landing page without resetting event state on unrelated pages.
- Keep music source indexes in account-scoped IndexedDB; browsers must reconnect folders and the server never holds local audio.
- Keep event autosave in the owner-scoped `workflow_history` JSON snapshot, because old snapshots must stay readable.
- Use shared CSS tokens and one local-file waveform player.
- Keep app-only prep knowledge in the account-fenced `src/lib/prep` store, never in snapshots/audio, backed up as optional `prep`, so events stay readable.
- Use `freshEvent`, never profile defaults. Expansion-off never pads/truncates. Planning excludes DNP/missing titles/repeated identities, because estimates and allocation slots are not unique approved coverage.
- Route every same-row event writer through owner/id plus the reserved inputs revision marker compare-and-set; initialize missing legacy markers atomically with the observed timestamp, use fresh UUIDs per logical edit stable through retry/reload, and never put full JSON in URL filters, because timestamps and payload ABA are insufficient.
- Native scans replace sources atomically and keep saved tracks on failed/partial/empty rescans, because inaccessible folders must not erase indexes.
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
- Run the real event route in a fenced synthetic Electron profile before packaging; fixtures stub network/storage behind the shared `eventSchemas` save contract, so checks never reach user data or skip validation.

- Fence backup/restore after every asynchronous boundary using account-session generation and captured sources/roots; compute conflict previews with identity maps and bounded samples, because late operations must not mix account data or stall large libraries.
- Check both durable new-event recovery slots before backup restore, and capture section/song identity plus library/root mappings for export readiness and output, because native-only drafts and asynchronous path changes must never bypass preservation or availability checks.
- Reuse the read-only macOS regression workflow as a required release dependency; web-only changes trigger checks but not installer publication, because every release must pass the same gates.

- Apply appearance before first paint and share semantic theme tokens through a single provider; System alone follows OS changes, because SSR and every workspace surface must agree.
- Read sidebar installed versions from the bridged Electron app identity (or explicit currentVersion), never updater status.version; label browser versions separately because available updates are not installed versions.
- Compare web builds only by `__APP_BUILD_ID__` via no-store `/api/public/version`, never HTML meta/semver/time, because only the deployed worker knows the live build.
- Parse VirtualDJ database.xml strictly first; on malformed XML or any DOCTYPE recover per Song block (strict block, then tolerant attributes decoding only predefined/numeric references) and skip/report unsafe paths, because one damaged entry must not discard every track's metadata nor invent file identities.

- Share preparation policy evidence and intended-version resolution through desktop/offline/policy.cjs; optional inputs preserve legacy passive loads and policy-bearing backups use format v2, because old offline shells must reject rather than ignore clean restrictions.
- Gate policy activation, recovery and saves on the installed desktop's explicit preparation capability; keep legacy inputs absent, because old-shell v1 backup validation must remain usable for the mandatory fresh-backup update path.
- Export from captured exact selections and policy without padding or regeneration; count terminal omission reasons per selected recording including extras, because intended exclusions are not unmatched files.
- Derive match displays from shared selected-row export classification and TXT confirmation/post-check messages from the captured verified report; acquire gesture-bound folder access before asynchronous verification and distinguish row counts from eligible files, because mixed extras and exclusions must not appear fully matched.
- Keep matching eligibility separate from expansion eligibility and never refill from raw library order; requested seasonal tracks need clean matching and constrained empty pools must remain honest gaps.
- Keep saved keys unchanged; dedupe automatic additions with one AdditionKeySet (whole primary + full credit set) everywhere, promoting exact owned files order-independently and require explicit occurrence exclusions for repeated combined DJ export, because requests and legacy snapshots must stay intact.
- Derive section coverage from export readiness's unique case-sensitive files, separate event/buffer minutes, and cap artist/title mismatches in search fallback scores, because repeated minutes and cross-field tokens are not evidence.
- Gate automatic expansion on this owner's READY prep knowledge (await queued writes); isolate providers; keep per-attribute metadata provenance (verified outranks AI; strict limits need verified values), because requests stay unfiltered and estimates are not evidence.
- Rank pooled candidates once via `rankPool`; optional `inputs.eventFit` (none=no-op) uses only provenance-tagged track evidence; quality samples freeze context.
- Gather facts via `factsGather` before rankPool so rankWhy matches shown facts.
