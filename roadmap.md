# Workspace rebuild
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
