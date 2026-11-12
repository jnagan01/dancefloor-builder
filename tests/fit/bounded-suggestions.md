# Bounded suggestions and useful duration lookups

Baseline: `bee5cdfa38868189b6712bc7ae6e5e7791aea4b9`. Synthetic fixtures only; no account, event, audio, production cache or provider access.

## Diagnosis and repair

- The route sent selected rows plus the entire candidate pool as `existing`; the actual handler rejects more than 500. All later unchanged attempts could fail again. The prompt itself only uses 200 entries. Context is now at most 500 (selected requests first, recent pool context next); the full local pool and retired attempted recording identities still exclude duplicate primary/full-credit/version identities. Server limits/authentication are unchanged.
- Suggestion sends are serial. Validation, timeout and other terminal errors stop the suggestion lane. Explicit 429/5xx receives one delayed retry per section, within the existing overall bound. Stale event/account replies are ignored. Safe messages appear immediately and in persistent shortage details; no raw errors/queries are displayed.
- A slow MusicBrainz recording search previously held AI estimates until all provider work completed, leaving little time inside the unchanged 16-second request. One estimate lane now starts after acoustic work settles, while independent recording work continues. Maximum four acoustic + one recording + one estimate connections; no increased timeout or provider retry flood. Completed partials remain provenance-labelled and cached; same-generation recording attempts are not replayed.
- Shared lookup score remains primary. Ties favor approved usable seconds, rather than alphabetical order, so bounded facts cover more preparation. Final shared fit ranking, strict BPM/decade checks, supported avoid-slow gate and per-section unique playable duration remain unchanged. AI evidence is still uncertain; this does not cure every classification.

## Actual-route evidence

`tests/boundedSuggestions.test.ts` uses the real recommendation validator and handler with synthetic auth/model transports, real event-route closures, real enrichment pipeline, ranking, matching and export readiness.

34 requests, 1,800 irrelevant/unknown-fit prefix files, 180 eligible files lasting 180–300 seconds; 90/240/120-minute targets. The model also returns a featured-credit duplicate outside wire context. All 34 requests survive; no duplicate or unsupported prefix additions survive.

| Cache mode | Warm Up seconds | Transition seconds | Peak seconds | Lookup identities | Successful suggestion calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold | 5460 | 14580 | 7320 | 146 | 2 |
| Mixed | 5460 | 14580 | 7320 | 146 | 2 |
| Warm | 5580 | 14490 | 7410 | 162 | 2 |

Before duration tie priority, the same repaired-wire cold/mixed fixture reached only 7080 Peak seconds; after priority all sections independently meet selected targets. Simulated six-second AI latency; fake clocks, not live timing measurements. Prior published user observations are not synthetic baseline replays.

Independent hung recording + AI fixtures: AI dispatch starts at 0ms rather than after the 6s recording deadline. Six/twelve-second estimates finish; fifteen-second estimates exceed the unchanged 14.75s estimate end, report timeout, and retain emitted energy without fabricating danceability. Provider failure remains reported even with acoustic facts. Terminal max501 validation is attempted once; actual max500 succeeds; no-auth rejects before model work. Existing cooldown, late feedback, stale account/event, saved snapshot, identity, slow and constrained-shortage suites remain required.

## Gates and limitations

Full suite: 959 tests / 91 files passed with two workers; final post-review rerun recorded in roadmap. Automatic preview compilation/typecheck required. Reporting tests are mocked, no mail sent.

All four existing isolated native scripts attempted without installation: run/offline/prep fail missing Electron binary (ENOENT); offline-ui-race cannot resolve Electron. Not passes. Exact-head hosted macOS and CodeQL require GitHub execution; no new run ID available here. Workflows/security setup unchanged; no publish, installer, migration, permissions change or production write.