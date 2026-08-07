# Favorite artists first during song expansion

When expansion is on, the app should exhaust the DJ's favorite artists before reaching for any other song — and only move on when a favorite would break the per-list limit or wouldn't fit the section.

## Behavior

1. **Favorites pass runs first.** For each section (Warm Up, Transition, Peak) that is short, the app first asks the recommender for songs **only** by the favorite artists listed in preferences.
2. **Per-list cap of 3.** No favorite artist may exceed 3 songs on any single list. Once an artist hits 3 in that list, they're excluded from further picks for that list.
3. **Fit still governs.** A favorite-artist song is only added if it matches that section's criteria (energy/danceability band, tempo window, explicit rules for Warm Up). The recommender is told to return fewer songs rather than force bad fits.
4. **Then the normal pass.** Whatever shortfall remains after the favorites pass is filled by the existing gap-driven recommendation loop, then the built-in library top-up — unchanged.
5. **Ramp and variety unchanged.** Sequencing, energy progression, dedupe, and cross-section rules stay as they are; only the artist cap is raised to 3 for favorites (non-favorites remain capped at 2).

## Technical changes

**`src/lib/recommend.functions.ts`**
- Add optional input fields: `onlyArtists: string[]` (favorites pass) and `favoriteArtists: string[]` (context for the normal pass).
- When `onlyArtists` is present, the prompt restricts suggestions to those artists, keeps the section-fit and availability rules as hard filters, and explicitly permits returning fewer than `count` (or zero) if nothing fits — no filler.
- Post-validate: drop any suggestion whose artist isn't in `onlyArtists` (normalized compare).

**`src/routes/_authenticated/index.tsx`**
- In the expansion block, before the existing retry loop, run a favorites pass per section: compute per-section counts per favorite artist, request only artists still under 3, add results through the same dedupe/mapping path.
- Then run the existing gap-driven loop for the remaining shortfall, passing `favoriteArtists` so the model knows they're preferred but capped.

**`src/lib/danceFloor.ts`**
- `buildGapProfile`: accept the favorite-artist list; a favorite is only added to `excludeArtists` once it reaches 3 in the current section (non-favorites keep the existing threshold).
- `applyVarietyReranker`: accept an optional `favoriteArtists` set and use a cap of 3 for those artists, 2 for everyone else; thread it through `reorderForEnergyProgression`.

**Tests**
- Add cases: favorites never exceed 3 per list; non-favorites still capped at 2; a favorites pass returning nothing still lets the normal pass fill the section.
