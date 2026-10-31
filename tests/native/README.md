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

Twelve native flows assert: uncertain-song ZIP exclusion and intended reference text; relevant most-played approval and save; actual M3U/report artifacts; reopened targets; SIGKILL without beforeunload or graceful close, pending draft restore and no duplicates; mid-write ENOSPC preserving exact last-good bytes; first-write EACCES refusal; partial M3U failure with exact `Saved 1, failed 1` and no success; late-save navigation reconciliation; Settings preview/import, additive metadata conflicts and one-event-as-new; fresh pre-update snapshot plus rename failure preventing installer handoff; six-row missing-title block, correction, generation and CSV artifact readback.

The full suite additionally verifies account switches, same-account session ABA, library edits during restore, apply-time revalidation, duplicate/unsafe inputs, 31,250 conflicts with 100 samples, store write/rename faults and malformed recovery archival.

Synthetic screenshots and results go under ignored `test-results/native/`. The fixture bundles production controls without the app stylesheet, so screenshots prove controls/state, not styled layout parity.

## CI safety and remaining external verification

`native-regression.yml` runs read-only on relevant source/test/tooling pushes and PRs. The desktop release requires that same reusable workflow. Web-only changes do not trigger installer publication. Both text lockfiles are tracked and clean frozen installs passed with Bun 1.3.5.

GitHub execution was not available in the sandbox (no GitHub CLI/token); the macOS job was not run here. Local native tests ran Electron on Linux/Xvfb, not a Mac. Manual Mac verification remains necessary for real OS permissions, audio/tag operations, signed/notarized installer, actual installer open, provider login and large-library responsiveness. Installer network/open effects were synthetic; no installer was built, published or installed.
