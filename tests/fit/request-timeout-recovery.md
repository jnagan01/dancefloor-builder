# Whole-request timeout recovery (synthetic only)

## Repair
- Preserve the 20s individual cutoff, 16s server end, phase/hard ceilings, 600 candidate budget plus client allowance, and attempted-key dedupe.
- A timed-out gather stops its current chunk queue. New gathers wait inside their current phase/session fence until every outstanding transport settles. Both resolution and rejection release only the gate; late payloads never become facts.
- The event callback checks a per-call acceptance fence before updating provider causes, warning aggregates, pressure or measured dispatch latency. Suggestion sourcing waits while the timed-out metadata transport remains blocked.
- A never-settling transport consumes no additional lookup budget, cannot stack calls, and stops at phase expiry/cancellation. No failed chunk replay or storage/schema changes.

## Executed evidence
- Original `ab177896` gatherer, two synthetic 25s settlement cases (resolve/reject): both fail, later requested=0 instead of 8, retaining the unused budget. Final implementation passes both; first eight remain unknown/attempted, second eight are fetched once after actual settlement, budget 592 then 584.
- Actual event route: 34 clients and synthetic sufficient eligible files, first eight-client request settles at 25s with deliberately unusable late facts and long rate pressure. No second call before settlement, peak transport concurrency=1, 6 calls/48 distinct requested keys, 40 eligible file lookups; final approved seconds 5400/14400/7200. All requests remain preserved, original snapshot unchanged, late pressure absent, activity retains metadata_timeout=8 and accurate complete section coverage; sanitized copy excludes fixture identities/paths.
- Concurrency two waits for both timed-out calls, including rejection; exact cutoff races, permanently hung transports, phase expiry, cross-account cancellation and late rejection handling are covered.

```text
bunx vitest run tests/factsGatherTimeout.test.ts tests/targetedExpansionLookups.test.ts tests/factsCooldownRoute.test.ts tests/factsTiming.test.ts tests/factsTimeoutReport.test.ts tests/generationDiagnosticsRoute.test.ts tests/providerPressure.test.ts tests/metadataPresentation.test.ts --maxWorkers=1
  Final: 88/88 passed, 8 files, 30.21s.
bunx vitest run --maxWorkers=2
  One full attempt: 1170 passed / 1 failed, 108 files, 447.78s. NOT a full pass.
  Failure: original permanently-hung coordinated suggestion-stop assertion.
  Added integration gate for suggestions behind unresolved timed-out metadata; assertion unchanged.
bunx vitest run tests/coordinatedExpansion.test.ts -t 'metadata outage' --maxWorkers=1
  After integration fix: 1/1 passed, 35 intentionally unselected, 9.28s.
```

The full attempt preceded the final suggestion gate and explicit cross-account test; focused final checks cover those changes. No repeated full run. Preview compilation reports build OK; whitespace check clean. Final-code hosted Mac/full suite, production validation, native UI and independent frozen real-input replay remain unverified here and must pass before release. No production accounts/providers/events/library/audio, telemetry, credentials, dependency/workflow changes, publishing or deployment used.