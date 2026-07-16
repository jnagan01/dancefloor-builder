# Enforce Minimum Popularity on AI Recommendations

## Goal
Ensure every AI-suggested song has a popularity score of at least 6/10 so wedding guests will recognize the music.

## Changes

**File: `src/lib/recommend.functions.ts`**

1. **Prompt update** — add a hard rule that popularity must be ≥6:
   - Update the popularity signal description to note the minimum threshold.
   - Add an explicit rule in the "Rules" section: "popularity MUST be 6 or higher — every recommended song should be widely recognized by a general wedding/party crowd. Do not suggest obscure tracks even if they fit the energy/BPM/key targets."
   - Reinforce in the section-target guidance that recognizable crowd-pleasers are required.

2. **Server-side filter (safety net)** — after the AI returns suggestions, drop any item with `popularity < 6` before returning to the caller. This guarantees the constraint even if the model occasionally ignores the prompt rule. Applies to both the primary `generateObject` path and the `fallbackParseSuggestions` recovery path.

3. **Fallback default** — in `normalizeSuggestion`, raise the popularity fallback default from `8` (already ≥6, no change needed) and ensure the clamp floor stays consistent. No behavior change here — noted for completeness.

## Out of scope
- The built-in `SONG_LIBRARY` fallback (used when uploads/AI are short) — those are curated wedding staples and already meet the bar.
- UI changes. The popularity score is not currently surfaced in the builder UI; this change is purely about what gets recommended.

## Verification
Run the existing test suite (`bunx vitest run`) — no test changes expected since tests don't assert on popularity values.
