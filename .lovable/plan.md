# Smarter AI recommendations + energy progression

Two related improvements to how songs get suggested and ordered.

## 1. AI uses danceability, energy, popularity & valence

Today `recommendSongsForSection` (in `src/lib/recommend.functions.ts`) only asks the model for `energy` and `danceability` (1–10). Popularity and valence aren't requested or used.

Changes:
- Extend the output schema so every suggestion includes:
  - `energy` (1–10)
  - `danceability` (1–10)
  - `popularity` (1–10 — how widely recognized / crowd‑pleasing)
  - `valence` (1–10 — musical positivity / "feel‑good")
- Update the prompt to:
  - Tell the model to **score every track on all four signals** and use them as the primary basis for the recommendation.
  - Explicitly say suggestions do **not** need to come from any built‑in library — any real released song that fits is fair game (this preserves current behavior but makes it explicit so the model doesn't bias toward famous mainstream picks).
  - Define per‑section targets in terms of those signals:
    - Warm Up → lower energy (≈3–6) + mid danceability + high popularity (singalongs) + warm/positive valence
    - Transition → mid‑to‑high energy (≈6–8) + high danceability + high popularity
    - Peak → high energy (≈8–10) + high danceability + high‑to‑euphoric valence
- Surface the new fields back to the caller (returned from the server function) so the client can use them for ordering.

## 2. Section assignment + intra‑section ordering = constant energy ramp

Right now uploaded songs are bucketed by `estimateEnergy` / `bestSection`, and within each section the order is just insertion order. The user wants a smooth ramp from the very first Warm Up song to the very last Peak song.

Changes in `src/lib/danceFloor.ts`:
- **Bucketing rule (deterministic, matches the user's ask):** combine energy + danceability into a single "intensity" score = `(energy + danceability) / 2`. Lowest third → Warm Up, middle third → Transition, top third → Peak. The existing soft‑rebalance pass is replaced by this rank‑based split so a song's section always reflects its scores.
  - Library songs keep their hand‑curated section only if it doesn't contradict their scores by more than 1 bucket; otherwise the score wins.
- **Ordering inside each section:** sort by intensity ascending. Warm Up starts at the lowest score in the set; Peak ends at the highest. Ties broken by `popularity` (less‑known first) so the most familiar bangers land late.
- **Cross‑section continuity:** after sorting each bucket, nudge the last 1–2 songs of Warm Up to be ≤ the first song of Transition, and same for Transition → Peak, by swapping with the next‑closest neighbor when there's a discontinuity. Result: monotonic non‑decreasing energy from song #1 to the final song.
- AI‑suggested songs returned from `recommendSongsForSection` flow through the same scoring/sorting path so uploads and AI picks are interleaved by intensity, not segregated.

## Technical details

Files touched:
- `src/lib/recommend.functions.ts` — schema + prompt (adds `popularity`, `valence`; rewrites section guidance around the 4 signals).
- `src/lib/danceFloor.ts` — new `intensityOf()` helper, rank‑based section split, sort‑and‑smooth pass; `ScoredSong` gains optional `popularity` and `valence`.
- `src/routes/index.tsx` — when merging AI suggestions into buckets, pass `popularity`/`valence` through so sorting uses them. No UI copy changes unless you want a small "sorted by energy ramp" note under each section header (happy to add — say the word).

Tests:
- Extend `tests/danceFloor.sectionFit.test.ts` with cases asserting: (a) lowest‑intensity uploaded song ends up in Warm Up, (b) each section's output is sorted ascending by intensity, (c) last(WarmUp).intensity ≤ first(Transition).intensity ≤ … ≤ last(Peak).intensity.

## Out of scope (ask if you want them)

- Showing the four scores per song in the UI table.
- Letting the DJ tune the warm‑up/peak intensity cutoffs.
- Re‑ordering already‑exported playlists retroactively (new generations will be ordered; old saved sets stay as‑is unless regenerated).
