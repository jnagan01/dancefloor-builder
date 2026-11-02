# Isolated native release gate

## Reproduce

CI uses Node 24, Bun 1.3.5, Electron 33.4.11 and Playwright 1.56.1.

```sh
bun install --frozen-lockfile
bun install --cwd desktop --frozen-lockfile
bunx vitest run
node tests/native/run.mjs
```

On this Linux sandbox, the actual Electron invocation is:

```sh
LD_LIBRARY_PATH="$(printf '%s:' /nix/store/*/lib)" xvfb-run -a node tests/native/run.mjs
```

## What actually runs

The real event route, WorkspaceProvider, BackupSettings, matching/export/autosave/recovery modules, native backup store, fsynced recovery journal and update handoff run in Electron. Backend/auth/library inputs, installer download/open/dialog effects and filesystem failures are stubbed. No production profile/music access is permitted. Network requests outside the loopback fixture are blocked. Each run has a fenced temporary userData and synthetic library/backend.

Thirteen native flows assert: uncertain-song ZIP exclusion and intended reference text; relevant most-played approval and save; actual M3U/report artifacts; reopened targets; SIGKILL without beforeunload or graceful close, pending draft restore and no duplicates; mid-write ENOSPC preserving exact last-good bytes; first-write EACCES refusal; partial M3U failure with exact `Saved 1, failed 1` and no success; late-save navigation reconciliation; Settings preview/import, additive metadata conflicts and one-event-as-new; fresh pre-update snapshot plus rename failure preventing installer handoff; six-row missing-title block, correction, generation and CSV artifact readback.

The full suite additionally verifies account switches, same-account session ABA, library edits during restore, apply-time revalidation, duplicate/unsafe inputs, 31,250 conflicts with 100 samples, store write/rename faults and malformed recovery archival.

Synthetic screenshots and results go under ignored `test-results/native/`. The fixture bundles production controls without the app stylesheet, so screenshots prove controls/state, not styled layout parity.

## CI safety and remaining external verification

`native-regression.yml` runs read-only on relevant source/test/tooling pushes and PRs. The desktop release requires that same reusable workflow. Web-only changes do not trigger installer publication. Both text lockfiles are tracked and clean frozen installs passed with Bun 1.3.5.

GitHub execution was not available in the sandbox (no GitHub CLI/token); the macOS job was not run here. Local native tests ran Electron on Linux/Xvfb, not a Mac. Manual Mac verification remains necessary for real OS permissions, audio/tag operations, signed/notarized installer, actual installer open, provider login and large-library responsiveness. Installer network/open effects were synthetic; no installer was built, published or installed.

## Final integration review

Native backup preview now attempts restore with each native-only new/pending-edit draft and empty Chromium recovery storage, asserting exact journal bytes and unchanged backend bytes. The additional native flow exports a Transition section while root mappings change during availability, reads back the M3U and checked path artifact, clicks its omission from Warm Up, and verifies edits remove the preview.

Final local commands: `bunx vitest run` (352 tests); `LD_LIBRARY_PATH="$(printf '%s:' /nix/store/*/lib)" xvfb-run -a node tests/native/run.mjs` (13 flows); `NODE_PATH=/dev-server/node_modules bun /tmp/setarchitect-stress/adversarial.cjs` (33 checks) and the corresponding `more.cjs` (16 checks). The temporary legacy adversarial scripts were updated to expect current fail-closed rejection of invalid timing, newline paths and corrupt indexes, rather than their obsolete permissive behavior. Automatic build/typecheck reported build OK. No dependency installation or production operations occurred.

The user reported GitHub run 41160767318 frozen installs and full regression passing, with native execution still running. That run and final-revision macOS completion were not inspected here.

## Build26 identifier regression

The shared `desktop/backup-policy.json` differentiates snapshot selection/root/metadata identifiers from structural credential properties. The desktop package includes it. The fourteenth isolated Electron flow exercises real startup pre-rescan backup and manual rescan, Settings backup preview/download/import, native credential refusal preserving last-good bytes, and restore-as-new recovery. Exact reported selection keys and confirmed/uncertain values survive without a backend row change. Native store roundtrip/verifyAll and browser/native policy agreement are covered in the full suite.

Build26 may reject the required pre-update backup using its old validator; once the signed installer is available, a direct installer may be necessary. No backup requirement was bypassed. This work did not inspect production data, run installers, install dependencies, publish, or trigger GitHub jobs.

## Build28 deterministic synchronization

The late-save case arms a test-only IPC latch, polls the actual backend commit, and asserts its exact write revision while the reply remains held. It navigates away, verifies the durable recovery snapshot and revision, explicitly releases the reply, and reopens the event to assert automatic saved status, no recovery prompt, the latest name and no duplicate row. Backup preview/import/additive restore, startup/manual rescan, artifact download and restore-as-new use bounded observable waits instead of fixed sleeps. Production validators and CI gates are unchanged.

Local validation: `bunx vitest run` passed all 377 tests; `LD_LIBRARY_PATH="$(printf '%s:' /nix/store/*/lib)" xvfb-run -a node tests/native/run.mjs` passed all 14 isolated Electron flows. macOS execution for this revision remains a GitHub gate, not a locally verified result.

## Appearance and automatic update preservation

16 isolated Electron flows pass locally, preserving the original 14. The new automatic-update flow runs the production controller and real workspace/editor preservation hooks: a download latch keeps editing available, a newer edit is fsynced before the synthetic Squirrel handoff, backup rename failure prevents staging and releases editing, and cancellation never stages. Installer/network effects are synthetic; this does NOT verify macOS Squirrel signature verification, replacement, relaunch, or signed release artifacts.

Appearance uses actual shared CSS and controls. Checks cover System changes, explicit overrides, persistence after reload, desktop/390px layouts, chart/readiness screenshots and WCAG 4.5:1 semantic text/status/control-pair contrast in both themes. Screenshots are synthetic-only.

Pinned API inspection: official npm `electron-updater@6.6.2` `out/MacUpdater.js` / `.d.ts` and `out/AppUpdater.js`. `autoInstallOnAppQuit=false` prevents native `checkForUpdates()` inside `updateDownloaded`; `quitAndInstall()` first initiates Squirrel staging. Both auto-download and install-on-quit stay disabled; the renderer is frozen and a fresh backup plus synchronous native draft journal must succeed first. Ordinary beforeunload remains a veto; only an authorized preserved update accepts native unload. Staging errors keep editing frozen and block ordinary quit because Squirrel may already have staged. Force kill/OS shutdown cannot be prevented; durable recovery remains the fallback.

Release CI stamps `1.2.<workflow run number>` from base `1.2.0`, creates matching `v` tags, and retains DMG for legacy bootstrap alongside signed ZIP / latest-mac.yml / blockmaps. The required macos-15 synthetic job still precedes packaging. Read-only artifact checks validate checksums/version, Developer ID signature, stapled notarization and bundle identity before release. These Apple checks have not run locally. Old build26 can still block its pre-update backup; a direct signed installer may be needed. No safeguards are bypassed.

Commands: `bunx vitest run` (404/404); `LD_LIBRARY_PATH="$(printf '%s:' /nix/store/*/lib)" xvfb-run -a node tests/native/run.mjs` (16/16); `NODE_PATH=/dev-server/node_modules bun /tmp/setarchitect-stress/adversarial.cjs` (33/33) and `more.cjs` (16/16). Automatic preview build/typecheck: build OK. Dependency changes resolved with `bun install --lockfile-only --ignore-scripts`; no packages/live app were installed. Both tracked lockfiles agree with their manifests. Clean frozen installs with CI Bun 1.3.5 remain for GitHub (local Bun is 1.4.4).

The icon and production event/library data are unchanged. No publishing or GitHub execution was requested or performed.

## Offline workspace gate

`node tests/native/offline.mjs` launches the real `desktop/main.cjs` (via `fixtures/offline-entry.cjs`, which only answers native dialogs) in a fenced `setarchitect-offline-*` profile. Offline phases deny Chromium networking before launch and try the real published URL. A local stub page stands in for the signed-in origin only to call the real `electronOffline` preload API with a synthetic backup. `ELECTRON_BIN` may point at a pinned Electron 33.4.11 binary when `desktop/node_modules` is absent.

## Preparation UI acceptance (`tests/native/prep.mjs`)

Bundles the real Library page, filter panel, track details, event preparation panel and the real account-scoped prep store (IndexedDB) into a fenced `setarchitect-native-prep-*` Electron profile. Only loopback requests are allowed; MusicBrainz/Last.fm/crowd lookups, the workspace and the waveform player are local stand-ins with controllable delays. Backups go through the real browser validator and the real native `desktop/backups.cjs` store. It covers DOMParser SongLength parsing, filters/presets/reload, exact-file details and preview, notes/tags drafts, groups, overlapping/stale lookups, dashboard drilldowns, recommendation controls/tags/dismissals, shortlist/link/add-to-section/group copy, backup round-trip, cold restart and sign-out/account isolation, with desktop and 390px screenshots under `test-results/native/prep/`.

## Malformed VirtualDJ database recovery

`tests/native/fixtures/malformed-vdj.mjs` is a synthetic database with intact songs before and after damaged entries (control character, raw `<`, bare `&`, undeclared/DTD entities, unterminated path quote, invalid numeric reference), `&apos;`/`&amp;`/numeric entities, a genuine apostrophe and a same-basename copy in another folder. It is shared by `tests/vdjXmlRecovery.test.ts`, `tests/vdjSyncToast.test.ts` (actual workspace refresh with deferred React updates), `prep.mjs` (real Electron DOMParser equals the tolerant reader, no DTD expansion) and `run.mjs` (real `desktop/vdj-database.cjs` read → parse → merge → persisted index → event detail sheet, invalid later length keeps the old value, XML bytes unchanged).
