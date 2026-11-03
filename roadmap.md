# Workspace rebuild
## Optional expansion and 1× baseline
- [ ] Review correction: suppress covered-event rounded allocation gaps without changing stored targets; assert all section tabs/results remain gap-free for 40 tracks before and after reopen.
- [x] Default/reset to 1× with expansion off; distinguish duration coverage from optional preparation using known lengths and honest estimates; no implicit background/preference-only filling.
- [x] Isolated enough/short uploads, voluntary expansion, 1× roundtrip/reset and unchanged legacy buffers; full unit/native/prep/offline/race suites passed. External macOS gate remains unchanged and pending external execution.
## Entirely blank fresh events
- [x] Central blank initializer/reset; removed profile event prefills, validated explicit required choices, preserved saved/recovery and app preferences.
- [x] Synthetic checks: 608 units, 31 native event checks, 19 preparation checks, 16 offline flows, 4 race checks; automatic compilation passed. External macOS gate unchanged and awaits external execution.
## Narrow offline export outcome wording
- [x] Separate eligible occurrences from completed exports; blocked/cancelled/failed/partial exports report zero, rollback leftovers remain explicitly named, readiness artifacts describe eligibility rather than claiming completion.
- [x] Local synthetic checks passed: 600 unit tests, 28 native event checks, 19 preparation checks, 16 real offline flows and 4 offline race checks; automatic compilation OK. Real renderer/output assertions cover success, duplicate block, cancellation, rollback and undeletable partial files.
- [x] Report revision and local counts; unchanged macOS gate includes the added tests. External macOS acceptance remains required; no user data, publication, release or install.
## Trial duplicate, ranking and section coverage improvements
- [x] Prevent automatic duplicates, expose explicit saved-occurrence resolution and block repeated combined DJ exports.
- [x] Rank intended artist/title/version agreement without cross-field false confidence.
- [x] Display usable unique section lengths against configured event and buffer targets.
- [x] Audited keyword fallback confidence/reasons: every candidate uses artist/title pair confidence, broad free-text relevance remains separate; forced filename-discovery unit/native UI regressions pass.
- [x] Local synthetic gates: 599 units, 28 native event, 19 preparation UI, 14 offline and 4 offline race checks passed; automatic compilation OK. Previous missing-candidate failure was a fixture discovery miss, not hidden UI or high confidence.
- [ ] External macOS acceptance remains required; no publishing/release/install or actual-user access.
## Authorized preparation policies
- [x] Verify direct TXT before confirmation; captured report shared across dialog/messages/artifact, cancellation and failed checks write nothing; 587 unit tests, 26 native event checks and 18 preparation checks passed, automatic compilation OK; external macOS acceptance pending.
- [x] Align verified export warnings and policy-aware row displays; 581 unit tests, 25 native event checks and 18 preparation checks passed in isolated synthetic profiles; automatic compilation OK, external macOS acceptance pending.
- [x] Per-section native M3U/TXT success summaries use captured verified availability and counts; 24 native checks and 580 unit tests passed using synthetic fixtures only.
- [x] Review corrections: remove unsafe local refill, match requested holiday clean versions independently of expansion, align dashboard eligible extras with export.
- [x] Diagnose clean-export failure with UI/IPC/artifacts; gate unsupported desktop policy activation before save and verify legacy backup/update.
- [x] Better expansion: compatible owned-only/seasonal controls, exact intended versions, honest gaps, all addition paths.
- [x] Event-wide clean requirement: preserved selections, fail-closed approval/export/readiness, offline capability gate.
- [x] Shared export count/reason wording, including extras and written outputs.
- [x] Synthetic unit and real Electron event/prep/offline/race/31,250-track/legacy roundtrips; retain macOS gate.
- [x] Report changed files, local results, revision and unverified macOS gate; no publication or user data access.
- [ ] Final macOS acceptance: requires the external GitHub/macOS runner; local Linux suites and automatic compilation passed.

- [x] Refine authenticated workspace to the approved noir-champagne direction.
- [x] Add Home, Events, Library, Settings, Updates navigation and account-scoped library.
- [x] Reorder event steps, add adjustable buffer and optional Spotify public link.
- [x] Make folder-only matches, inline match controls, per-list review and bottom local player.
- [x] Autosave one event and restore choices; add export formats and update checks.
- [x] Validate core flows and build diagnostics.

# Reviewed high-priority fixes
- [x] Recover and serialize event autosaves with event-boundary isolation and mocked regression tests.
- [x] Fail incomplete desktop scans and preserve existing source tracks, with mocked filesystem tests.
- [x] Enforce exact desktop origin/main-frame IPC, navigation and requester permission checks, with regression tests.
- [x] Run regressions and inspect harness typecheck/build results; report revision and any existing failures. No publishing, releases, migrations or production/data mutations.

# Reviewed file-identity fixes
- [x] Make playback and tag resolution exact-path first, with globally safe legacy fallback.
- [x] Preserve duplicate-named folder identities, saved selections, and export locations.
- [x] Match VirtualDJ and rescan metadata by exact track identity.
- [x] Run mock regressions and the full suite; inspect automatic build/typecheck and report changed files/revision.

# Stress-test repairs
- [x] Identity/revision-safe tag callbacks and scan/edit reconciliation.
- [x] Bounded, conflict-safe autosaves and account/event-scoped durable recovery with navigation protection.
- [x] Partial CSV/TXT preservation, root/library/snapshot validation and visible storage failures.
- [x] Bounded duration validation and preflight-safe newline handling for every DJ export.
- [x] Linear browser scan buckets, shared native merge indexes, cached native/audio identities and single library construction.
- [x] Tracked regressions for every finding, full suite and automatic build checks, isolated mock flow and monitored benchmarks. Real Mac/live server operations intentionally not exercised.

# Independent recovery review
- [x] Correct save-as-new, stable creation IDs, account/event boundaries and malformed-draft lockout with actual route regressions.
- [x] Prevent opening-time writes and invalid legacy calculations; harden conditional writes with original-payload comparison because the existing database trigger overrides proposed timestamps. Strict database token monotonicity remains migration-constrained.
- [x] Preserve tag completion during scans and fail closed on null library records/migration failures.
- [x] Run full regressions and inspect automatic build; report any constraint-limited guarantees. Only mocked services/files were exercised.

# Compact event revisions
- [x] Replace full-payload filters with unique compact markers; cover legacy initialization, ABA, and large snapshots.
- [x] Carry marker lifecycle through pending autosaves, durable drafts, recovery, creation and other event writers.
- [x] Run full tests, automatic build diagnostics and existing isolated adversarial checks; report revision and limits. Live data and Mac operations were not exercised.

# Dirty-state regression
- [x] Remove broad capture, mark actual changed persisted controls and song changes, and baseline passive restoration.
- [x] Verify actual benign UI handlers, Retry, immediate edits, full suite/build and adversarial checks. Existing review has no manual move control; tested its actual rename/removal and regeneration paths without adding unrelated UI.

# Native UI review fixes
- [x] Require approved candidates in every DJ export and preserve intended reference songs.
- [x] Reconcile exact late-save recovery; preserve conflicting copies as backups.
- [x] Block incomplete-title generation explicitly, retaining import rows.
- [x] Unify generation, restoration and displayed targets; verify all four with isolated route regressions.

# Authorized six improvements
- [x] Coherent explicit bulk approvals and approved-only musical metadata, with route regressions.
- [x] Snapshot-bound export readiness, read-only availability and packaged reports.
- [x] Account-isolated versioned backups, required pre-rescan/update checkpoint and non-destructive preview/restore.
- [x] Isolated offline/crash/disk-failure checks with synthetic profiles and backend.
- [x] Release-blocking reusable read-only macos-15 gates; all twelve isolated Electron flows pass locally.
- [x] Full regression/adversarial/build checks and exact results/limits.

# Final six-improvement review
- [x] Fence backup/restore by captured account session and source/root revision; linear bounded conflict preview.
- [x] Real Electron crash/import/late-save/backup/update/partial-write flows with synthetic faults.
- [x] Consistent tracked locks, clean pinned frozen installs, read-only source/PR gates reused before release.
- [x] Full/native/adversarial/build validation and exact final results.

# External verification
- [ ] Confirm completion of the GitHub/macOS native job for the final revision; user reported run 41160767318 frozen installs/full suite passed, native job running. This sandbox cannot inspect GitHub.

# Final integration review
- [x] Preserve native-only new-event and pending-conflict drafts during backup restore, with native regression.
- [x] Bind readiness issues to songs, invalidate stale previews, and freeze export library/root paths across awaits.
- [x] Run full/native/adversarial checks and inspect automatic build results; report final revision.

# Build26 backup identifier regression
- [x] Context-aware shared browser/native private-field policy without modifying saved data.
- [x] Exact identifier, secret rejection, roundtrip, startup/rescan UI and native-store regressions.
- [x] Full and isolated Electron suites, automatic build/typecheck, final revision and updater limitation.

# Build28 deterministic native synchronization
- [x] Prove late commit with held reply, navigate, release and verify exact recovery reconciliation using observable waits.
- [x] Replace timing-sensitive backup-case waits; run full/native suites and report final revision without production operations.

## Appearance and guarded automatic Mac updates
- [x] Correct verbose signature capture and ZIP/DMG inner-app notarization gates; 417 full tests passed including five command-gate cases, workflow YAML/shell syntax verified, automatic build OK; Apple execution awaits GitHub.
- [x] Explicit startup update consent surfaces failures; uncertain staging retains lock with recovery guidance; 412 unit, 17 native (repeated), 49 adversarial checks and automatic build passed.
- [x] Incorporate exact uploaded RGBA icon at 1024 and matching favicon; lossless local ICNS roundtrip, source/ICNS/ZIP/DMG transparency release gates, 406 unit + 16 Electron + 49 adversarial checks passed, automatic build OK.
- [x] Locally persisted Light/Dark/System, first paint, system changes, semantic contrast and synthetic UI checks.
- [x] Pinned signed ZIP updater, explicit consent, fresh backup/draft preservation before Squirrel staging, quit/cancel/failure gates.
- [x] Monotonic semver and coherent signed ZIP/DMG/feed artifacts; retain macos-15 regression release prerequisite.
- [x] Full existing suite, isolated Electron, adversarial and automatic build checks.
- [ ] Signed macOS update/relaunch and release artifact execution (requires GitHub/macOS signing runner; no live installs allowed here).
