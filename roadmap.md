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
