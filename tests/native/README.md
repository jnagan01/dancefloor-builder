# Isolated native release gate

Run `node tests/native/run.mjs` after frozen root and desktop installs. CI runs on macos-15 before installer packaging/release. Electron 33.4.11 and Playwright 1.56.1 are pinned, with Bun lockfiles. Linux may require Xvfb and shared-library paths.

The runner mounts the actual event route, matching, export, autosave and recovery modules inside real Electron. Only services, workspace input and file-dialog output are replaced. A fenced temporary userData, synthetic backend and synthetic library are mandatory. Test IPC refuses paths outside the synthetic root. ZIP/M3U/TXT/readiness artifacts are read back. Diagnostics contain synthetic data only.

Automated scope: uncertain wrong-song export; explicit relevant most-played approval and save; artifact/report inspection; restore target consistency; offline shutdown/restart/reconnect and no duplicate row; backup ENOSPC refusal; export EACCES refusal. Existing route tests cover six-row missing-title generation, late-save recovery, confirmation/analysis, compact revision CAS and races. These additional cases are not all driven through Electron yet.

Manual Mac gate remains required: OS file permissions, actual audio playback/tag writes, signed installer/notarization, real update installer handoff, provider login, and large-library responsiveness. No automated test here accesses a real account or music file.
