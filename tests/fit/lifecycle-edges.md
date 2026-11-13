# Reviewed suggestion lifecycle edges

Synthetic fixtures only; actual event route, real ranking/fill and real suggestion handler/validator. No production queries, publication, native installation or user data access.

## Regressions
- Optional neighbor/crowd calls are lazy. A neighbor response exactly at the 15,000 ms context deadline sends no extra crowd request. Event/account switches before the response also send none; a 1,000 ms response in the current context sends exactly one extra request.
- A completed suggestion object at 1,000 ms survives a permanently hung `finishReason`. The handler returns the complete object at its original 12,000 ms deadline, without marking it partial, and leaves no deadline timer.
- Warm Up, Transition and Peak favorite replies resolve simultaneously at 1,000 ms with three distinct songs each. Exactly three favorite candidates reach shared ranking across all sections, not nine trimmed separately afterward. All 34 client requests remain.

## Validation
- Focused lifecycle + bounded-context suites: 35 tests / 2 files passed.
- Full suite: 984 tests / 92 files passed.
- Automatic preview compilation: build OK after source and test edits.
- Existing cold/mixed/warm actual-route fixtures still independently reach 5,520 / 14,430 / 7,350 approved unique-file seconds against targets 5,400 / 14,400 / 7,200. Healthy Transition replies still complete in 22,430 ms and Peak receives its first request alongside the other sections. Full wire-cap, local credited-version dedupe, slow-fit, partial, retry and stale-reply coverage retained.
- Final-head hosted Mac and CodeQL remain for Joe to verify; no native verification is claimed.