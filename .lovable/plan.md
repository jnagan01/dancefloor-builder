# Smarter section filtering with danceability + age signals

Today, `generateLists` only ranks songs by an `energy` score and splits uploads into thirds. We'll add two more signals — **danceability** and an inferred **audience age fit** — and verify the behavior with tests.

## 1. Extend the song model

In `src/lib/songLibrary.ts`:

- Add `danceability: number` (1–10) to `LibrarySong`. Hand-fill for the existing ~50 entries (disco/EDM high, ballads low).
- No new field for age — it's derived (see below).

In `src/lib/danceFloor.ts`:

- Extend `ScoredSong` with `danceability?: number` and an internal `audienceFit: "older" | "younger" | "adult" | "all"`.

## 2. Infer audience-age fit from decade + genre

New helper `inferAudienceFit(decade, genre)` in `danceFloor.ts`:

```text
1950s–1980s, or genre in {Disco, Soul, Funk, Oldies, Country}      → "older"
2010s–2020s clean Pop (Taylor Swift, Bruno Mars, Dua Lipa, etc.)   → "younger"
Hip Hop / EDM / club anthems (LMFAO, Pitbull, Usher, Cardi B)      → "adult"
Everything else                                                    → "all"
```

For uploaded songs that aren't in the library, fall back to `"all"` (heuristics on title/artist already exist for energy; we won't overfit).

## 3. Section scoring (replaces the "sort by energy, slice into thirds" step)

Compute a per-section score for every song:

```text
warmUpScore   = (10 - energy) + danceability*0.5 + (older ? 3 : 0) + (younger ? 3 : 0)
transitionScore = (10 - |energy - 7|) + danceability + (all ? 2 : 0)
peakScore     = energy + danceability + (adult ? 3 : 0) - (older ? 2 : 0) - (younger ? 2 : 0)
```

Assign each song to its highest-scoring section, then rebalance so each bucket gets roughly `total/3` songs (move the lowest-margin songs from oversized buckets to undersized ones). Library expansion already targets a specific section, so it keeps working as-is — but the candidate ranking inside `padTo` will also use the new score so older/younger songs preferentially fill Warm Up and adult tracks fill Peak.

Energy stays the primary signal; danceability and age are tie-breakers and rebalancers, so existing behavior is mostly preserved.

## 4. Tests

New file `tests/danceFloor.sectionFit.test.ts` (vitest), covering:

1. **Older/younger guests fill Warm Up** — given an upload mix of disco/oldies + current clean pop + club EDM, all disco/oldies and clean pop end up in Warm Up; no EDM does.
2. **Adult-skewing tracks go to Peak** — Pitbull / LMFAO / Usher land in Peak, not Warm Up.
3. **Energy still dominates** — a high-energy disco track (e.g. "September") stays in Warm Up or Transition (not Peak) because its `audienceFit` is "older".
4. **Danceability breaks ties** — two songs with equal energy: higher danceability goes to the more dance-heavy section.
5. **Balanced buckets** — for 30 mixed uploads, no section ends up with fewer than `floor(total/3) - 1` or more than `ceil(total/3) + 1` songs.
6. **Expansion respects age fit** — with empty uploads and `expand: true`, Warm Up is dominated by older/younger-fit library songs and Peak by adult-fit ones.

All tests use the existing `generateLists` API; no UI changes.

## Files

- `src/lib/songLibrary.ts` — add `danceability` to each row.
- `src/lib/danceFloor.ts` — add `inferAudienceFit`, new scoring/rebalancing logic, extend `ScoredSong`.
- `tests/danceFloor.sectionFit.test.ts` — new test file.

No UI changes in this step. Run `bunx vitest run` to confirm.
