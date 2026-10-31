#!/bin/bash
# Read-only validation of the actual inner app, never the unsubmitted DMG wrapper.
set -euo pipefail
APP="$1"
SIGNATURE_LOG="$2"
codesign --verify --deep --strict --verbose=2 "$APP"
# Capture first: pipefail must not confuse truncated/absent display output with a signature failure.
codesign -d --verbose=4 "$APP" > "$SIGNATURE_LOG" 2>&1
cat "$SIGNATURE_LOG"
grep -q '^Authority=Developer ID Application:' "$SIGNATURE_LOG"
xcrun stapler validate "$APP"