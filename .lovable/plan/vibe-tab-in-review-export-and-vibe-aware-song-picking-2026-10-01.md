# Vibe tab in Review & Export, and vibe-aware song picking

## What you'll get

1. **New "Vibe" tab in Step 5**, next to Warm Up / Transition / Peak (only shown when a vibe is picked).
   - One card per section: average Energy, Danceability, BPM, shown next to the vibe's target ranges.
   - Breakdown per section and for the whole event: songs **inside** the vibe range, **too low**, **too high**, and **no data**.
   - A short list of the songs furthest outside the range, each with a button to jump to that song in its section.
2. **Vibe shapes the songs chosen from the start**, not just decades and genres.
   - AI suggestions: the vibe becomes its own instruction to the AI (target energy and BPM range plus the style), replacing today's version that is just added to the notes.
   - Library songs: songs whose BPM and energy fit the vibe score higher when topping up sections. Songs far outside the BPM range are skipped when there is a fitting alternative.
   - Warm-up to peak build is kept. The vibe range is centred on Transition, Warm Up is allowed to sit a bit lower and Peak a bit higher, so dance floor lists still build.

## Technical details

- `src/lib/vibes.ts`: add `vibeFit(song, vibe, section)` returning `inside | low | high | unknown`, with per-section allowances (warm-up −1 energy / −8 BPM, peak +1 / +8). Used by both the tab and the chart so the numbers match.
- `src/lib/recommend.functions.ts`: add an optional `vibe` field to the prefs input, plus a "Music style/vibe" line in the prompt with energy and BPM targets. Stop sending the vibe inside notes.
- `src/lib/danceFloor.ts`: add an optional `vibe` to `Preferences`. In `libraryPreferenceScore`, add up to +4 for BPM inside the range and −3 for BPM far outside it. Energy counts when it's known.
- `src/routes/_authenticated/events.new.tsx`: pass `vibe` through `buildCurrentPrefs()`. In the crate-finds loop, skip library songs with a known BPM more than 15 outside the vibe range. Add a `"vibe"` value to the Step 5 tabs and render a new `VibeBreakdown` component.
- New `src/components/builder/VibeBreakdown.tsx` with semantic tokens only.
- `EventEnergyRamp`: switch the "% on target" figure to the shared `vibeFit` helper.
- Saved events already store `vibe`, so older events without one show no tab.
