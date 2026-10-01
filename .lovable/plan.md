# Dashboard lists: top 50 per list, 15 visible then scroll

## What changes

Every generated list on the home dashboard shows up to 50 entries (when that many exist), but only the first 15 are visible — the rest are reached by scrolling inside that list, so the page stays compact.

### Lists affected
- **Top Tracks** (all-platforms consensus): currently shows the #1 hero card plus 14 rows, capped at 90 in the data. Will render up to 50.
- **Top Artists** (consensus): same — hero plus rows, capped at 60 in the data. Will render up to 50.
- **Per-platform charts** (Apple Music, Billboard, Last.fm, Shazam tabs): currently capped at 40 rows. Will render up to 50.
- **Genre-filtered lists**: same behavior, since they reuse the same lists.

### How it looks
- The #1 hero card stays fixed at the top of its column.
- Rows #2 onward sit in a scrollable area sized to show about 14 rows (15 total including the hero), with a thin scrollbar and a subtle fade at the bottom hinting there is more.
- Play buttons, source badges, and "In library" tags keep working for every row, including the scrolled ones.

## Technical details

- `src/routes/_authenticated/index.tsx`:
  - `ConsensusTrackList` / `ArtistList`: change `rest.slice(0, 14)` to `rest.slice(0, 49)` and wrap the row list in a container with `max-h` (≈14 row heights) + `overflow-y-auto`, plus a bottom fade overlay.
  - `ChartList`: change `rows.slice(0, 40)` to `rows.slice(0, 50)` inside the same scrollable container.
- `src/lib/charts.functions.ts`: consensus caps (90 tracks / 60 artists) already exceed 50, so no data change needed for the consensus lists. Per-platform feeds already fetch 50–100 entries; the render cap was the only limit. Genre charts reuse the same components, so they inherit the behavior.
- No backend, cache, or fetch changes — this is a rendering change only, so charts load at the same speed.

## Verification
- Typecheck + build clean.
- Open the dashboard signed in (Playwright): confirm each list shows ~15 rows, scrolls to reveal up to 50, hero card stays put, and the page height stays compact.
