# Bounded online metadata scheduling

Source: `cf19f8e71b746bf840df01e5ce0f2d4162f70ae3`. Target: commit containing this report.

## Diagnosis

The real event route sent up to 200 songs per request, with two requests in flight. Each server request had eight song workers, each awaiting both providers together (up to sixteen outstanding provider requests per invocation, despite the production runtime's six-connection header budget). A hung provider occupied song workers and stopped later useful work. About 10.75 seconds remained for provider work; all missing acoustic facts then shared one AI request with a four-second allowance. Cache repair is preserved; queue contention is independent of cache permissions.

## Repair and bounds

- Default generation batches: eight songs, one server request at a time. Existing 600-candidate allowance plus client requests is unchanged. Shared ranking still waits for gathering; strict filters, duration allocation, manual selections and passive restore are unchanged.
- Each invocation has four ReccoBeats lanes plus one independent MusicBrainz lane. MusicBrainz uses documented Lucene OR recording groups of up to eight, at most 100 results, and 1,000 ms start spacing. Every returned recording is identity-checked independently. Truncated results remain incomplete; no unmatched row borrows another row's verified facts.
- Cold production chunks are spaced at least one second across invocations; fully warm chunks need no provider pacing. Failed-provider cooldowns are returned to subsequent chunks. 429/5xx pauses the provider lane using Retry-After, without replaying the failed recording; 401/403 ends that provider lane for the invocation. No rate limit is silently treated as a definitive no-match.
- Existing 16-second server / 20-second client chunk limits and provider/AI limits are not increased. Gathering has a 90-second generation-wide deadline; unsent work is counted separately, completed chunks retained, attempted identities not replayed. Cancellation/account/event guards stop new chunks and reject stale results.
- AI fallback groups contain at most eight songs; streamed complete JSON items are merged immediately into the bounded result accumulator. A hung remainder cannot discard earlier completed estimates; late callbacks cannot modify returned results or write new cache rows. Estimates remain estimates. SDK retries are disabled. Cache adapter and authentication are unchanged.

## Reproducible synthetic evidence

Run `bunx vitest run tests/enrichScheduling.test.ts --maxWorkers=2`. Inputs are invented names only; storage, providers and AI are fake. Provider response latency is 250 ms. Clock is simulated; numbers are **not live/native timings**, and do not reproduce Joe's account. Frozen prior source is `tests/fit/archived/enrichPipeline.cf19f8e.ts`; only its relative imports were relocated. The prior fixture runs without the production runtime's connection throttling, so its small-batch speed is optimistic.

| Rows | Prior cold ms | Prior energy facts / unfinished | New cold ms | New mixed ms | New warm ms | New complete facts |
|---|---:|---|---:|---:|---:|---:|
| 34 | 2,500 | 34 / 0 | 5,000 | 5,000 | 0 | 34 |
| 100 | 6,500 | 100 / 0 | 13,000 | 13,000 | 0 | 100 |
| 200 | 10,750 | 168 / 32 | 25,000 | 25,000 | 0 | 200 |
| 600 | 10,750 | 168 / 432 | 75,000 | 75,000 | 0 | 600 |

The change prioritizes completing useful queued work over a falsely quick incomplete response; it does not claim every large cold run becomes faster. Peak synthetic provider requests drops 16 → 5. Warm fixtures make zero provider calls/writes. New fixtures additionally assert hung-provider independence, 429 cooldown, no-match honesty, streamed AI partial retention, overall deadline and stale account fencing. Existing actual-route facts/ranking, cache/auth, expansion 90/240/120, strict-policy and save/reopen regressions pass without loosening assertions. Historical comparison evidence and ratings remain unchanged; its one-chunk test protocol is explicitly frozen.

## Gates and limitations

- Full suite: 922 tests / 88 files pass with two workers. Focused cache/deadline/facts/route checks: 42 passing; scheduling matrix: 21 passing. Python reporting: 28 mocked tests pass; no email sent. Automatic preview compilation reports build OK.
- All four existing isolated Electron scripts attempted without installation. Event/preparation/offline cannot launch: Electron binary absent; offline race cannot resolve desktop Electron package. These are **not passing native gates**.
- Workflow definitions, runner/concurrency, schedules, desktop/security setup and dependencies are unchanged. No workflow run was started/inspected from this environment (no GitHub credentials). User-reported successful run `43292496440` is prior-head `7fb1600` evidence only. A new final-commit hosted macos-15 native/offline/preparation run remains required before publication.
- Provider request shapes were checked against https://musicbrainz.org/doc/MusicBrainz_API/Search , https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting and https://reccobeats.com/docs/documentation/rate-limiting . Pacing is per generation/invocation, **not a distributed global IP quota**. Simultaneous users can still receive shared-provider throttling, which remains truthful and bounded. No new persistent store/migration is introduced.
- No live provider/AI lookup was executed: doing so through enrichment could write production cache data, prohibited here. The existing four-second optional AI allowance can still be insufficient; smaller prompts and partial-stream preservation reduce lost work, not guarantee AI completion. No new AI model or endpoint was selected. Live gateway availability/error behavior remains unverified.
- Nothing published, installed, migrated, generated for a real event, or read/written in production events/library/audio; permissions and credentials untouched.