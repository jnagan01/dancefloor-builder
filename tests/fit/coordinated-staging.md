# Coordinated suggestion/metadata staging — synthetic evidence (baseline 5e46335)

All data synthetic (`tests/coordinatedExpansion.test.ts`): actual event route, actual recommend handler (real
validator, server deadline, streamed partial retention; only the model stream is synthetic), 37,722 indexed
3–5 minute files, 34 client requests, targets 90/240/120 min (5400/14400/7200 s), verified 2000s / BPM 110–130 /
dance 6–10 / avoidSlow. No production data, accounts, saved events or music were read or changed.

## Live shape reproduced
- First replies: Warm Up 15 @ 12.5 s, Transition 40 @ 29.6 s, Peak 22 @ 18.5 s (3 s start-up + per-item streaming).
- Cold lookup chunks 6143/1844/9149/2771/10396/3274/7457/3300 ms (cyclic); warm cache 300 ms.
- ~20% of suggestions unlinked strangers / live-version variants / request duplicates / credited variants.
- Linked files resolve with mixed provenance: ~80% verify eligible in the sufficient-supply fixture (not a measured live eligible fraction); others verified decade/BPM
  failures, verified slow, or unresolved (estimates only). Library shelf mostly ineligible.

## Diagnosis (baseline)
Barrier rounds: wait for every lane (29.6 s), then up to 64 serial lookups with all AI rows first (≈44 s), then
rerank, then a second round with ~8–11 s windows whose replies get no lookup time. The metadata worker sat idle
while the 12.5 s and 18.5 s replies waited for the slowest section. Owned files with merely unverified years were
never lookup candidates.

## Measured results (fake clock)
| Run | Warm Up / Transition / Peak (s) | Suggestion calls | Lookup chunks / songs | Generate |
|---|---|---|---|---|
| Baseline 5e46335, mixed | 4050 / 10290 / 5520 (short) | 6 (3 sent at 74 s with 6.8–9 s windows) | 16 / 115 | 85.4 s |
| Repaired, mixed | 5520 / 14400 / 7320 | 6 | 19 / 146 | 79.4 s |
| Repaired, warm | 5550 / 14640 / 7320 | 3 | 47 / 354 | 30.2 s |
| Repaired, cold | 5520 / 14520 / 7230 | 6 | 20 / 154 | 108.6 s (incl. cold request phase) |
| Exhausted source (12 files/section) | 3810 / 10950 / 4320 honest gap | 6 (barren lanes end) | 50 / 390 | 76.2 s |
| Metadata outage (hung chunk) | 1590 / 4410 / 2100 honest gap | 5, none after the 20 s lookup deadline | 6 / 42 | 38.6 s |
| Transient Peak failure | 5520 / 14400 / 7320 | 7 (one retry ≥ 1 s later) | 19 / 146 | 79.4 s |
| Simultaneous favourites | 5340 / 14310 / 7230 (honest gap) | 9 (3 favourite passes in flight together) | 19 / 146 | 79.4 s |

Mixed repaired: 112 expansion lookups, all with counted files, 80 eligible; no review-only lookup while lanes could
still deliver; every request returned songs; no request under 8 songs; first three requests within 1 s.

## Remaining limits
- Historical 90s-only coordination could stop with eligible sources remaining. Phase expiry was a throughput
  limit, not proof of source exhaustion; progress-aware continuation below supersedes that limit.
- Pass/fail of the mixed case depends on owned files with unverified years being looked up during idle time; the
  coordination alone measured 5130 / 14160 / 6780 (short) on the same fixture.
- After coverage, lookups stop after a 20 s refinement; ranking alternatives beyond that are not checked.
- Native behaviour not verified; hosted macOS and CodeQL run on the pushed commit.

## Nov 13 follow-up: liveness and corrected native yield
- Preserved the archived 5e46335 baseline unchanged: 4050 / 10290 / 5520 seconds, 85.4s. Sufficient-supply
  mixed/warm/cold assertions remain unchanged and pass at the durations above.
- Short isolated probes completed in 6–8 wall-clock seconds; no 400-second reruns. The actual-route harness
  observes each worker/lane iteration and throws synchronously above 24 iterations at one timestamp or
  4000 total, so a microtask spin cannot hide behind a starved test timeout. Generation advances in 1s fake-clock
  steps and must settle by 120s before it is awaited. Existing duration fixtures now drive those timer turns too.
- Immediately settled metadata exposed that a zero-delay yield need not advance fake time. Production yields
  **1ms after 16 same-timestamp iterations**; each wake unregisters, and no settled promise is reused.
  The immediate-metadata actual-route regression retains all duration/identity assertions and passes.
- Overlapping HAR rejection fixture separately asserts Warm Up 11 checked / 5 outside year / 4 outside BPM;
  Transition 27 / 13 / 15; Peak 15 / 5 / 9, including overlaps (not summed as distinct exclusions).
  It yields **4920 / 11370 / 6720 seconds**, 62 eligible of 112 usable expansion lookups, six suggestion calls,
  79.4s total under the historical 90s-only coordinator: unfinished verification, NOT genuine source exhaustion.
  The continuation repair below completes the same fixture without relaxing eligibility or per-call timeouts.
- Recommendation prompt now places explicit selected decades and BPM ahead of section era defaults, neighbor
  tempo and score hints. With selected 2000s, it omits the contradictory pre-1990 audience instruction. Actual
  handler synthetic choice test asserts year 2005 and BPM within 110–130 (not a model-quality guarantee).
- Final validation: 998 tests / 93 files with two workers, 116.1s; TypeScript check and automatic preview
  compilation pass. Hosted exact-head Mac/CodeQL remains external; no native verification or publication claimed.

## Progress-aware continuation and lower-yield correction
**55/64 was final selected rows including 34 client requests and catalogue rows, after filtering. It cannot
estimate newly suggested eligibility.** The older 80% fixture is only a high-yield synthetic control, not live evidence.

- New actual-route + real-handler fixture: 40% of linked newly suggested recordings meet verified 2000s,
  BPM 110–130 and dance/avoid-slow limits; remaining linked rows fail year/BPM or slow evidence. Unlinked,
  request duplicates, credited duplicates and live-version variants remain in the replies. 37,722-file index,
  34 requests, actual 180–300 second files, HAR cold latency cycle unchanged.
- Frozen baseline on identical lower-yield inputs: **3120 / 7500 / 3540 seconds**, 115.0s, fails every section.
- Continuation: **5640 / 14400 / 7260 seconds**, **283.1s** including cold client lookups;
  368 expansion candidates (402 including 34 requests), all keys unique, six suggestion calls, two continuation
  grants, 232 candidate lookups unspent. Each section independently meets 5400 / 14400 / 7200 seconds.
- HAR overlapping rejection-count fixture now reaches **5430 / 14550 / 7320 seconds** in **131.2s** instead
  of reporting its historical phase-limited result as exhaustion.
- Estimated-upbeat catalogue refinement fixture covers, receives verified slow evidence, reopens deficits,
  sends a fresh Peak request after reopening, and ends at **5460 / 14610 / 7410 seconds**, **227.8s**.

### Exact bounds and stop semantics
- Initial 90s window, finite 90s grants up to **480s coordination ceiling**; final 3s reserve. Grant only with
  newly verified eligible yield within the last 90s and remaining lookup budget; no-progress ends after 90s.
- Original shared **600 distinct expansion-candidate lookups**, plus client-request allowance; no reset of
  attempted keys, results or sticky hung-request stop between windows. Eight songs/serial lookup, 20s client
  lookup cutoff; 30s server suggestion deadline/4s client margin; unchanged provider concurrency/pacing.
- At most 18 suggestion requests per section, one in flight per section; wire existing context remains <=500
  with complete local credit/version exclusion. Unlinked review lists stop at review capacity without counting time.
- Retain measured queue backpressure, useful request sizing and final 20s refinement. Covered lanes pause rather
  than irreversibly exit; selection invalidation resets refinement and resumes deficit sourcing. Selected estimated
  tracks receive refinement priority. Continuation notices show ready section minutes and checked candidate count.
- Time/budget/no-progress stops explicitly leave remaining sources unverified, never claim genuine exhaustion.
  Outage, stale account/event, validation, duplicate-only and barren replies retain their existing fences/stops.
- No production, native, publishing or saved-data actions. Exact-head hosted Mac/CodeQL awaits GitHub.
- Final continuation head validation: **1000 tests / 93 files**, 115.9s with two workers; TypeScript and automatic
  preview compilation pass. Prior high-yield numbers above are historical controls, not claims about native yield.
