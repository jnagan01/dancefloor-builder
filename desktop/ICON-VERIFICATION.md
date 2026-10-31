# Transparent icon verification

The user-supplied `icon-transparent.png` (1254×1254 RGBA) was resized with Pillow LANCZOS to `build/icon-source.png` (1024×1024 RGBA), with no compositing, background, regeneration or artwork edits. The favicon uses the same artwork at 64×64.

All four outer corner alpha values are 0. The supplied central artwork is **nearly opaque, not fully opaque**: alpha 251–254 (center 253). This original alpha is intentionally preserved; 1122 pixels in the resized source are alpha 255. All 262144 pixels in the central half are alpha ≥250.

Local Pillow ICNS encoding/decoding at 1024 produced byte-identical RGBA pixels. Apple `sips`/`iconutil` and the signed app cannot run here; the macos-15 release workflow now rejects flattened source or ICNS artwork, verifies the icon extracted from the actual signed ZIP, and compares the DMG app icon with that ZIP icon before release. No installer was built or installed locally.

## Checks run on 2026-10-31

- `bunx vitest run`: 406/406 passed (includes all prior 404 appearance/updater/data tests and two icon tests).
- `LD_LIBRARY_PATH="$(printf '%s:' /nix/store/*/lib)" xvfb-run -a node tests/native/run.mjs`: 16/16 actual isolated Electron checks passed on Linux, including appearance contrast, System behavior, fresh edits during update download and fail-closed preservation. Synthetic data only.
- `NODE_PATH=/dev-server/node_modules bun /tmp/setarchitect-stress/adversarial.cjs`: 33/33 passed.
- `NODE_PATH=/dev-server/node_modules bun /tmp/setarchitect-stress/more.cjs`: 16/16 passed.
- `node desktop/verify-icon.cjs /tmp/exact-icon-roundtrip.png 1024`: passed.
- Automatic preview build/typecheck log: build OK.

Appearance and updater implementation remain intact: no automatic download or quit installation, and no Squirrel handoff before fresh backup plus fsynced current draft with editing frozen. Actual signed macOS replacement/relaunch and the new packaged-icon Apple-tool gates still require the GitHub/macOS runner. No production data writes, dependency installs, live installation or web publishing were performed.