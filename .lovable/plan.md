# Noir & Gold Redesign

A full visual and layout redesign of the Wedding Dance Floor Builder. No changes to matching, AI recommendation, sequencing, or export logic — only how it looks and how the flow is arranged.

## 1. Visual direction

Dark, editorial "wedding-luxe" booth aesthetic.

- Palette: near-black base (#0d0d0d), raised surface (#1a1a1a), champagne gold accent (#c9a84c) with a lighter gold highlight (#f0d78c). Dark-first, with a matching light mode kept working.
- Typography: a display serif for headings (section titles, step names, the app title) paired with a clean sans for body and data. Loaded via the root route head.
- Details: hairline gold borders, soft gold glow on primary actions, tighter radii, subtle grain/gradient on the page background.
- All values become semantic tokens in `src/styles.css` — no hardcoded colors in components.

## 2. Workflow layout

Today the whole app is one very long scrolling page of Step 1–6 cards.

New shape:

```text
┌──────────────────────────────────────────────┐
│ Top bar: title · music setup · history · user│
├───────────┬──────────────────────────────────┤
│ Stepper   │  Active step panel               │
│ 1 Upload  │  (only the current step shows)   │
│ 2 Review  │                                  │
│ 3 Details │                                  │
│ 4 Expand  │                                  │
│ 5 Export  │                                  │
├───────────┴──────────────────────────────────┤
│ Sticky action bar: Back · primary action     │
└──────────────────────────────────────────────┘
```

- Left rail stepper on desktop showing progress, completion checks, and quick jump; collapses to a horizontal scrollable step chip row on mobile.
- One step visible at a time instead of six stacked cards; steps already completed can be revisited.
- Sticky bottom action bar carries the primary action for the current step (Generate, Export, Continue) so it's always reachable.
- Music setup stays a dialog, reachable from the top bar.

## 3. Playlist review screen

The export/review step becomes the centerpiece.

- Warm Up / Transition / Peak stay as tabs, but each tab shows count vs target and a small energy sparkline of the ramp.
- Song rows get a denser two-line layout: index, title/artist, source and fallback badges, energy chip, and row actions (play, expand, search) on the right; the expand chevron still reveals metrics and placement reasoning.
- A filter bar per section: search within section, and quick filters for AI-added, uploads only, unmatched, and stretched/reused.
- Shortfall banner restyled as an inline alert with per-section counts.
- Inline match search results restyled as a compact result list with clearer selected state.

## 4. Responsiveness and consistency

- Header rows use the grid + `min-w-0` + `shrink-0` pattern so nothing clips on mobile.
- Consistent card, badge, and empty-state treatments across all steps.
- Loading states become skeletons instead of bare text.

## Technical notes

- Update `src/styles.css`: new oklch tokens for the Noir & Gold palette in `:root` and `.dark`, gold accent/glow tokens, and `--font-display` / `--font-sans` registered in `@theme`.
- Load fonts via `<link>` tags in `src/routes/__root.tsx` head (never `@import` a URL in CSS).
- Split `src/routes/_authenticated/index.tsx` (~2,880 lines) into components under `src/components/builder/`: `AppShell`, `StepRail`, `StepUpload`, `StepReviewImports`, `StepDetails`, `StepExpansion`, `StepExport`, `SongRow`, `SectionFilters`, `EnergySparkline`. The route keeps all existing state and handlers and passes them down — state logic, hooks, and effects move verbatim, not rewritten.
- Existing components (`PreviewPlayer`, `HistoryPanel`, `InlineMatchSearch`, `MetricsDetail`, badges) get restyled in place.
- Existing tests must keep passing; no library modules under `src/lib/` change.
