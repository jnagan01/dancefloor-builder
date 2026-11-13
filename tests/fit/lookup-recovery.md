# Online lookup recovery — synthetic evidence

## Diagnosis and narrow repair

- The previous pipeline starts AI only after every acoustic worker settles. A slow last recording can use 10.75s of the fixed RPC window, leaving about 4s for an otherwise useful estimate.
- HTTP request timers previously ended at response headers. Stalled JSON bodies could consume the rest of the provider phase, and failed feature bodies discarded already-known popularity.
- Shared cooldown waits previously captured an old wake time. A subsequent in-flight 429 could extend the cooldown without delaying already-sleeping workers. Failed first search pages could also unnecessarily attempt page two.
- The single AI lane now consumes completed acoustic gaps early, with one 25ms coalescing turn for simultaneous multi-row misses. Quick eight-row misses remain one model call; no completed recording receives two estimates.
- Body parsing stays inside the original request timer and abort scope. Failed bodies are cancelled; completed exact popularity, year, cached facts, streamed partials and per-field provenance survive.
- Every cooldown wake rechecks the current shared provider state. No failed-recording retry was added. Suggestion transient retries respect Retry-After only when enough useful time remains; the recommendation SDK now has `maxRetries: 0`, leaving retry decisions in the fenced section lanes.

## Unchanged limits and models

- Metadata RPC total 16s, request maximum 6s, assembly reserve 250ms, cache read 3s/write 1s. Client cutoff 20s.
- Four acoustic connections, one recording-search lane and one serial estimate lane: at most six. Recording searches remain grouped by eight and paced one second apart.
- Serial eight-row client chunks; 600 distinct expansion lookup attempts; progress-based 90s grants inside the existing 480s coordination ceiling. No negative caching of failures, no raw padding or relaxed strict gates.
- No model migration or output-cap changes. Authenticated catalog inspection confirmed both existing models support Chat Completions: `openai/gpt-6-astra` (estimates, streaming text, low reasoning, no SDK retries) and `google/gemini-3-flash-preview` (streamed suggestion objects, 8192 output tokens). Synthetic handler fixtures inspect the actual call options, empty-deadline recovery and full-item partial retention. No live AI generation/provider calls were made; supported catalog membership is not a live inference timing guarantee.

## Before/after and coverage

`enrichRecovery.test.ts` executes the frozen d8b597d pipeline and repaired pipeline with the same synthetic transport:

| Scenario | Before | After |
| --- | --- | --- |
| Early acoustic misses + slow last recording + 5s estimates | First AI start 10,750ms; zero acoustic estimates retained | First AI start 225ms; seven completed acoustic estimates retained; external timeout still reported |
| Stalled headers/body/AI | Old body timer covered headers only | Real pipeline returns bounded incomplete status by 16s; no failed-only cache writes |
| Later 429 extends a sleeping worker's 2s pause to 6s | Captured old wake could send at 2s | Dispatch at 6s |
| 14s provider cooldown, next serial chunk | Failed first-page search could attempt page two | Next chunk waits; no failed-recording replay; partial AI facts retained |
| Empty 30s suggestion deadline | Empty output remains a truthful timeout | Same deadline; lane's next request shrinks 40 to 20 and recovers; no hidden SDK retries |

Actual event route + real enrichment pipeline + actual recommendation validator/handler, synthetic transports/storage only:

| Mode | Approved seconds Warm Up / Transition / Peak | Generation | Metadata chunks / requested tracks |
| --- | --- | --- | --- |
| Cold, 40% linked suggestions valid | 5640 / 14400 / 7260 | 283.3s | 51 / 402 |
| Mixed, 40% linked suggestions valid | 5640 / 14400 / 7260 | 225.9s | 50 / 394 |
| Warm, 40% linked suggestions valid | 5640 / 14490 / 7260 | 32.0s | 51 / 387 |

Targets independently remain 5400 / 14400 / 7200 seconds. Fixtures retain all 34 requests, 37,722 exact-file index entries, realistic 3–5m file lengths, verified 2000s/BPM 110–130/dance 6–10 limits, slow/version/credit duplicate rejection, full local dedupe beyond 500 wire context and byte-identical library input. HAR chunk delays are an injected pre-provider transport shape, not a claim that the synthetic public provider is the original native service. Existing coordinated and optional covered-client fast-path regressions are unchanged.

## Verification and limitations

- Focused recovery/targeted/suggestion suites: 49 tests passed before the final combined-concurrency fixture; integration run: 55 tests passed. Final full-suite totals are recorded in the roadmap.
- Reporting tests: 28 passed. TypeScript and automatic preview compilation passed.
- An unavailable/rate-limited public provider, stalled AI stream, or zero-output startup can still produce honest incomplete results. No deadline increase, suppression, speculative negative cache, provider/model substitution, or indefinite retry was introduced.
- No real accounts, events, library/audio, native profile, production database, schemas, permissions, installation, release or publication actions.
- Existing hosted read-only Mac workflow triggers on changed source/tests; GitHub dynamic CodeQL is active. Final-head execution can only start after platform repository synchronization at turn completion; prior-head results are not final-head verification. No CI files/settings were changed.