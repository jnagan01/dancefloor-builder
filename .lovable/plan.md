# Plan: Unit tests for library expansion behavior

## Goal

Add Vitest unit tests that lock in the expected behavior: when `expand` is on, `generateLists` MUST add library songs to Warm Up, Transition, and Peak — even if the uploaded list already meets or exceeds the per-section target.

These tests will currently FAIL against `src/lib/danceFloor.ts` because the existing `addTo` helper stops as soon as `bucket.length >= need`. That's the bug the tests pin down. Once the tests exist and we confirm the failure, the fix is a one-line behavior change in `generateLists` (out of scope for this plan — separate follow-up).

## File

`tests/danceFloor.expansion.test.ts` (new)

## Test cases

Each test builds an uploaded list large enough that the per-section target is already saturated, calls `generateLists({ expand: true, hours: <small> })`, then asserts that the returned section contains at least one song that is NOT in the uploaded list AND IS in `SONG_LIBRARY` for that section.

1. **Warm Up expansion runs when uploads saturate target**
   - Upload 30 fabricated low-energy songs (artist/song strings not present in `SONG_LIBRARY`) with title hints like "slow love" so they score into Warm Up.
   - `hours = 1` → target per section = 5; uploads already give 10 to Warm Up.
   - Expect: `result.warmUp.length > 10` AND at least one entry's `(artist, song)` matches a `SONG_LIBRARY` row whose `section === "Warm Up"`.

2. **Transition expansion runs when uploads saturate target** — same shape, mid-energy fabricated uploads, assert library Transition song appears.

3. **Peak expansion runs when uploads saturate target** — fabricated high-energy uploads (titles like "party dance fire"), assert library Peak song appears.

4. **Expansion off leaves list untouched** (regression guard) — same inputs with `expand: false` must contain zero library-only songs.

5. **Do-Not-Play list still filters expansion** (regression guard) — saturate Peak, set `doNotPlay` to one specific Peak library entry, expand on, assert that exact `(artist, song)` does NOT appear in `result.peak`.

## Helpers used

- Import `generateLists`, `dedupeKey`, `normalizeKey` from `@/lib/danceFloor`.
- Import `SONG_LIBRARY` from `@/lib/songLibrary` to identify library-only entries via set difference.

## Run command

`bunx vitest run tests/danceFloor.expansion.test.ts`

## Out of scope

Changing `generateLists` behavior. Tests 1–3 are expected to fail on first run — that failure is the point and confirms the bug you suspected. After approval of a separate fix plan, the tests pass.
