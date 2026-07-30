Here's what I found in the current pipeline and where the real quality gains are.

## What the app does today

- Songs get an intensity = mean(energy, danceability); fixed bands assign sections (≤6.5 Warm Up, 7–7.5 Transition, ≥8 Peak), with era/explicit biases nudging placement.
- Sections are filled to a 2x buffer, then a greedy re-ranker enforces a 2-track artist cap and prefers small BPM jumps / adjacent Camelot keys.
- The AI is asked per-section for N picks with static energy/BPM guidance.

The structure is sound; the weaknesses are that placement uses only two of the six signals, the ramp is linear and section-shaped rather than set-shaped, and the AI gets no feedback about what it already produced.

## Proposed improvements

**1. Richer placement score (replaces the 2-signal intensity)**
Blend energy, danceability, valence, tempo, and popularity into a placement score, while keeping raw energy/danceability visible in the UI. Valence and BPM matter a lot: a 128-BPM sad track and a 128-BPM euphoric track do not belong in the same slot. Popularity gets weighted higher inside Peak (anthems land late) and lower in Warm Up.

**2. Curve-based ramp instead of three flat bands**
Model the night as a target intensity curve over the whole set (gentle rise → plateau → peak → optional short dip before final anthems) and place songs against the curve. This produces a smoother arc than three hard buckets, and it automatically fixes lopsided section sizes without the current symmetric-trim hack.

**3. Peak "wave" micro-structure**
Real peak hours breathe: 3–5 bangers, one crowd-singalong breather, back up. Add a small oscillation to the curve during Peak so the floor gets recovery moments instead of 30 straight max-energy tracks.

**4. Smarter variety constraints**
Beyond the artist cap, add rolling-window rules: no more than 2 tracks from the same genre in any 4, no more than 3 from the same decade in any 6, and spread the user's requested artists across sections rather than clustering them. Also add a same-era-run guard so the set doesn't sit in one decade for 20 minutes.

**5. Feedback-loop AI recommendations**
Currently each AI batch is independent, so batches repeat genres and artists. Change to: send the AI a compact profile of what's already selected (genre mix, decade mix, artist list, BPM histogram, current gaps) and ask it to fill the specific gaps — "I need 8 tracks, 100–110 BPM, valence ≥7, not hip-hop, not these 40 artists." Fewer wasted picks, better coverage.

**6. Per-slot AI reasoning surfaced in the UI**
Store why each song was placed where it was (curve position, key/BPM fit, gap filled) and show it in the expandable row, so you can judge and override with context.

## Technical details

- `src/lib/danceFloor.ts`: add `placementScore()` (weighted blend, section-aware weights), replace fixed bands with `targetCurve(position, totalCount)` + assignment against curve, add `peakWave()` modulation, extend `applyVarietyReranker` with rolling-window genre/decade constraints.
- `src/lib/recommend.functions.ts`: extend the input schema with a `gaps` object (bpmRange, valenceMin/Max, excludeGenres, excludeArtists, targetIntensity) and rewrite the prompt to be gap-driven; keep the existing sanitization and bounds.
- `src/routes/_authenticated/index.tsx`: compute the gap profile between AI batches; show the placement rationale in the expandable row.
- Tests: extend `tests/varietyReranker.test.ts` and `tests/danceFloor.sectionFit.test.ts` for curve monotonicity, rolling-window variety, and peak-wave bounds.

## Suggested order

Items 1, 2, 4 give the biggest immediate improvement in list quality. Item 5 improves what the AI returns. Items 3 and 6 are polish. I can do all of it in one pass, or start with 1/2/4 so you can hear the difference before adding the rest.
