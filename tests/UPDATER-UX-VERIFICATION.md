# Narrow updater UX regression verification

Startup discovery remains silent on background errors. After explicit Update now consent, rejected installs and download, backup or staging failures show an error even when the initial discovery was silent. Backup failure still prevents Squirrel invocation.

The preservation overlay subscribes to the existing native status channel. Staging/preservation failures replace the progress message with an alert, the actual error and instructions to keep the window open and avoid forced quit/restart/reinstall until recovery is arranged. No unlock, install authorization, quit or navigation rules were changed. Subscription cleanup occurs only on the existing safe release path.

Checks on 2026-10-31:
- `bunx vitest run`: 412/412 passed, including all previous 406 and six startup-consent regressions.
- `LD_LIBRARY_PATH="$(printf '%s:' /nix/store/*/lib)" xvfb-run -a node tests/native/run.mjs`: 17/17 passed twice on isolated Linux Electron. Production lock overlay rendered a staging-failed alert; all underlying body children stayed inert and controller quit stayed blocked. `test-results/native/staging-failure-overlay.png` captures it before test-only cleanup.
- `NODE_PATH=/dev-server/node_modules bun /tmp/setarchitect-stress/adversarial.cjs`: 33/33 passed.
- `NODE_PATH=/dev-server/node_modules bun /tmp/setarchitect-stress/more.cjs`: 16/16 passed.
- Automatic preview build/typecheck: build OK.

No production writes, dependency installs, web publishing or live installation. Signed macOS staging/relaunch remains outside this sandbox; user reported run 41165169489 regression passed and packaging underway, not independently verified here. Icon, validators and updater preservation/staging safeguards unchanged.