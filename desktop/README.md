# Dancefloor Builder — Mac app

This folder turns Dancefloor Builder into a real Mac application (Apple Silicon).

## Getting the installer

1. Push this project to GitHub (Lovable's GitHub sync does this).
2. On GitHub, open the **Actions** tab.
3. Choose **Build macOS app** in the left list, then click **Run workflow**.
4. Wait about 5 minutes. When it finishes, open the run and download
   **DancefloorBuilder-macOS-AppleSilicon** at the bottom.
5. Unzip it, open the `.dmg`, and drag **Dancefloor Builder** into Applications.

Tagging a release (`v1.0.0`, `v1.1.0`, …) builds it automatically and attaches
the `.dmg` to that GitHub release.

## First launch

The app is not signed with a paid Apple Developer certificate, so the first
time you open it macOS will say it can't verify the developer.
Right-click the app → **Open** → **Open**. You only do this once.

To remove that step, join the Apple Developer Program and add your signing
certificate to the workflow.

## What the app does

- Runs in its own window with no browser tabs or address bar.
- Remembers its window size and position.
- Grants music-folder and file access without re-asking every session.
- Keeps everything else identical: your profile, saved library, AI lists,
  and exports to VirtualDJ.

## Changing the version

Bump `version` in `desktop/package.json` before tagging a new release.
