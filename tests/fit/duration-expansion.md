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

The 2× fixture produces 55/120/60 rows, including all ten client requests; usable additions exceed old estimated counts. Save/reopen preserves the generated selections exactly; passive opening writes nothing. Separate regressions cover hard-metadata rejection, additional sourcing rounds, outages, unknown/unlinked durations, credit aliases, repeated files, section imbalance, expansion-off, exclusions and missing saved paths.

## Bounds and limitations

- Candidate pool remains 2,000, deterministically bounded with catalogue admission reserved. Larger eligible libraries can still have alternatives outside this pool; no raw-order padding or relaxed constraints.
- General recommendation rounds are bounded by the prior maximum section-call allowance (at least four, or estimated section count / 40 rounded up plus three). Each call requests at most 40. Favourite passes remain at most three per section.
- Client waits are bounded to 12 seconds per recommendation and a 90-second sourcing cutoff; already-running provider work cannot be cancelled by this client-only guard, but cannot write a late result into the event.
- Existing metadata and community budgets/deadlines are retained, shared across rounds (community at most 40 lookups). Unknown danceability cannot satisfy an explicitly selected dance range.
- Known lengths can exceed the exact target by the last whole file's duration. Approval/library presence does not prove physical disk availability; existing export readiness still verifies that separately.
- No schema changes, passive regeneration, workflow/schedule/updater changes or desktop installation.

## Validation

- Full Vitest: **881 passing tests / 86 files**, with bounded worker concurrency to avoid unrelated wall-clock deadline test contention.
- Reporting Python: **28 passing tests**, mocked SMTP only (no email sent).
- Automatic preview compilation: **build OK**. Manual app builds/typechecks are intentionally not run; the platform runs them.
- Isolated Electron event suite attempted with existing Linux/Xvfb: **blocked before tests**, missing `desktop/node_modules/electron/dist/electron` (ENOENT). No binary installed under the user's restriction.
- Added real Electron event-route duration/save/reopen case; runner syntax and bundling succeeded before launch. Actual macOS execution remains required through the unchanged automatic macos-15 workflow. No native passing claim is made.

Source baseline: `ad1466c`; implementation checkpoint: `4bbff77` (platform maintenance checkpoint preserved). Final commit is reported in chat/GitHub, not fabricated here.