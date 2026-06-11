## Goal

Build each section (Warm Up, Transition, Peak) to **1.5× the songs needed** by default, and warn the user when their uploads can't cover that target so they know to flip on "Add additional songs from the library."

## Behavior changes

### 1. New buffered target math (`src/lib/danceFloor.ts`)

- Introduce a constant `SECTION_BUFFER = 1.5`.
- Keep `totalSongsNeeded = ceil(hours * 15)` as the *baseline* count.
- Add `perSectionTargetBuffered = ceil((totalSongsNeeded / 3) * 1.5)`.
- `generateLists` now aims for `perSectionTargetBuffered` per section in both modes:
  - **Expand ON**: pad each section up to the buffered target using library songs (current `addTo` already supports this — just pass the new number).
  - **Expand OFF**: distribute uploads across sections as today; do not pad. Return the buffered target as the *goal*, even if uploads fall short, so the UI can compare.
- Extend `GenerationResult` with:
  - `perSectionTarget` (the buffered per-section goal — replaces today's value)
  - `perSectionBase` (the un-buffered baseline, for reference/labels)
  - `shortfall: { warmUp: number; transition: number; peak: number; total: number }` — how many songs short of the buffered target each section is *with current uploads only*. Computed from the distribution of uploads before expansion.

### 2. Live targets + shortfall in the UI (`src/routes/index.tsx`)

- Update the existing `liveTargets` computation (debounced) to also return the buffered per-section number and a `shortfall` estimate based on a quick energy-bucket pass over current uploads (reuse `estimateEnergy` via a lightweight helper exported from `danceFloor.ts`, or call `generateLists({ expand: false })` against current state — whichever is cheaper). Use the same `useTransition` + `useDebounce` flow already in place.
- Replace the displayed "per-section needed" number everywhere (Step 3 hours helper, Step 3 decades helper, Step 4 expansion helper, results summary) with the buffered target. Label it clearly, e.g. *"15 songs per section (1.5× buffer)"*.
- **Warning banner** in the Song-source summary panel and inline in Step 4:
  - Shown when `expand` is OFF **and** any section's shortfall > 0.
  - Copy: *"Your uploads cover X of Y songs needed for the Warm Up / Transition / Peak buffer. Turn on 'Add additional songs from the library' to fill the gap."*
  - Style: `bg-amber-500/10 text-amber-700 border border-amber-500/30`, lucide `AlertTriangle` icon, dismissible? No — it should track state live.
  - When `expand` is ON, the warning is hidden (library fills the gap).
- The existing "recalculating…" badge stays and applies to the new shortfall too.

### 3. Tests (`tests/danceFloor.expansion.test.ts` + new cases)

- Update existing expansion tests to assert each section reaches the **buffered** target (not the baseline) when `expand: true` and the library has enough candidates.
- Add a new test: with `expand: false` and uploads below the buffered target, `result.shortfall` reports a positive number per section.
- Add a new test: with `expand: true` and ample library, `result.shortfall` for the post-expansion result is 0.

## Out of scope

- Changing `SONGS_PER_HOUR` (still 15) or the section split (still even thirds).
- Reordering or restyling unrelated parts of the summary panel.
- Persisting a user-overridable buffer multiplier (1.5 is a constant for now).

## Open question

The 1.5× buffer applies *per section*, so the total songs surfaced is 1.5× the dance-floor length (e.g. a 2-hour floor → 45 songs across the three sections instead of 30). Confirm that's what you want, vs. 1.5× only when expansion fills gaps. I'll proceed with **always 1.5× per section** unless you say otherwise.