# Expansion duration repair evidence

This is synthetic evidence, not a regeneration or replay of the user's wedding. No production account, event, library, music file, provider or email was accessed.

## Root cause and repair

Previously offered candidates reduced sourcing gaps before strict eligibility and shared ranking. Final selection stopped at an estimated track count, and global energy ordering could trim/reallocate additions. Aggregate baseline coverage hid section shortages.

The route now checks section-specific approved unique intended-file seconds after shared ranking, identity dedupe and artist caps. Suitable in-memory owned candidates can compete beyond the tiny neighbour search. Known usable candidates precede bounded review-only suggestions; review rows never satisfy duration. Energy sequencing stays within the allocated sections. Late Never/dismiss removals can be replaced from the already ranked eligible pool. Every displayed section must meet its selected preparation target before the overall message says covered.

## Reproduction

Run `bunx vitest run tests/durationExpansionRoute.test.ts tests/durationFill.test.ts`.
The actual event-route harness uses isolated storage/services and the real safe-save validator. Runtime evidence is written to `test-results/duration-expansion.json`; prior comparison artifacts are untouched.

| Case | Warm Up seconds | Transition seconds | Peak seconds |
|---|---:|---:|---:|
| User-supplied observed result (not accessed/replayed) | 3241 | 7787 | 3061 |
| Synthetic initial snapshot: 10 unlinked client requests | 0 | 0 | 0 |
| Synthetic 45/120/60 minutes at 2×, after explicit generation | 5400 | 14400 | 7200 |
| Selected 2× preparation targets | 5400 | 14400 | 7200 |
| Synthetic 1× after generation (whole 120-second files) | 2760 | 7200 | 3600 |
| Background 60 minutes | 3600 | 0 | 0 |

The 2× fixture produces 45/120/60 usable additions plus ten unlinked client requests distributed across sections by fresh allocation; total rows are not duration coverage. Usable additions exceed old estimated counts. Save/reopen preserves the generated selections exactly; passive opening writes nothing. Separate regressions cover hard-metadata rejection, additional sourcing rounds, outages, unknown/unlinked durations, credit aliases, repeated files, section imbalance, expansion-off, exclusions and missing saved paths.

## Bounds and limitations

- Candidate pool remains 2,000, with complete eligible catalogue admission and 120 discovery places reserved (40 per active section). Shared ranking orders usable owned index candidates before bounded admission; unselected owned candidates rotate while eligible discoveries and selected recordings remain. Rejected entries relinquish capacity. No raw-order padding or relaxed constraints.
- General recommendation rounds are bounded by the prior maximum section-call allowance (at least four, or estimated section count / 40 rounded up plus three). Each call requests at most 40. Favourite passes remain at most three per section.
- Client waits are bounded to 12 seconds per recommendation and a 90-second sourcing cutoff; already-running provider work cannot be cancelled by this client-only guard, but cannot write a late result into the event.
- Existing metadata and community budgets/deadlines are retained, shared across rounds (600 addition facts plus request allowance; community at most 40 lookups). At most 300 initial non-AI facts consume that allowance, reserving the other half for later discoveries. Unknown/AI danceability does not fail the range; verified contradictions do. Strict BPM/decade requirements remain unchanged.
- Known lengths can exceed the exact target by the last whole file's duration. Approval/library presence does not prove physical disk availability; existing export readiness still verifies that separately.
- No schema changes, passive regeneration, workflow/schedule/updater changes or desktop installation.

## Validation

- Full Vitest after independent-review and fresh-client allocation repairs: **891 passing tests / 86 files** (`bunx vitest run --maxWorkers=2`). Latest focused client/duration/catalogue checks: **22 passing tests**; original metadata-timing and ranking route regressions also pass in the full suite.
- Reporting Python: **28 passing tests**, mocked SMTP only (no email sent).
- Automatic preview compilation: **build OK**. Manual app builds/typechecks are intentionally not run; the platform runs them.
- Isolated Electron event suite attempted with existing Linux/Xvfb: **blocked before tests**, missing `desktop/node_modules/electron/dist/electron` (ENOENT). No binary installed under the user's restriction.
- Added real Electron event-route duration/save/reopen case; runner syntax and bundling succeeded before launch. Actual macOS execution remains required through the unchanged automatic macos-15 workflow. No native passing claim is made.

Source baseline: `ad1466c`; implementation checkpoint: `4bbff77` (platform maintenance checkpoint preserved). Final commit is reported in chat/GitHub, not fabricated here.

## Independent review follow-up (source a7cd5cf)

- Empty/duplicate favourites break only that pass; general sourcing still runs and actual-route fixtures reach **5,400 / 14,400 / 7,200 seconds**. Requests adapt to admitted files' shorter known lengths instead of converging slowly on an obsolete average.
- A **2,520-record** isolated library with 2,200 unsuitable/unknown/unusable rows before known usable files reaches those same targets; reversing the complete index produces identical selected identities and explanations.
- Saturated **2,520-record** fixture with one-second owned rows, verified dance rejections and subsequent exact-file AI supply reaches every section, within one 120-second whole-file overshoot. Lookup assertions enforce at most **610 distinct requests** including ten clients. No synthetic input is sent to a real provider.
- Sparse unknown/AI danceability retains eligibility, while verified out-of-range BPM/decades remain rejected. A varied 6/8/9-energy fixture meets **5,400 / 14,400 / 7,200** in warm-up/transition/peak roles; requests are not moved. Shared greedy ranking uses an artist heap, with an independent original-greedy equivalence regression, to avoid quadratic large-library scans.
- Bounded shortage reasons remain visible in the current review session, without persisted schema changes. Reopened snapshots are not regenerated and manual selection decisions remain intact; a reopening displays coverage guidance, not a fabricated historic generation reason.
- Local Electron binary remains absent; no install attempted. Previous hosted run **43286992448** covers the prior head only. The unchanged automatic macos-15 workflow must validate this final commit before acceptance. No publish, production access, data migration, email, native installation, schedule or updater changes.

## Actual Mac CI follow-up: fresh client allocation

User-reported run **43286992448**, job **131422895090** passed the native 2× duration test but failed the unchanged optional expansion assertion at `tests/native/run.mjs:900`: forty clients became 68 because all requests initially occupied Warm Up. The offline phase was skipped, not passed. This is supplied CI evidence; the sandbox did not independently read GitHub.

Explicit expansion Generate now allocates freshly generated requests before computing deficits, in the existing energy/era order with selected duration shares rather than count trimming. Every request occurrence is retained. Unknown lengths only guide placement as estimates; they never confirm coverage. Expansion-off, background lists, passive reopen and manual saved sections are untouched.

An actual-route regression with the same forty 240-second clients, one hour and 1× preserves exactly **40 rows**, makes **zero recommendation calls**, produces **no warnings**, and covers **3,120 / 3,360 / 3,120 seconds** against **1,200 / 1,200 / 1,200** section targets. Saved membership and selections roundtrip unchanged. The original native assertion still demands 40, not 68; no native test or workflow was changed. The synthetic 2× fixture still reaches **5,400 / 14,400 / 7,200 seconds**.

The older catalogue comparison now correctly has **14** review additions (24 planning slots minus ten distributed requests), rather than 16 caused by clients occupying only one bucket. Full-catalogue admission, stronger-alternative displacement, reverse-order identity, provider failure and request retention assertions remain intact; archived comparison artifacts were not overwritten. Fresh-client pure tests additionally cover unequal file lengths, varied energy, repeated requests, unknown lengths and read-only input preservation.

Validation: **891 Vitest tests / 86 files**, **28 reporting tests** (mocked mail only), automatic **build OK**. Local native execution remains blocked by absent Electron binary; no installation performed. A new final-head hosted Mac run including all native/offline phases is required; prior-head success of the duration case is not full acceptance.

## Native duration wait correction (source 9538300)

User-reported Mac run **43290594148** passed **883 Mac Vitest tests** but stopped at the new duration fixture's stale Transition total-row wait: **125** rows, comprising five unlinked client requests plus 120 usable additions, rather than 120 total rows. Supplied logs reported “Lists generated” without app errors/warnings. Offline phases were skipped; the native pipeline is not accepted yet.

Test-only correction: wait for confirmed, non-excluded, globally unique, exact synthetic file seconds **5,400 / 14,400 / 7,200**, rather than total rows. Unknown/unlinked lengths and repeated paths cannot satisfy the wait. Separately assert the exact seconds, all ten original request identities and unchanged input requests, review coverage, and identical saved snapshot after reload. The existing forty-client 1× assertion and all other policy/save tests remain unchanged. No application, workflow, production data or installer changes.

Focused local validation: **20 tests / 2 files passed** (`bunx vitest run tests/durationExpansionRoute.test.ts tests/durationFill.test.ts --maxWorkers=2`), including the unchanged forty-client/no-warning route regression. `node --check tests/native/run.mjs` passed; direct execution of the new polling callback against synthetic selections verified exact targets, duplicate/tentative/excluded/unknown-path rejection, and a 120-second deficit. Automatic preview **build OK**. No Electron installation/run performed; final-head hosted Mac native and offline validation remains required.