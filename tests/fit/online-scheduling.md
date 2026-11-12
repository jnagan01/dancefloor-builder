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

### November 12 follow-through: useful priority and fresh automatic dance admission

Source: `654c4f90dd2afbdcc20b55698042afdd690c88dd`; target: the commit containing this section. No production snapshots, file paths, accounts or provider traffic were used.

Diagnosis from the actual source: broad owned admission already used shared ranking, but the facts queue discarded that order and sorted source tiers/identity alphabetically. Any active BPM/decade/dance/vibe choice marked nearly the entire index relevant; up to 300 background lookups could therefore precede useful later recordings. The queue also requested non-owned rows even with sufficient catalogue acoustic evidence. AI was always capped at four seconds, including after immediate provider misses, wasting unused request time. A dispatch at 82 seconds could race the 90-second end and lose its returned facts. Avoid-slow ranking only penalised unsupported fit; duration refill could ultimately select unknown recordings. Tempo/reissue tags never supplied acoustic proof.

Changes:
- Shared lookup-priority ranking (with strict known contradictions and feedback already applied) now determines missing-fact order. Known usable files precede review-only files and new AI discoveries retain a bounded priority lane. Sufficient acoustic facts skip lookups unless an active familiarity choice still needs popularity or strict limits need verification. Each repair round investigates at most 64 candidates, reserving the existing discovery allowance; still-unattempted owned rows are retained for subsequent rounds. Complete finite catalogue admission and all original lookup/provider concurrency budgets remain intact.
- Estimates can reuse unused provider time **inside the unchanged sixteen-second request end**, with cache-write reserve. No request/overall deadline is raised. A twelve-second estimate following immediate misses now finishes; previously a six/twelve-second estimate could not fit the fixed four-second AI phase. Completed streamed items survive rejection/hang, failures remain incomplete, and attempted recording keys are never replayed within the generation. No permanent negative cache is added.
- Dispatch reserves observed request latency plus one second (maximum twenty seconds); a chunk without that much generation time remains unattempted/unsent instead of becoming a doomed late request. Cooldown waiting remains before dispatch with account/event fences. Rate/unavailable responses are reported as failed fetch, actual deadline/abort as timeout, complete misses remain ordinary unknowns.
- Fresh automatic expansion with Avoid slow requires supported upbeat acoustic/groove or unconflicted exact-track dance-tag evidence. Unknown/weak/conflicting candidates are withheld, **not called slow**. Strong low-both remains excluded. BPM, release year, popularity, titles and artist resemblance never satisfy this gate. The same gate protects final rank and late-feedback refill. Requests, manual decisions, passive reopening, no-fit behavior and historical quality reports remain unchanged; no schema change. Positive estimates remain explicitly estimates, not verified facts.

Reproduce: `bunx vitest run tests/targetedExpansionLookups.test.ts tests/durationExpansionRoute.test.ts --maxWorkers=2`.
The actual event route with 34 requests, 2,200 alphabetically early irrelevant files and 40 later useful files reaches **5,400 / 14,400 / 7,200 seconds** individually in cold/mixed/warm fixtures. Forty useful identities gain acoustic facts before irrelevant rows; 98 total identities are dispatched once each. Simulated cold/mixed/warm times: **78,000 / 78,000 / 18,000 ms**. These are controlled six-second AI fixtures, not native performance claims. Warm route time includes cold irrelevant candidates in its bounded final chunk; a purely warm pipeline uses zero AI/provider work.

| Direct queue | Six-second cold/mixed time | Facts returned intact | Unsent | Fully warm time / facts |
|---|---:|---:|---:|---:|
| 100 | 78,000 ms | 100 | 0 | 0 ms / 100 |
| 200 | 84,000 ms | 112 | 88 | 0 ms / 200 |
| 600 | 84,000 ms | 112 | 488 | 0 ms / 600 |

Large cold queues cannot all finish within ninety seconds; the repair selects useful work rather than promising impossible throughput. A twelve-second scheduling fixture returns 56 songs by 84 seconds and never sends the final eight. Existing 250-ms provider benchmarks above remain historical evidence, not realistic AI latency. Exact cover/remix isolation, unknown Desperado-like metadata, independent verified slow evidence, explicit request exceptions, passive manual-path preservation, late feedback, stale events/accounts, cooldowns and hung streamed estimates are asserted. Original forty-client/no-warning native duration assertion is untouched; the native held-out fit assertion now enforces the newly authorized withholding policy instead of requiring risky estimates to survive.

Current validation and exact-head macOS/CodeQL acceptance are recorded in the completion summary. All four isolated Electron scripts were attempted without installation: missing Electron binary/package blocks them locally, not a pass. No new workflow run ID can be supplied from this environment; user-supplied `43303936319` is prior-head evidence only. Existing hosted workflow definitions/schedules/security setup are unchanged. Live gateway/provider behavior remains unverified because live enrichment could write the production cache.

Final local validation: **949 tests / 90 files** passed with `--maxWorkers=2`; **28** Python reporting tests passed with mocked SMTP (no mail sent); automatic preview compilation `build OK`. Focused scheduler/cache/duration/route run: **89** passing tests, plus **15** community/late-feedback policy checks and the complete-catalogue comparisons in the full suite. No standalone build/typecheck was manually run: compilation is the automatic preview gate. Four isolated native scripts are blocked as described above, and no hosted run was launched here.

### Follow-through: delayed-send cooldown

- Provider cooldown now belongs to the gatherer's dynamic `readyAt` pre-dispatch scheduler, outside the 20-second RPC deadline. The existing 90-second overall limit bounds it; a cooldown beyond that end stops unsent work immediately, with no delayed sender left behind. Retry-After is not shortened to 90 seconds.
- Fences are checked while waiting (at most 100 ms between checks) and immediately before dispatch. Only dispatched songs consume budget/become attempted. Dynamic-cooldown workers and overlapping gather calls are serialized. Cancellation is counted separately from deadline/cooldown skips; stale generations do not show lookup-failure messages.
- Actual event-route fake-timer tests cover 2-second, 30-second (>20-second RPC cutoff), and 120-second (>90-second generation limit) cooldowns, event/account changes during waiting, retained requests/facts, and no sends after completion. Pure accounting checks assert unsent identities, request totals, budget classification and no overlapping calls. All data/services are synthetic.
- Provider-unavailable/aborted lookup evidence remains incomplete rather than a definitive no-match; review messages now name deadline/cooldown or provider unavailability instead of claiming all incomplete work timed out. No provider/cache/server behavior was broadened.
- Hosted Mac run `43303936319` is prior-head `00fbfb7` evidence only; this correction still requires a new exact-head hosted check. No native app access, installation, publication or production access performed.
- Correction validation: 60 focused scheduling/deadline/actual-route tests pass; 24 duration/cooldown/historical-report checks pass; final full suite 929 tests / 89 files passes with two workers, automatic compilation build OK. Test harness page and preparation modules now share dynamically resolved fake clock/timers, including suites that enable fake timers after mounting; historical reports remain byte-for-byte unchanged.

- Full suite: 922 tests / 88 files pass with two workers. Focused cache/deadline/facts/route checks: 42 passing; scheduling matrix: 21 passing. Python reporting: 28 mocked tests pass; no email sent. Automatic preview compilation reports build OK.
- All four existing isolated Electron scripts attempted without installation. Event/preparation/offline cannot launch: Electron binary absent; offline race cannot resolve desktop Electron package. These are **not passing native gates**.
- Workflow definitions, runner/concurrency, schedules, desktop/security setup and dependencies are unchanged. No workflow run was started/inspected from this environment (no GitHub credentials). User-reported successful run `43292496440` is prior-head `7fb1600` evidence only. A new final-commit hosted macos-15 native/offline/preparation run remains required before publication.
- Provider request shapes were checked against https://musicbrainz.org/doc/MusicBrainz_API/Search , https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting and https://reccobeats.com/docs/documentation/rate-limiting . Pacing is per generation/invocation, **not a distributed global IP quota**. Simultaneous users can still receive shared-provider throttling, which remains truthful and bounded. No new persistent store/migration is introduced.
- No live provider/AI lookup was executed: doing so through enrichment could write production cache data, prohibited here. The existing four-second optional AI allowance can still be insufficient; smaller prompts and partial-stream preservation reduce lost work, not guarantee AI completion. No new AI model or endpoint was selected. Live gateway availability/error behavior remains unverified.
- Nothing published, installed, migrated, generated for a real event, or read/written in production events/library/audio; permissions and credentials untouched.