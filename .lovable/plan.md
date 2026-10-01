# Custom BPM and danceability targets in event setup

## What you'll get

1. **Two new controls in event setup**, under the vibe picker:
   - **Tempo target**: a toggle plus a two-handle slider (60–180 BPM, steps of 1) with the chosen range shown, e.g. "112–126 BPM".
   - **Danceability target**: a toggle plus a two-handle slider (1–10, steps of 0.5).
   - When a toggle is off, its slider is greyed out and nothing changes. When a vibe is picked, turning on the tempo toggle starts the slider at that vibe's BPM range.
   - Both settings save with the event and come back when you reopen it.
2. **Your ranges win over the vibe preset.** A custom BPM range replaces the vibe's BPM range everywhere. Danceability is a new target the vibes don't have.
3. **Song picking uses them:**
   - The AI is told your BPM and/or danceability range as a strong preference.
   - Songs from your music folder that are more than 15 BPM outside your tempo range are skipped.
   - Built-in filler songs inside your danceability range get priority, and songs far outside it are ranked down.
   - Warm Up can still sit a little lower and Peak a little higher, so dance floor lists still build.
4. **Review shows them:**
   - Event flow chart: a shaded BPM band in the BPM colour, and a danceability band when that target is on.
   - Vibe tab: also shown when only a custom target is on, without a vibe. Each section shows its target next to its averages, and the inside / too low / too high counts take your BPM and danceability ranges into account.

## Technical details

- `src/lib/vibes.ts`: add a `Targets` type (`{ vibe?, bpm?: [n,n], dance?: [n,n] }`), plus `resolveTargets(vibe, bpmRange, danceRange)` returning the effective energy, BPM and danceability ranges. Extend `vibeFit`/`vibeRange` to take those targets: a song is "inside" only if every metric it has data for is inside, and "low"/"high" follows the first failing metric. Add `targetsNote(targets)` for the AI prompt.
- `events.new.tsx`: state `bpmOn`, `bpmRange`, `danceOn`, `danceRange`, built with the existing shadcn `Slider` (two thumbs) and `Switch`. Reset these with the rest of the workflow, save them in the autosave inputs, and restore them on load. Pass `bpmRange`/`danceRange` (only when the toggle is on) through `buildCurrentPrefs()`. The crate-finds BPM filter uses the effective BPM range. `EventEnergyRamp` and `VibeBreakdown` get the resolved targets, and the Vibe tab shows when any target is set.
- `history.functions.ts`, `HistoryPanel.tsx`, `workflowIsolation.ts`: add optional `bpmRange`/`danceRange` (each a 2-number tuple, validated with zod, 60–180 and 1–10, min ≤ max).
- `recommend.functions.ts`: add optional `bpmRange`/`danceRange` to the prefs schema (same bounds) and a target line in the prompt.
- `danceFloor.ts`: `Preferences` gains `bpmRange?`/`danceRange?`. In `libraryPreferenceScore`, add +3 when danceability is inside the range and −2 when it is more than 2 outside. The built-in library has no BPM, so tempo applies to AI and music-folder picks only.
- `EventEnergyRamp.tsx` / `VibeBreakdown.tsx`: take a `targets` prop instead of only `vibe`, and draw the BPM band and the danceability band.
