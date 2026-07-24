
## Goal

Nudge section placement so:
- **Pre-1990 songs** (60s/70s/80s) lean toward Warm Up and Transition — engaging older guests during the first hour.
- **Explicit / aggressive songs** lean toward Transition and Peak, and rarely land in Warm Up.
- The existing intensity-based ramp (energy + danceability, ascending across the whole set) still governs ordering.

## Approach

Introduce a small **placement bias** applied to each song's effective intensity when bucketing into Warm Up / Transition / Peak. Ordering *within* the full set still uses the raw intensity, so the ramp stays monotonic.

```text
effectiveIntensity = intensity + eraBias(year) + explicitBias(explicit)
section             = sectionForIntensity(effectiveIntensity)
displayIntensity    = intensity   ← unchanged; ramp sort uses this
```

### Bias values

- Era bias (pre-1990 only):
  - 1960s / 1970s → −2.0
  - 1980s → −1.5
  - 1990s+ → 0
- Explicit bias:
  - explicit → +2.0 (strong push out of Warm Up but not a hard block)
  - clean/unknown → 0

Both biases only shift bucket assignment. A pre-1990 disco track that's genuinely peak-intensity can still land in Peak if the boost isn't enough to move it; likewise an explicit track with very low intensity can still fall into Warm Up if nothing else fits.

### Explicit detection (AI-tagged + keyword fallback)

- Add `explicit: boolean` to the AI suggestion schema and instruct the model to flag songs with profanity, slurs, or aggressive sexual/violent content.
- Add a keyword fallback in `src/lib/danceFloor.ts` that flags titles containing markers like `[Explicit]`, `(Explicit)`, `(Dirty)`, `(Uncensored)` for uploads and library songs where the AI flag isn't available.
- Persist `explicit` on `ResultSong` so the flag survives dedupe, reranking, and top-up.

### Ordering & ramp preserved

- `reorderForEnergyProgression` continues to sort by raw `intensityOf(song)` inside each section and across the full set — the ramp visualization and existing tests still pass.
- Only the section-assignment step (`sectionForIntensity`) receives the biased value.
- Variety reranker (`applyVarietyReranker`) is unchanged; harmonic/BPM transition rules keep working.

### UI

- Add a subtle **Older-friendly** chip (year < 1990) and an **Explicit** chip to the expandable song row's `MetricsDetail`, alongside existing Stretched/Reused badges — so users can see why a track was nudged.

## Files to change

- `src/lib/danceFloor.ts`
  - Add `eraBias(year)`, `explicitBias(explicit)`, `effectiveIntensityFor(song)` helpers.
  - Add `detectExplicitFromTitle(title)` keyword fallback.
  - Extend `ResultSong` with `explicit?: boolean`.
  - Use `effectiveIntensityFor` in the bucketing pass of `reorderForEnergyProgression` (and initial `generateLists` assignment); keep raw `intensityOf` for the ramp sort.
- `src/lib/recommend.functions.ts`
  - Add `explicit: z.boolean().optional()` to `SuggestionSchema`.
  - Add a prompt bullet: flag songs with explicit language / aggressive lyrics; note that the app biases older songs into Warm Up and explicit songs into Transition/Peak so the model can lean into that when choosing.
  - Pass `explicit` through in `normalizeSuggestion` and `fallbackParseSuggestions`.
- `src/lib/workflowIsolation.ts`
  - Propagate `year` and `explicit` when building payloads / merging AI results so the biases apply consistently.
- `src/routes/_authenticated/index.tsx`
  - Backfill `explicit` from AI suggestions and keyword fallback onto uploads/library tracks.
  - Add **Older-friendly** and **Explicit** chips in `MetricsDetail`.
- `tests/danceFloor.sectionFit.test.ts` (+ new cases)
  - Pre-1990 mid-intensity disco track → Warm Up or Transition, not Peak.
  - Explicit low-intensity track → not Warm Up when a non-explicit alternative exists.
  - Ramp remains non-decreasing across the full warm-up → transition → peak sequence with biases applied.
