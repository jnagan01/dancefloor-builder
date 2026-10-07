# SetArchitect — Mac app

This folder turns SetArchitect into a real Mac application (Apple Silicon).

## Getting the installer

1. Push this project to GitHub (Lovable's GitHub sync does this).
2. On GitHub, open the **Actions** tab.
3. Choose **Build macOS app** in the left list, then click **Run workflow**.
4. Wait about 5 minutes. When it finishes, open the run and download
   **DancefloorBuilder-macOS-AppleSilicon** at the bottom.
5. Unzip it, open the `.dmg`, and drag **SetArchitect** into Applications.

Tagging a release (`v1.0.0`, `v1.1.0`, …) builds it automatically and attaches
the `.dmg` to that GitHub release.

## First launch

The app is signed with a Developer ID certificate and notarized by Apple,
so it opens like any other Mac app — no warnings, no Terminal commands.

Signing requires these repository secrets (Settings → Secrets and variables → Actions):
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

## What the app does

- Runs in its own window with no browser tabs or address bar.
- Remembers its window size and position.
- Grants music-folder and file access without re-asking every session.
- Keeps everything else identical: your profile, saved library, AI lists,
  and exports to VirtualDJ.

## Changing the version

Bump `version` in `desktop/package.json` before tagging a new release.
