## Goal

Make the song selection and ordering noticeably better by giving the AI richer, more accurate audio metadata and stronger ranking rules — without changing the existing workflow inputs.

## 1. Richer feature set for every candidate song

Expand the per-song feature vector used for ranking and AI prompting to include:

- `bpm` (tempo)
- `key` / `camelot` (musical key in Camelot notation for harmonic mixing)
- `genre` and `subgenre`
- `year` / `era`
- `mood` tags (e.g. euphoric, dark, groovy)
- existing: `energy`, `danceability`, `valence`, `popularity`

Source order (first hit wins, then merge missing fields from the next source):

1. **VirtualDJ database fields** — parse BPM, Key, Genre, Year, and any POI/grid tags already in the user's `database.xml`. Extend `src/lib/virtualDj.ts` to extract these into the `Track` model.
2. **MusicBrainz + AcousticBrainz** (no API key required) — look up artist/title to enrich missing BPM, key, genre, mood, and high-level features. Calls go through a new `src/lib/musicMeta.functions.ts` server function with in-memory + IndexedDB caching keyed by normalized artist/title.
3. **AI-inferred fallback** — only for the small set still missing features after steps 1–2, ask the model to estimate them as part of the recommendation call (clearly flagged as estimated in the UI tooltip).

## 2. Smarter AI recommendation prompt

Update `src/lib/recommend.functions.ts`:

- Pass the enriched feature vector for every already-picked song plus the per-section target bands (Warm Up / Transition / Peak) and target counts.
- Add explicit instructions:
  - Pick songs that fit the requested vibe even if not in the user's library.
  - Match the target energy / danceability band for the section.
  - Prefer adjacent-Camelot keys and BPM within ±6% of neighbors for transition smoothness.
  - Maintain a monotonic energy ramp across the full list.
  - Return BPM, key (Camelot), genre, year, mood, energy, danceability, valence, popularity, and a 1‑sentence rationale per song.
- Tighten the structured-output schema (keep it within Gemini's state limits — short field names, no long enums).

## 3. Balanced variety rules (post-processing)

After the AI returns candidates, run a deterministic re-ranker in `src/lib/danceFloor.ts` before the energy-ramp sort:

- Penalize back-to-back same artist; cap any artist at 2 tracks per playlist by default.
- Penalize near-duplicate titles (normalized title match, remix/edit variants).
- Penalize large BPM jumps (>8%) and non-adjacent Camelot jumps between neighbors.
- Penalty is a score adjustment, not a hard filter, so short libraries still fill.

## 4. UI surfacing (small additions only, no workflow input changes)

In the existing expandable song row:

- Add BPM, Key (Camelot), Genre, Year to the metrics detail.
- Add a small "metadata source" line: `VirtualDJ`, `MusicBrainz`, or `AI estimate`.
- Keep all existing badges (Stretched / Reused / Upload / AI / Library).

## 5. Tests

Extend `tests/` with:

- Unit tests for the MusicBrainz enrichment merge order and cache hit/miss.
- Unit tests for the variety re-ranker (artist cap, back-to-back penalty, BPM/key jump penalty).
- A regression test confirming the energy ramp is still monotonic after re-ranking.

## Technical notes

- MusicBrainz requires a descriptive `User-Agent`; AcousticBrainz is read-only and unauthenticated. Both are called server-side from a new `*.functions.ts` to avoid CORS and to allow caching.
- All enrichment is best-effort: missing fields fall back gracefully and the existing shortfall banner logic is unchanged.
- No new user-facing inputs; existing workflow controls remain the single source of intent.
- Workflow isolation (`workflowInstanceId`) and the existing `clearWorkflowState` helper are preserved; the metadata cache is keyed by song identity, not workflow, which is safe because it stores only objective audio features.
